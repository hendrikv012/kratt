"""The Study folder as files: the only code that writes it for the study app.

Paths are always relative to the folder, checked to stay inside it and away from hidden
folders. Writes are atomic. A write based on an old version keeps both texts. Deleting
moves into .study/trash/, and .study/layout.json holds what files can't (order, colors).
"""

import errno
import hashlib
import json
import os
import re
import secrets
import shutil
import threading
import uuid
from collections.abc import Iterable, Iterator
from datetime import date, datetime
from pathlib import Path, PurePosixPath

import yaml

from memory_engine.frontmatter import atomic_write, atomic_write_bytes, join_frontmatter, split_frontmatter

STUDY_DIR = ".study"
LAYOUT = f"{STUDY_DIR}/layout.json"
TRASH = f"{STUDY_DIR}/trash"
UPLOADS = ("Sources", "files")
MAX_UPLOAD = 50 * 1000**3  # 50 GB, matching upload panel and disk-space messages
_ACTIVE_UPLOADS: set[Path] = set()
_NAMING = threading.Lock()  # two uploads finishing at once mustn't pick the same free name
_BAD_NAME = re.compile(r'[/\\:*?"<>|\x00-\x1f\x7f]')
MAX_NAME_BYTES = 200  # file systems allow 255; this leaves room for " (2)", " (from disk …)" and ".md"


class VaultError(ValueError):
    pass


class UploadTooLarge(VaultError):
    pass


class NotEnoughSpace(VaultError):
    pass


def sanitize_name(name: str) -> str:
    """A file or folder name every file system accepts; the real title stays in the YAML."""
    cleaned = _BAD_NAME.sub("-", name).strip().lstrip(".").strip()
    cleaned = cleaned.encode("utf-8")[:MAX_NAME_BYTES].decode("utf-8", "ignore").strip()
    return cleaned or "Untitled"


