"""What the Doctor checks: where a result may be written, and whether its content passes."""

import fnmatch
import importlib.machinery
import os
import re
import shutil
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import yaml

from memory_engine.chunking import FENCE, strip_frontmatter
from memory_engine.frontmatter import split_frontmatter
from memory_engine.sandbox import run_sandboxed
from memory_engine.workfiles import html_tag

MAX_SLIDE_WORDS = 80
COPY_LIMIT = 50 * 1024**2
SKIPPED_COPY = {".git", ".venv", "venv", "__pycache__", "node_modules", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
ROUTER_FILES = ("INDEX.md", "SCRATCHPAD.md", "chunk_*.md")
MARP_DIR = Path(__file__).resolve().parents[2] / "tools" / "marp"
MARP_CLI = MARP_DIR / "node_modules" / "@marp-team" / "marp-cli" / "marp-cli.js"
SCENE_KEYS = ("scene_number", "location", "camera_angle", "lighting")
SCENE_SECTIONS = ["Visual prompt", "Voiceover"]
MAX_FIELD = 120
_RULE_LINE = re.compile(r"^ {0,3}([-*_])( *\1){2,} *$")  # Marp starts a new slide at any of these
TOOL_MODULES = ("ruff", "mypy", "pytest")
MAX_NAME = 100  # characters in one part of a target path
MAX_TARGET = 240
_NOT_ALLOWED = set("*?[]:\\")  # glob characters would make git commit other files
_tools_ready: dict[str, bool] = {}
_marp_ready: dict[str, bool] = {}
_KNOWN_GOOD_DECK = "---\nmarp: true\n---\n# Ready\n"
_WORD = re.compile(r"[\w'’-]+")
_SLIDE_BREAK = re.compile(r"^---\s*$")


@dataclass(frozen=True)
class Problem:
    kind: str  # "compile", "lint", "test" or "format" (the kinds learned_repairs allows)
    check: str  # "py_compile", "ruff", "mypy", "pytest" or "markdown"
    trace: str


class TargetError(ValueError):
    pass


class CheckUnavailable(RuntimeError):
    pass


class DeckRenderError(ValueError):
    pass


def _hidden_module(relative: PurePosixPath, workspace: Path) -> str | None:
    """The importable module a target would hide, like yaml.py or json/__init__.py."""
    parts = relative.parts
    if len(parts) == 1 and relative.suffix == ".py":
        name = relative.stem
    elif len(parts) == 2 and parts[1] == "__init__.py":
        name = parts[0]
    else:
        return None
    if name in sys.stdlib_module_names or name in sys.builtin_module_names:
        return name
    own = {workspace.resolve(), Path.cwd().resolve()}
    search = [entry for entry in sys.path if entry and Path(entry).resolve() not in own]
    return name if importlib.machinery.PathFinder.find_spec(name, search) is not None else None


def resolve_target(workspace: Path, target: str, ours: set[str]) -> Path:
    """The absolute path a result may be written to, or TargetError saying why not."""
    workspace = Path(workspace)
    text = target.strip()
    relative = PurePosixPath(text)
    if not text or relative.is_absolute() or ".." in relative.parts:
        raise TargetError("the target must be a path inside the workspace, like notes/krebs.md")
    if any(c in _NOT_ALLOWED or ord(c) < 32 or ord(c) == 127 for c in text):
        raise TargetError(f"{text!r} has characters that aren't allowed in a target: * ? [ ] : \\ or control characters")
    parts = relative.parts
    if len(text) > MAX_TARGET or any(len(part) > MAX_NAME for part in parts):
        raise TargetError(f"the target name is too long (at most {MAX_NAME} characters per name)")
    if any(part.startswith("-") for part in parts):
        raise TargetError(f"{text}: names in a target may not start with -")
    at_root = len(parts) == 1 and any(fnmatch.fnmatch(parts[0], name) for name in ROUTER_FILES)
    if at_root or any(part.startswith(".") for part in parts) or relative.name.startswith("memory.db"):
        raise TargetError(f"{text} is one of the router's own files")
    if relative.suffix not in (".md", ".py"):
        raise TargetError("only .md and .py files can be targets")
    hidden = _hidden_module(relative, workspace)
    if hidden is not None:
        raise TargetError(f"{text} would hide the Python module {hidden}; choose another name")
    current = workspace
    for depth, part in enumerate(parts, start=1):
        current = current / part
        shown = "/".join(parts[:depth])
        if current.is_symlink():
            raise TargetError(f"{text} goes through a link ({shown}); choose a path without links")
        if depth < len(parts) and current.exists() and not current.is_dir():
            raise TargetError(f"{shown} is a file, not a folder")
    path = (workspace / relative).resolve()
    if not path.is_relative_to(workspace.resolve()):
        raise TargetError(f"{text} leaves the workspace")
    if path.exists() and relative.as_posix() not in ours:
        raise TargetError(f"{text} already exists and was not written by the Doctor; choose a new file name")
    return path


def _slides(body: str) -> list[str]:
    slides, current, fence = [], [], None
    for line in body.splitlines():
        marker = FENCE.match(line)
        if fence is None and marker:
            fence = marker.group(1)
        elif fence is not None and marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
            fence = None
        elif fence is None and _SLIDE_BREAK.match(line):
            slides.append("\n".join(current))
            current = []
            continue
        current.append(line)
    return slides + ["\n".join(current)]


def check_markdown(content: str) -> list[Problem]:
    def problem(trace: str) -> Problem:
        return Problem("format", "markdown", trace)

    problems: list[Problem] = []
    has_header = content.splitlines()[:1] == ["---"]
    meta: dict = {}
    try:
        meta, body = split_frontmatter(content)
    except (yaml.YAMLError, RecursionError, ValueError) as err:
        body = strip_frontmatter(content)
        problems.append(problem(f"the YAML header can't be read: {' '.join(str(err).split())}"))
    else:
        if not has_header:
            problems.append(problem("the file needs a YAML header with a title"))
        elif not meta.get("title"):
            problems.append(problem("the YAML header needs a title"))
    tag = html_tag(body)
    if tag is not None:
        problems.append(problem(f"HTML tags are not allowed: {tag}"))
    if meta.get("marp") is True:
        for number, slide in enumerate(_slides(body), start=1):
            words = len(_WORD.findall(slide))
            if words > MAX_SLIDE_WORDS:
                problems.append(problem(f"slide {number} has {words} words; the limit is {MAX_SLIDE_WORDS}"))
    return problems


def _copy_workspace(workspace: Path, destination: Path) -> None:
    copied = 0

    def ignore(folder: str, names: list[str]) -> set[str]:
        return {n for n in names if n in SKIPPED_COPY or n.startswith("memory.db")}

    def copy(source: str, target: str) -> None:
        nonlocal copied
        try:
            info = os.lstat(source)
            if not stat.S_ISREG(info.st_mode):
                return  # pipes, sockets and devices are left out
            copied += info.st_size
            if copied > COPY_LIMIT:
                raise CheckUnavailable(f"the workspace is too big to check (over {COPY_LIMIT // 1024**2} MB)")
            shutil.copy2(source, target)
        except OSError:
            return  # files that can't be read are left out

    try:
        shutil.copytree(workspace, destination, ignore=ignore, copy_function=copy, symlinks=True, dirs_exist_ok=True)
    except (shutil.Error, OSError) as err:
        raise CheckUnavailable(f"the workspace can't be copied for checking: {err}") from err


def _has_tests(folder: Path) -> bool:
    return any(folder.rglob("test_*.py")) or any(folder.rglob("*_test.py"))


def _ensure_tools() -> None:
    """Check once that ruff, mypy and pytest load inside the sandbox, so a broken install isn't blamed on a draft."""
    key = f"{sys.executable} {TOOL_MODULES}"
    if _tools_ready.get(key):
        return
    with tempfile.TemporaryDirectory(prefix="doctor-") as empty:
        result = run_sandboxed([sys.executable, "-P", "-c", "import " + ", ".join(TOOL_MODULES)], Path(empty), 60)
    if result.returncode != 0:
        last = (result.output.strip().splitlines() or ["no output"])[-1]
        raise CheckUnavailable(f"the checking tools can't run in the sandbox ({last}); "
                               "reinstall memory-engine with: .venv/bin/pip install -e .")
    _tools_ready[key] = True


def check_python(workspace: Path, target: str, content: str) -> list[Problem]:
    """Compile, lint, type-check and test a draft in a sandboxed copy; the first failure only.

    Every tool runs as `python -P -m …`, so files in the workspace can't stand in for the tools.
    """
    _ensure_tools()
    python = sys.executable
    with tempfile.TemporaryDirectory(prefix="doctor-") as folder:
        copy = Path(folder)
        _copy_workspace(Path(workspace), copy)
        draft = copy / target
        if not draft.parent.resolve().is_relative_to(copy.resolve()):
            raise CheckUnavailable(f"{target} goes through a link out of the workspace")
        try:
            draft.parent.mkdir(parents=True, exist_ok=True)
            draft.write_text(content, encoding="utf-8")
        except OSError as err:
            raise CheckUnavailable(f"{target} can't be written for checking: {err}") from err
        steps = [
            ("compile", "py_compile", [python, "-P", "-m", "py_compile", target], 60),
            ("lint", "ruff", [python, "-P", "-m", "ruff", "check", "--isolated", "--no-cache", "--output-format",
                              "concise", "--select", "E4,E7,E9,F", target], 60),
            ("lint", "mypy", [python, "-P", "-m", "mypy", "--ignore-missing-imports", "--no-error-summary",
                              "--cache-dir", "/tmp/mypy-cache", target], 60),
        ]
        if _has_tests(copy):
            steps.append(("test", "pytest", [python, "-P", "-m", "pytest", "-q", "-x", "--no-header",
                                             "-p", "no:cacheprovider", "-o", "pythonpath=."], 120))
        for kind, check, argv, timeout in steps:
            result = run_sandboxed(argv, copy, timeout)
            if result.returncode == 0:
                continue
            if check == "pytest" and result.returncode == 5:
                return [Problem(kind, check, "pytest collected no tests, although the workspace has test files")]
            return [Problem(kind, check, result.output.strip() or f"{check} stopped with exit code {result.returncode}")]
    return []


def check_scene(content: str) -> list[Problem]:
    """A film scene: the spec's YAML keys, then exactly a visual prompt and a voiceover."""
    def problem(trace: str) -> Problem:
        return Problem("format", "scene", trace)

    try:
        meta, body = split_frontmatter(content)
    except (yaml.YAMLError, RecursionError, ValueError) as err:
        return [problem(f"the YAML header can't be read: {' '.join(str(err).split())}")]
    problems: list[Problem] = []
    if content.splitlines()[:1] != ["---"]:
        problems.append(problem("the file needs a YAML header with a title"))
    for key in ("title", *SCENE_KEYS):
        value = meta.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            if key != "title" or content.splitlines()[:1] == ["---"]:
                problems.append(problem(f"the YAML header needs {key}"))
        elif key == "scene_number":
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                problems.append(problem("scene_number must be a whole number from 1 up"))
        elif not isinstance(value, str):
            problems.append(problem(f"{key} must be text"))
        elif len(value) > MAX_FIELD:
            problems.append(problem(f"{key} must be at most {MAX_FIELD} characters"))

    sections: list[tuple[str, list[str]]] = [("", [])]
    for line in body.splitlines():
        if line.startswith("## "):
            sections.append((line[3:].strip(), []))
        else:
            sections[-1][1].append(line)
    stray = "\n".join(sections[0][1]).strip()
    if [name for name, _ in sections[1:]] != SCENE_SECTIONS or stray:
        problems.append(problem('the scene needs exactly two sections: "## Visual prompt" and "## Voiceover"'))
    else:
        for name, lines in sections[1:]:
            if not "\n".join(lines).strip():
                problems.append(problem(f"the {name} section is empty"))
    tag = html_tag(body)
    if tag is not None:
        problems.append(problem(f"HTML tags are not allowed: {tag}"))
    return problems


def _render(content: str) -> tuple[int | None, str]:
    """Run the Marp CLI on `content` in the sandbox; (exit code, output whose last line is the slide count)."""
    node = shutil.which("node")
    if node is None or not MARP_CLI.exists():
        raise CheckUnavailable("slide decks can't be checked: install Node.js, then run: npm ci --prefix tools/marp")
    node_home = Path(node).resolve().parents[1]
    # Paths go in as arguments, never pasted into the script, so spaces in them can't break it.
    script = ('"$1" "$2" deck.md -o deck.html >marp.log 2>&1 || { cat marp.log; exit 3; }; '
              'grep -o "<svg data-marpit-svg" deck.html | wc -l')
    with tempfile.TemporaryDirectory(prefix="doctor-") as folder:
        (Path(folder) / "deck.md").write_text(content, encoding="utf-8")
        result = run_sandboxed(["/bin/sh", "-c", script, "marp", node, str(MARP_CLI)], Path(folder), 60,
                               read_only=(MARP_DIR, node_home))
    if result.returncode is None:
        raise CheckUnavailable("the Marp tool did not finish within 60 s")
    return result.returncode, result.output


def _ensure_marp() -> None:
    """Render a known-good deck once, so a broken Marp install is never blamed on a slide."""
    key = f"{MARP_CLI}"
    if _marp_ready.get(key):
        return
    code, output = _render(_KNOWN_GOOD_DECK)
    lines = output.strip().splitlines()
    if code != 0 or not lines or lines[-1].strip() != "1":
        first = next((line for line in lines if line.strip()), "no output")
        raise CheckUnavailable(f"the Marp tool doesn't work ({first.strip()[:200]}); "
                               "reinstall it with: npm ci --prefix tools/marp")
    _marp_ready[key] = True


def render_deck(content: str) -> int:
    """Render a deck with the Marp CLI in the sandbox and return how many slides it made."""
    _ensure_marp()
    code, output = _render(content)
    lines = output.strip().splitlines()
    if code != 0 or not lines or not lines[-1].strip().isdigit():
        raise DeckRenderError(output.strip() or f"marp stopped with exit code {code}")
    return int(lines[-1])


def check_slide(slide: str) -> list[Problem]:
    """One slide as the model wrote it: one heading-led slide, closed code blocks, no breaks, short, no HTML."""
    def problem(trace: str) -> Problem:
        return Problem("format", "slide", trace)

    text = slide.strip()
    fence: str | None = None
    separator, rule = False, None
    for line in text.splitlines():
        marker = FENCE.match(line)
        if fence is None and marker:
            fence = marker.group(1)
        elif fence is not None:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
                fence = None
        elif _SLIDE_BREAK.match(line):
            separator = True
        elif rule is None and _RULE_LINE.match(line):
            rule = line.strip()
    problems: list[Problem] = []
    if separator:
        problems.append(problem("the slide has a line of ---, which starts a new slide; put one slide in each step"))
    if fence is not None:
        problems.append(problem("the slide opens a code block without closing it"))
    if not text.startswith("# "):
        problems.append(problem('the slide must start with a "# heading" line'))
    if rule is not None:
        problems.append(problem(f"the slide has a line of {rule}, which Marp reads as a new slide"))
    words = len(_WORD.findall(text))
    if words > MAX_SLIDE_WORDS:
        problems.append(problem(f"the slide has {words} words; the limit is {MAX_SLIDE_WORDS}"))
    tag = html_tag(text)
    if tag is not None:
        problems.append(problem(f"HTML tags are not allowed: {tag}"))
    return problems


def _rule_line(slide: str) -> str | None:
    fence: str | None = None
    for line in slide.splitlines():
        marker = FENCE.match(line)
        if fence is None and marker:
            fence = marker.group(1)
        elif fence is not None and marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
            fence = None
        elif fence is None and _RULE_LINE.match(line):
            return line.strip()
    return None


def check_deck(content: str) -> list[Problem]:
    """A Marp deck: the Markdown rules, marp: true, clean slide breaks, and a render with the same slide count."""
    def problem(trace: str) -> Problem:
        return Problem("format", "marp", trace)

    problems = [problem(p.trace) for p in check_markdown(content)]
    try:
        meta, body = split_frontmatter(content)
    except (yaml.YAMLError, RecursionError, ValueError):
        meta, body = {}, strip_frontmatter(content)
    if meta.get("marp") is not True:
        problems.append(problem("the YAML header needs marp: true"))
    slides = _slides(body)
    for number, slide in enumerate(slides, start=1):
        if not slide.strip():
            problems.append(problem(f"slide {number} is empty"))
        elif (rule := _rule_line(slide)) is not None:
            problems.append(problem(f"slide {number} has a line of {rule}, which Marp reads as a new slide"))
    if problems:
        return problems
    try:
        rendered = render_deck(content)
    except DeckRenderError as err:
        return [problem(f"Marp could not render the deck: {str(err)[-500:]}")]
    if rendered != len(slides):
        return [problem(f"Marp made {rendered} slides but the deck has {len(slides)}")]
    return []


def _is_deck(content: str) -> bool:
    try:
        return split_frontmatter(content)[0].get("marp") is True
    except (yaml.YAMLError, RecursionError, ValueError):
        return False


def check_file(workspace: Path, target: str, content: str, rules: str = "") -> list[Problem]:
    """`rules` is "scene" or "deck" when the router knows what the file is; decks are also found by marp: true."""
    if rules == "scene":
        return check_scene(content)
    if PurePosixPath(target).suffix == ".py":
        return check_python(workspace, target, content)
    if rules == "deck" or _is_deck(content):
        return check_deck(content)
    return check_markdown(content)
