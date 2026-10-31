import socket
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import needs_bwrap
from memory_engine.sandbox import OUTPUT_LIMIT, SandboxUnavailable, run_sandboxed


def run_python(code, workdir, timeout=30):
    return run_sandboxed([sys.executable, "-c", code], workdir, timeout)


@needs_bwrap
def test_runs_a_command_in_its_folder(tmp_path):
    (tmp_path / "a.txt").write_text("hello")
    result = run_python("print(open('a.txt').read())", tmp_path)
    assert result.returncode == 0 and "hello" in result.output


@needs_bwrap
def test_cannot_change_files_outside_its_folder(tmp_path):
    work, outside = tmp_path / "work", tmp_path / "outside.txt"
    work.mkdir()
    outside.write_text("safe")
    result = run_python(f"open({str(outside)!r}, 'w').write('changed')", work)
    assert result.returncode != 0 and outside.read_text() == "safe"


@needs_bwrap
def test_home_and_run_are_hidden(tmp_path):
    result = run_python(f"import os; print([n for n in os.listdir({str(Path.home())!r}) if n.startswith('.')], os.listdir('/run'))", tmp_path)
    assert result.output.strip() == "[] []"


@needs_bwrap
def test_network_is_blocked(tmp_path):
    server = socket.create_server(("127.0.0.1", 0))
    try:
        result = run_python(f"import socket; socket.create_connection(('127.0.0.1', {server.getsockname()[1]}), 2)", tmp_path)
    finally:
        server.close()
    assert result.returncode != 0


@needs_bwrap
def test_endless_code_times_out(tmp_path):
    result = run_python("while True: pass", tmp_path, timeout=1)
    assert result.returncode is None and result.output.endswith("timed out after 1 s")


@needs_bwrap
def test_memory_hog_is_stopped(tmp_path):
    assert run_python("x = bytearray(3 * 1024**3)", tmp_path).returncode != 0


def test_missing_bubblewrap_is_explained(tmp_path, monkeypatch):
    monkeypatch.setattr("memory_engine.sandbox.shutil.which", lambda name: None)
    with pytest.raises(SandboxUnavailable, match="install bubblewrap"):
        run_python("print(1)", tmp_path)


@needs_bwrap
def test_sandbox_cannot_read_the_callers_input(tmp_path):
    inner = "import sys; print(repr(sys.stdin.read()))"
    code = ("import sys; from pathlib import Path; from memory_engine.sandbox import run_sandboxed; "
            f"print(run_sandboxed([sys.executable, '-c', {inner!r}], Path({str(tmp_path)!r}), 30).output)")
    done = subprocess.run([sys.executable, "-c", code], input="typed secret", capture_output=True, text=True)
    assert "typed secret" not in done.stdout and "''" in done.stdout


@needs_bwrap
def test_endless_output_is_cut_off(tmp_path):
    result = run_python("import sys\nfor _ in range(3000): sys.stdout.write('x' * 100000)", tmp_path)
    assert result.returncode != 0 and len(result.output) <= OUTPUT_LIMIT + 200


@needs_bwrap
def test_filling_the_disk_is_limited(tmp_path):
    code = "for i in range(30):\n    open(f'/tmp/f{i}', 'wb').write(b'x' * 15 * 1024 * 1024)"
    assert run_python(code, tmp_path).returncode != 0


@needs_bwrap
def test_writes_never_reach_the_callers_folder(tmp_path):
    result = run_python("open('new.txt', 'w').write('x'); print('wrote')", tmp_path)
    assert "wrote" in result.output and not (tmp_path / "new.txt").exists()


@needs_bwrap
def test_process_count_is_limited(tmp_path, monkeypatch):
    monkeypatch.setattr("memory_engine.sandbox.NPROC_EXTRA", 20)
    code = ("import subprocess\nn = 0\nfor _ in range(60):\n    try:\n        subprocess.Popen(['sleep', '3'])\n"
            "        n += 1\n    except OSError:\n        break\nprint('started', n)")
    started = int(run_python(code, tmp_path).output.split("started ")[1].split()[0])
    assert started < 60