def version_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _jsonable(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


class Vault:
    def __init__(self, root: Path):
        self.root = Path(root)
        # Only our recognizable temporary uploads; completed originals are never swept.
        uploads = self.root / "Sources" / "files"
        if uploads.exists() and not uploads.is_symlink():
            for folder, dirs, files in os.walk(uploads):
                dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
                for name in files:
                    if re.fullmatch(r"\.kratt-upload-[0-9a-f]{24}\.part", name):
                        path = Path(folder) / name
                        with _NAMING:
                            if path not in _ACTIVE_UPLOADS:
                                path.unlink(missing_ok=True)

    # ---------- paths

    def resolve(self, rel: str) -> Path:
        """The absolute path for `rel`, which must stay inside the folder and out of hidden folders."""
        def refuse() -> VaultError:
            return VaultError(f"{rel!r} is not a path in the Study folder")

        if not rel or any(ord(c) < 32 or ord(c) == 127 for c in rel):
            raise refuse()
        relative = PurePosixPath(rel)
        if relative.is_absolute() or ".." in relative.parts or any(p.startswith(".") for p in relative.parts):
            raise refuse()
        path = self.root / relative
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise refuse()
        return path

    def _rel(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    @staticmethod
    def _free(path: Path) -> Path:
        """`path`, or the first free `name (n)` beside it."""
        if not path.exists():
            return path
        stem, suffix = (path.stem, path.suffix) if path.suffix else (path.name, "")
        number = 2
        while (candidate := path.with_name(f"{stem} ({number}){suffix}")).exists():
            number += 1
        return candidate

    # ---------- reading

    def walk(self) -> Iterator[tuple[Path, list[str], list[str]]]:
        """os.walk over the folder without hidden folders and files (.study, temp files of writes)."""
        for folder, dirnames, filenames in os.walk(self.root):
            # Originals are opaque attachments, even .md/.txt. Never rewrite their
            # headers, load huge text originals, index them or treat folders as subjects.
            dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and not (Path(folder) / d).is_symlink()
                                and (Path(folder) / d).relative_to(self.root).parts[:2] != UPLOADS)
            yield Path(folder), dirnames, sorted(f for f in filenames if not f.startswith("."))

    def snapshot(self) -> dict:
        """Every folder and .md file; files without an id get one written into their YAML."""
        folders: list[str] = []
        files: list[dict] = []
        self.root.mkdir(parents=True, exist_ok=True)
        for folder, dirnames, filenames in self.walk():
            folders += [self._rel(folder / d) for d in dirnames]
            files += [self._entry(folder / name) for name in filenames if name.endswith(".md")]
        return {"folders": sorted(folders), "files": sorted(files, key=lambda f: f["path"]),
                "layout": self.read_layout()}

    def _entry(self, path: Path) -> dict:
        data = path.read_bytes()
        text = data.decode("utf-8", errors="replace")
        try:
            meta, body = split_frontmatter(text)
        except (yaml.YAMLError, RecursionError, ValueError):
            meta, body = {}, text
            file_id = f"path:{self._rel(path)}"  # unreadable header: never rewritten, identified by path
        else:
            file_id = str(meta.get("id") or "")
            if not file_id:
                file_id = uuid.uuid4().hex
                meta = {"id": file_id, **meta}
                text = join_frontmatter(meta, body)
                atomic_write(path, text)
                data = text.encode("utf-8")
        return {"path": self._rel(path), "id": file_id, "meta": _jsonable(meta), "body": body,
                "version": version_of(data)}

    def read(self, rel: str) -> tuple[str, str]:
        data = self.resolve(rel).read_bytes()
        return data.decode("utf-8", errors="replace"), version_of(data)

    # ---------- writing

    def write(self, rel: str, text: str, base_version: str | None = None, create: bool = False) -> dict:
        """Write `text`. With `create`, pick a free name. If the file changed since `base_version`,
        keep the disk text beside it as `<stem> (from disk <date time>)` and report it as the clash."""
        path = self.resolve(rel)
        if create:
            path = self._free(path)
        clash = None
        if not create and base_version is not None and path.is_file():
            current = path.read_bytes()
            if version_of(current) != base_version:
                stamp = datetime.now().strftime("%Y-%m-%d %H-%M")
                sibling = self._free(path.with_name(f"{path.stem} (from disk {stamp}){path.suffix}"))
                atomic_write_bytes(sibling, self._as_own_page(current, f"(from disk {stamp})", path.stem))
                clash = self._rel(sibling)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, text)
        return {"path": self._rel(path), "version": version_of(text.encode("utf-8")), "clash": clash}

    @staticmethod
    def _as_own_page(data: bytes, note: str, stem: str) -> bytes:
        """A copy of a file as a page of its own: a new id, and its title marked with `note`."""
        try:
            meta, body = split_frontmatter(data.decode("utf-8"))
        except (UnicodeDecodeError, yaml.YAMLError, RecursionError, ValueError):
            return data  # no readable header: the snapshot names it by its path
        if not meta.get("id"):
            return data  # the snapshot gives it an id of its own
        meta = {**meta, "id": uuid.uuid4().hex, "title": f"{meta.get('title') or stem} {note}"}
        return join_frontmatter(meta, body).encode("utf-8")

    def mkdir(self, rel: str) -> str:
        path = self._free(self.resolve(rel))
        path.mkdir(parents=True)
        return self._rel(path)

    def move(self, src: str, dst: str) -> str:
        source, target = self.resolve(src), self.resolve(dst)
        if not source.exists():
            raise VaultError(f"{src!r} does not exist")
        if target != source:
            target = self._free(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.rename(source, target)
        return self._rel(target)

    def trash(self, rel: str) -> str:
        """Move into .study/trash/<time>/<old path>, so nothing deleted is gone for good."""
        source = self.resolve(rel)
        if not source.exists():
            raise VaultError(f"{rel!r} does not exist")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        target = self.root / TRASH / stamp / PurePosixPath(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.rename(source, target)
        return self._rel(target)

    def check_upload(self, rel: str, size: int) -> Path:
        """Where an upload of `size` bytes to `rel` would go; raises if it can't be taken."""
        relative = PurePosixPath(rel)
        if relative.parts[:2] != UPLOADS or len(relative.parts) < 3:
            raise VaultError("uploads only go into Sources/files/")
        target = self.resolve(rel)
        if any(p.is_symlink() for p in [target, *target.parents] if p.is_relative_to(self.root)):
            raise VaultError("uploads cannot follow symbolic links")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise VaultError("size must be a non-negative number of bytes")
        if size > MAX_UPLOAD:
            raise UploadTooLarge("files can be at most 50 GB")
        if shutil.disk_usage(self.root).free < size:
            raise self._no_space(size)
        return target

    def _no_space(self, size: int) -> NotEnoughSpace:
        free = shutil.disk_usage(self.root).free
        return NotEnoughSpace(f"Not enough space on disk (needs {size / 1e9:.1f} GB, {free / 1e9:.1f} GB free)")

    def upload(self, rel: str, chunks: Iterable[bytes], size: int) -> str:
        """Write `size` bytes from `chunks` into Sources/files/. They go to a hidden .part file
        first and only take the real name once all of them are on disk, so a stopped upload
        leaves nothing behind."""
        target = self.check_upload(rel, size)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Its own .part per upload, so two uploads of one name never write into the same file.
        part = target.parent / f".kratt-upload-{secrets.token_hex(12)}.part"
        with _NAMING:
            _ACTIVE_UPLOADS.add(part)
        try:
            with open(part, "wb") as handle:
                total = 0
                for chunk in chunks:
                    total += len(chunk)
                    if total > size:
                        raise VaultError("the upload is longer than its size")
                    handle.write(chunk)
                if total != size:
                    raise VaultError("upload ended early")
                handle.flush()
                os.fsync(handle.fileno())
            with _NAMING:
                while True:
                    path = self._free(target)
                    try:
                        os.link(part, path)  # atomic publication, without replacing an external file
                        part.unlink()
                        break
                    except FileExistsError:
                        continue
        except OSError as err:
            part.unlink(missing_ok=True)
            if err.errno == errno.ENOSPC:  # the disk filled up while writing (other programs write too)
                raise self._no_space(size) from err
            raise
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        finally:
            with _NAMING:
                _ACTIVE_UPLOADS.discard(part)
        return self._rel(path)

    # ---------- layout

    def read_layout(self) -> dict:
        try:
            layout = json.loads((self.root / LAYOUT).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return layout if isinstance(layout, dict) else {}

    def write_layout(self, layout: dict) -> None:
        path = self.root / LAYOUT
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, json.dumps(layout, indent=2, ensure_ascii=False) + "\n")
