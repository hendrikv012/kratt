"""The Doctor: every result headed for a project file passes its checks first.

A failed check goes back to the model with only the failing trace and the draft (plus one
matching past fix). Once the file passes, each fix is remembered in learned_repairs and the
file is committed with git.
"""

import difflib
import sqlite3
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from memory_engine.chat import ChatModel, ModelReplyError
from memory_engine.checks import CheckUnavailable, Problem, TargetError, check_file, resolve_target
from memory_engine.chunking import estimate_tokens, newest_to_tokens, truncate_to_tokens
from memory_engine.context import PROMPT_BUDGET
from memory_engine.frontmatter import atomic_write
from memory_engine.repairs import find_repairs, mark_used, record_repair
from memory_engine.sandbox import SandboxUnavailable

MAX_FIXES = 3
TRACE_TOKENS = 300
HINT_TOKENS = 150
FIX_SCHEMA = {"type": "object", "properties": {"find": {"type": "string"}, "replace": {"type": "string"}},
              "required": ["find", "replace"]}
DOCTOR_SYSTEM = """You fix one file so that it passes its checks. Change only what the failed check needs.
Reply with JSON: {"find": "<text copied exactly from the file>", "replace": "<what it becomes>"}. Keep find short but unique."""
_FALLBACK_IDENTITY = ["-c", "user.name=memory-engine", "-c", "user.email=memory-engine@localhost"]
GIT_TIMEOUT = 60
COMMIT_MESSAGE = "Write {target} (checked by the Doctor)"


@dataclass(frozen=True)
class Promotion:
    ok: bool
    target: str
    content: str  # the final text
    fixes: int  # new drafts the model made
    commit: str | None
    message: str
    blocked: bool = False  # a problem for the person (tools, file ownership), not one the model can fix


def _trace(problems: list[Problem]) -> str:
    return newest_to_tokens("\n".join(f"{p.check}: {p.trace}" for p in problems), TRACE_TOKENS)


def apply_edit(content: str, find: str, replace: str) -> str:
    """`content` with the one exact occurrence of `find` replaced; a ValueError says why it can't be."""
    if not find:
        raise ValueError("the edit had nothing to find")
    # Count overlapping matches too: "aa" sits twice in "aaa", so it doesn't say where to edit.
    count, start = 0, content.find(find)
    while start != -1:
        count, start = count + 1, content.find(find, start + 1)
    if count == 0:
        raise ValueError("the text to change isn't in the file")
    if count > 1:
        raise ValueError(f"the text to change appears {count} times; include more of it")
    return content.replace(find, replace, 1)


def build_fix_prompt(conn: sqlite3.Connection, target: str, content: str, problems: list[Problem],
                     part: bool = False, last_problem: str = "") -> tuple[list[dict], int | None] | None:
    """Only the file name, the failing trace, one matching past fix and the draft; None if it can't fit.

    With `part`, the draft is the model's piece of a bigger file (a slide in a deck).
    `last_problem` is why the previous fix failed, so the model doesn't repeat it.
    """
    trace = _trace(problems)
    sections = [("File", target), ("Check that failed", trace)]
    hints = find_repairs(conn, trace, 1)
    if hints:
        sections.append(("A fix that worked before", truncate_to_tokens(hints[0].fix_diff, HINT_TOKENS)))
    if last_problem:
        sections.append(("Problem with your last fix", last_problem))
    sections.append(("Your part of the file" if part else "The file", content))
    messages = [{"role": "system", "content": DOCTOR_SYSTEM},
                {"role": "user", "content": "\n\n".join(f"# {name}\n{text}" for name, text in sections)}]
    if sum(estimate_tokens(m["content"]) for m in messages) > PROMPT_BUDGET:
        return None
    return messages, (hints[0].id if hints else None)


def _git(workspace: Path, *args: str, identity: list[str] | None = None) -> subprocess.CompletedProcess:
    """One git command: paths are literal (never globs), no terminal, and a time limit for slow hooks."""
    try:
        return subprocess.run(["git", "--literal-pathspecs", *(identity or []), "-C", str(workspace), *args],
                              capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired as err:
        raise RuntimeError(f"git did not finish within {GIT_TIMEOUT:g} s") from err


def _own_repository(workspace: Path) -> bool:
    top = _git(workspace, "rev-parse", "--show-toplevel")
    return top.returncode == 0 and Path(top.stdout.strip()).resolve() == workspace.resolve()


def doctor_state(workspace: Path, target: str) -> str:
    """"clean" when the Doctor's last commit wrote this file and it is unchanged since,
    "changed" when someone edited it afterwards, "none" otherwise."""
    try:
        if not _own_repository(workspace):
            return "none"
        subject = _git(workspace, "log", "-1", "--format=%s", "--", target).stdout.strip()
        if subject != COMMIT_MESSAGE.format(target=target):
            return "none"
        unchanged = _git(workspace, "diff", "--quiet", "HEAD", "--", target).returncode == 0
        return "clean" if unchanged else "changed"
    except (RuntimeError, ValueError, OSError):
        return "none"


def commit_file(workspace: Path, target: str, message: str) -> str | None:
    """Commit only `target` in the workspace's own repository; None if it didn't change.

    Every workspace gets a repository of its own (the user's rule): a workspace that is not the
    top of a repository gets `git init`, even inside another repository, so commits never land there.
    """
    def checked(result: subprocess.CompletedProcess) -> subprocess.CompletedProcess:
        if result.returncode != 0:
            raise RuntimeError(f"git commit failed: {result.stderr.strip()}")
        return result

    if not _own_repository(workspace):
        checked(_git(workspace, "init", "-q"))
    checked(_git(workspace, "add", "--", target))
    if not _git(workspace, "status", "--porcelain", "--", target).stdout.strip():
        return None
    identity = [] if _git(workspace, "config", "user.email").stdout.strip() else _FALLBACK_IDENTITY
    checked(_git(workspace, "commit", "-q", "-m", message, "--", target, identity=identity))
    return checked(_git(workspace, "rev-parse", "HEAD")).stdout.strip()


def _diff(before: str, after: str, target: str) -> str:
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                        f"a/{target}", f"b/{target}"))


