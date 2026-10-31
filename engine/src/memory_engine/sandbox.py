"""Run one command on model-written code inside a bubblewrap sandbox.

The sandbox sees the system read-only, with /home, /root and /run (system sockets) replaced
by tiny empty folders and /tmp by a size-limited one. `workdir` is mounted read-only and copied
into /tmp/work, where the command runs, so nothing it writes reaches the host. There is no
network and no terminal, the environment is cleared, and memory, file size, process count,
output and time are all limited.
"""

import os
import resource
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

SANDBOX_DIR = "/tmp/work"
SOURCE_DIR = "/tmp/source"
MEMORY_LIMIT = 2 * 1024**3  # address space per process
FILE_LIMIT = 16 * 1024**2  # largest file a process may write, its output included
TMP_SIZE = 256 * 1024**2  # all of /tmp inside, the copy of the workspace included
NPROC_EXTRA = 256  # new processes on top of the ones the person already runs
OUTPUT_LIMIT = 4000
_SETUP_FAILED = "memory-engine: the sandbox could not be set up"


class SandboxUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class SandboxResult:
    returncode: int | None  # None: it ran out of time
    output: str


def _user_tasks() -> int:
    """Threads the person already runs; Linux counts them against the process limit."""
    uid, count = os.getuid(), 0
    for entry in os.scandir("/proc"):
        if entry.name.isdigit():
            try:
                if entry.stat().st_uid == uid:
                    count += len(os.listdir(f"/proc/{entry.name}/task"))
            except OSError:
                continue
    return count


def run_sandboxed(argv: list[str], workdir: Path, timeout: float, read_only: tuple[Path, ...] = ()) -> SandboxResult:
    """Run `argv` in a sandboxed copy of `workdir`; `read_only` folders are made visible unchanged."""
    if shutil.which("bwrap") is None:
        raise SandboxUnavailable("Python files can't be checked without a sandbox: install bubblewrap (the bwrap command)")
    tiny = ["--size", str(1024 * 1024)]
    args = ["--ro-bind", "/", "/",
            *tiny, "--tmpfs", "/home", *tiny, "--tmpfs", "/root", *tiny, "--tmpfs", "/run",
            "--size", str(TMP_SIZE), "--tmpfs", "/tmp"]
    for prefix in dict.fromkeys([sys.prefix, sys.base_prefix, *map(str, read_only)]):
        args += ["--ro-bind", prefix, prefix]  # the venv, the Python it was made from, and any tools asked for
    args += ["--dev", "/dev", "--proc", "/proc",
             "--ro-bind", str(Path(workdir).resolve()), SOURCE_DIR, "--chdir", "/tmp",
             "--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
             "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp", "--setenv", "PYTHONDONTWRITEBYTECODE", "1"]
    setup = (f'mkdir {SANDBOX_DIR} && cp -a {SOURCE_DIR}/. {SANDBOX_DIR} '
             f'|| {{ echo "{_SETUP_FAILED}" >&2; exit 125; }}; cd {SANDBOX_DIR} && exec "$@"')
    processes = _user_tasks() + NPROC_EXTRA
    _, hard_processes = resource.getrlimit(resource.RLIMIT_NPROC)
    if hard_processes != resource.RLIM_INFINITY:
        processes = min(processes, hard_processes)

    def limits() -> None:
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT, MEMORY_LIMIT))
        resource.setrlimit(resource.RLIMIT_FSIZE, (FILE_LIMIT, FILE_LIMIT))
        resource.setrlimit(resource.RLIMIT_NPROC, (processes, processes))

    with tempfile.TemporaryFile() as out:  # output goes to a file, so the caller never holds more than its tail
        try:
            done = subprocess.run(["bwrap", *args, "--", "/bin/sh", "-c", setup, "sh", *argv],
                                  stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                                  timeout=timeout, preexec_fn=limits)
            code: int | None = done.returncode
        except subprocess.TimeoutExpired:
            code = None
        out.seek(max(0, out.seek(0, os.SEEK_END) - OUTPUT_LIMIT * 4))
        output = out.read().decode("utf-8", errors="replace")[-OUTPUT_LIMIT:]
    if code == 125 and _SETUP_FAILED in output:
        raise SandboxUnavailable(f"the workspace could not be copied into the sandbox: {output.strip()[-300:]}")
    if code is None:
        output = (output + "\n" if output else "") + f"timed out after {timeout:g} s"
    return SandboxResult(code, output)
