"""Bundled desktop entry point. No system Python or terminal is needed by the installed app."""
import argparse
import json
import os
import signal
import sys
import threading
from pathlib import Path

from memory_engine.frontmatter import atomic_write
from memory_engine.serve import DEFAULT_PORT, StudyServer, load_study_folder, make_server, _save_config


def _stop_on_terminate(*_) -> None:
    raise KeyboardInterrupt


def _exit_when_stdin_closes(server: StudyServer) -> None:
    try:
        sys.stdin.buffer.read()
    except (OSError, ValueError):
        pass
    server.shutdown()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kratt-engine")
    parser.add_argument("--folder", type=Path)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--ready-file", type=Path)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--exit-with-stdin", action="store_true")
    args = parser.parse_args(argv)
    if args.data_dir:
        root = args.data_dir.expanduser().resolve()
        for name in ("Study", "logs", "temp"):
            (root / name).mkdir(parents=True, exist_ok=True)
        os.environ["MEMORY_ENGINE_CONFIG"] = str(root / "config.json")
        os.environ["KRATT_LOG_DIR"] = str(root / "logs")
        os.environ["KRATT_DESKTOP"] = "1"
        # Refuse corrupt configuration instead of overwriting the remembered folder/preferences.
        config = root / "config.json"
        if config.exists():
            try:
                saved = json.loads(config.read_text(encoding="utf-8"))
                if not isinstance(saved, dict):
                    raise ValueError("expected a JSON object")
            except (OSError, ValueError) as error:
                raise ValueError(f"Cannot read {config}: {error}. Restore its backup before retrying.") from error
        # A remembered folder is explicit user choice; leave it intact across upgrades.
        if not (root / "config.json").exists():
            _save_config(folder=str(root / "Study"), local=True)
        # A desktop install never forwards notes to an online notebook service.
        os.environ["OLLAMA_HOST"] = "127.0.0.1:11434"
        os.environ["OLLAMA_NO_CLOUD"] = "1"
        _save_config(local=True)
    folder = (args.folder or load_study_folder()).expanduser()
    server = make_server(folder, args.port)
    print(f"Study folder: {folder}")
    print(f"Listening on http://127.0.0.1:{server.server_port}", flush=True)
    for name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), _stop_on_terminate)
    if args.exit_with_stdin and sys.stdin is not None:
        threading.Thread(target=_exit_when_stdin_closes, args=(server,), daemon=True).start()
    if args.ready_file:
        atomic_write(args.ready_file, json.dumps({"port": server.server_port, "folder": str(folder)}))
    try:
        server.start_ollama()
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        # serve_forever has already returned; shutdown() here would deadlock if interrupted early.
        server.stopping.set()
        server.server_close()
        if args.ready_file:
            args.ready_file.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