def promote(workspace: Path, conn: sqlite3.Connection, model: ChatModel, target: str, content: str,
            max_fixes: int = MAX_FIXES, rules: str = "",
            assemble: Callable[[str], str] | None = None,
            check_piece: Callable[[str], list[Problem]] | None = None,
            fixed_target: bool = False, keep_edits: bool = False,
            on_fix: Callable[[str, list[dict], dict | str, str], None] | None = None) -> Promotion:
    """Check `content` as `target`, let the model fix failures, then write, learn and commit.

    With `assemble`, `content` is one piece of the file (a slide): the checks see `assemble(content)`,
    the model sees and fixes only the piece, and `Promotion.content` is the final piece.
    `check_piece` runs on the piece first. `fixed_target` means the router chose the target, so a refused
    target blocks the run instead of asking the model for another name. `keep_edits` keeps a file the
    person changed (committing their version first) and builds on it. `on_fix` gets the target, the
    prompt, the reply (or the error text) and why the fix failed ("" when it was applied), for each fix.
    """
    whole = assemble or (lambda piece: piece)
    workspace = Path(workspace)
    fixes = 0

    def failed(message: str, blocked: bool = False) -> Promotion:
        return Promotion(False, target, content, fixes, None, message, blocked)

    normalized = PurePosixPath(target.strip()).as_posix() if target.strip() else target
    state = doctor_state(workspace, normalized)
    kept = keep_edits and state != "clean" and normalized and (workspace / normalized).is_file() \
        and not (workspace / normalized).is_symlink()
    try:
        path = resolve_target(workspace, target, {normalized} if state == "clean" or kept else set())
    except TargetError as err:
        if state == "changed":
            return failed(f"{normalized} was changed since the Doctor wrote it; choose a new file name", fixed_target)
        return failed(str(err), fixed_target)
    if kept:
        try:
            commit_file(workspace, normalized, f"Keep the person's edits to {normalized}")
        except RuntimeError as err:
            return failed(f"{normalized} has edits that could not be committed: {err}", blocked=True)
    target = normalized

    learned: list[tuple[list[Problem], str]] = []
    hint: int | None = None
    last_problem = ""
    for attempt in range(max_fixes + 1):
        try:
            problems = check_piece(content) if check_piece else []
            if not problems:
                problems = check_file(workspace, target, whole(content), rules)
        except (SandboxUnavailable, CheckUnavailable, OSError) as err:
            return failed(str(err), blocked=True)
        if not problems:
            break
        if attempt == max_fixes:
            message = f"{target} still fails {problems[0].check} after {max_fixes} fixes:\n{_trace(problems)}"
            return failed(message + (f"; last fix: {last_problem}" if last_problem else ""))
        built = build_fix_prompt(conn, target, content, problems, part=assemble is not None,
                                 last_problem=last_problem)
        if built is None:
            return failed(f"{target} is too long for the Doctor to fix; keep files under about 400 tokens")
        messages, prompt_hint = built
        reply: dict | None = None
        try:
            reply = model.complete(messages, FIX_SCHEMA)
            find, replace = reply.get("find"), reply.get("replace")
            if not isinstance(find, str) or not isinstance(replace, str):
                raise ValueError("the reply needs a find and a replace")
            draft = apply_edit(content, find, replace)
            if draft == content:
                raise ValueError("the edit changed nothing")
            if not draft.strip():
                raise ValueError("the edit left the file empty")
        except ValueError as err:  # includes ModelReplyError
            last_problem = str(err)
            if on_fix is not None:
                on_fix(target, messages, reply if reply is not None else last_problem, last_problem)
            continue
        last_problem = ""
        if on_fix is not None:
            on_fix(target, messages, reply, "")
        learned.append((problems, content))
        content, hint, fixes = draft, prompt_hint, fixes + 1

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, whole(content))
    except OSError as err:
        return failed(f"{target} could not be written: {err}", blocked=True)
    for problems, draft in learned:
        record_repair(conn, problems[0].kind, _trace(problems), _diff(draft, content, target), target)
    if hint is not None:
        mark_used(conn, hint)
    message = f"checked {target}" + (f" after {fixes} fix" + ("" if fixes == 1 else "es") if fixes else "")
    try:
        commit = commit_file(workspace, target, COMMIT_MESSAGE.format(target=target))
    except RuntimeError as err:
        return Promotion(True, target, content, fixes, None, f"{message}, not committed ({err})")
    return Promotion(True, target, content, fixes, commit, message + (", committed" if commit else ""))
