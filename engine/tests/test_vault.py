import errno
import os
import shutil

import pytest

from memory_engine.frontmatter import split_frontmatter
from memory_engine import vault as vault_module
from memory_engine.vault import MAX_UPLOAD, NotEnoughSpace, UploadTooLarge, Vault, VaultError, sanitize_name



@pytest.mark.parametrize("rel", ["/etc/x.md", "../x.md", ".study/layout.json", "a/.git/x.md", "a\x00b.md", ""])
def test_paths_outside_the_study_folder_are_refused(tmp_path, rel):
    with pytest.raises(VaultError, match="is not a path in the Study folder"):
        Vault(tmp_path).resolve(rel)


def test_names_are_made_safe():
    assert sanitize_name(' Cells: a/b? ') == "Cells- a-b-"
    assert sanitize_name("  ") == "Untitled"


def test_snapshot_reads_folders_and_files_and_gives_missing_ids(tmp_path):
    (tmp_path / "Biology" / "Cells").mkdir(parents=True)
    (tmp_path / "Biology" / "Cells" / "Krebs cycle.md").write_text("Runs in the matrix.\n")
    (tmp_path / ".study").mkdir()
    (tmp_path / ".hidden").mkdir()
    snap = Vault(tmp_path).snapshot()
    assert snap["folders"] == ["Biology", "Biology/Cells"]
    [page] = snap["files"]
    assert page["path"] == "Biology/Cells/Krebs cycle.md" and len(page["id"]) == 32 and page["body"].strip() == "Runs in the matrix."
    assert split_frontmatter((tmp_path / "Biology/Cells/Krebs cycle.md").read_text())[0]["id"] == page["id"]


def test_write_with_the_right_version_replaces_the_file(tmp_path):
    vault = Vault(tmp_path)
    first = vault.write("Notes.md", "One.\n", create=True)
    second = vault.write("Notes.md", "Two.\n", base_version=first["version"])
    assert vault.read("Notes.md") == ("Two.\n", second["version"]) and second["clash"] is None


def test_a_stale_version_keeps_both_texts(tmp_path):
    vault = Vault(tmp_path)
    first = vault.write("Krebs cycle.md", "Mine.\n", create=True)
    (tmp_path / "Krebs cycle.md").write_text("Changed by hand.\n")
    result = vault.write("Krebs cycle.md", "My new typing.\n", base_version=first["version"])
    assert result["clash"].startswith("Krebs cycle (from disk ") and result["clash"].endswith(".md")
    assert (tmp_path / result["clash"]).read_text() == "Changed by hand.\n"
    assert vault.read("Krebs cycle.md")[0] == "My new typing.\n"


def test_creating_twice_picks_free_names(tmp_path):
    vault = Vault(tmp_path)
    assert [vault.write("Notes.md", "x", create=True)["path"] for _ in range(3)] == ["Notes.md", "Notes (2).md", "Notes (3).md"]
    assert [vault.mkdir("Biology") for _ in range(2)] == ["Biology", "Biology (2)"]


def test_move_picks_a_free_name(tmp_path):
    vault = Vault(tmp_path)
    vault.write("a.md", "A", create=True)
    vault.write("b.md", "B", create=True)
    assert vault.move("a.md", "b.md") == "b (2).md" and not (tmp_path / "a.md").exists()


def test_trash_keeps_the_old_path(tmp_path):
    vault = Vault(tmp_path)
    vault.mkdir("Biology")
    vault.write("Biology/Cells.md", "x", create=True)
    kept = vault.trash("Biology/Cells.md")
    assert kept.startswith(".study/trash/") and kept.endswith("/Biology/Cells.md") and (tmp_path / kept).read_text() == "x"


def test_layout_round_trip(tmp_path):
    vault = Vault(tmp_path)
    assert vault.read_layout() == {}
    vault.write_layout({"subjects": ["a1"], "colors": {"a1": "#4c90f0"}})
    assert vault.read_layout() == {"subjects": ["a1"], "colors": {"a1": "#4c90f0"}}


def test_uploads_only_go_into_sources_files(tmp_path):
    vault = Vault(tmp_path)
    assert vault.upload("Sources/files/lecture.pdf", [b"%PDF"], 4) == "Sources/files/lecture.pdf"
    with pytest.raises(VaultError, match="Sources/files"):
        vault.upload("Biology/x.pdf", [b"%PDF"], 4)


def test_upload_streams_chunks(tmp_path):
    vault = Vault(tmp_path)
    assert vault.upload("Sources/files/a.bin", [b"one", b"two", b"three"], 11) == "Sources/files/a.bin"
    assert (tmp_path / "Sources/files/a.bin").read_bytes() == b"onetwothree"


def test_upload_short_body_leaves_nothing(tmp_path):
    vault = Vault(tmp_path)
    with pytest.raises(VaultError, match="upload ended early"):
        vault.upload("Sources/files/a.bin", [b"abcd"], 10)
    assert list((tmp_path / "Sources/files").iterdir()) == []


def test_upload_that_fails_midway_leaves_nothing(tmp_path):
    def chunks():
        yield b"abcd"
        raise ConnectionResetError("the app went away")

    with pytest.raises(ConnectionResetError):
        Vault(tmp_path).upload("Sources/files/a.bin", chunks(), 10)
    assert list((tmp_path / "Sources/files").iterdir()) == []


def test_upload_refuses_when_disk_full(tmp_path, monkeypatch):
    monkeypatch.setattr(vault_module.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(0, 0, 3_100_000_000))
    with pytest.raises(NotEnoughSpace) as refused:
        Vault(tmp_path).upload("Sources/files/a.bin", [b"x"], 12_400_000_000)
    assert str(refused.value) == "Not enough space on disk (needs 12.4 GB, 3.1 GB free)"
    assert isinstance(refused.value, VaultError) and not (tmp_path / "Sources").exists()


def test_disk_filling_up_during_the_write_is_not_enough_space(tmp_path, monkeypatch):
    monkeypatch.setattr(vault_module.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(0, 0, 3_100_000_000))

    def chunks():
        yield b"abcd"
        raise OSError(errno.ENOSPC, "No space left on device")

    with pytest.raises(NotEnoughSpace, match=r"^Not enough space on disk \(needs 0.0 GB, 3.1 GB free\)$"):
        Vault(tmp_path).upload("Sources/files/a.bin", chunks(), 10)
    assert list((tmp_path / "Sources/files").iterdir()) == []


def test_check_upload_runs_the_upload_checks_without_writing(tmp_path, monkeypatch):
    vault = Vault(tmp_path)
    vault.check_upload("Sources/files/a.bin", 10)
    with pytest.raises(VaultError, match="Sources/files"):
        vault.check_upload("Biology/a.bin", 10)
    with pytest.raises(UploadTooLarge):
        vault.check_upload("Sources/files/a.bin", MAX_UPLOAD + 1)
    monkeypatch.setattr(vault_module.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(0, 0, 5))
    with pytest.raises(NotEnoughSpace):
        vault.check_upload("Sources/files/a.bin", 10)
    assert not (tmp_path / "Sources").exists()


def test_upload_over_limit(tmp_path):
    assert MAX_UPLOAD == 50_000_000_000
    with pytest.raises(UploadTooLarge):
        Vault(tmp_path).upload("Sources/files/a.bin", [b"x"], MAX_UPLOAD + 1)


def test_upload_clash_gets_number(tmp_path):
    vault = Vault(tmp_path)
    vault.upload("Sources/files/a.bin", [b"first"], 5)
    assert vault.upload("Sources/files/a.bin", [b"second"], 6) == "Sources/files/a (2).bin"
    assert (tmp_path / "Sources/files/a.bin").read_bytes() == b"first"
    assert (tmp_path / "Sources/files/a (2).bin").read_bytes() == b"second"


def test_saving_keeps_the_file_mode_and_new_files_follow_the_umask(tmp_path):
    vault = Vault(tmp_path)
    page = tmp_path / "Page.md"
    page.write_text("---\nid: p1\n---\nOld\n")
    page.chmod(0o640)
    vault.write("Page.md", "---\nid: p1\n---\nNew\n", base_version=vault.read("Page.md")[1])
    assert page.stat().st_mode & 0o777 == 0o640

    umask = os.umask(0o022)
    try:
        vault.write("Fresh.md", "Text\n", create=True)
        (tmp_path / "Hand.md").write_text("Hand\n")
        vault.snapshot()  # gives Hand.md an id and writes it back
    finally:
        os.umask(umask)
    assert (tmp_path / "Fresh.md").stat().st_mode & 0o777 == 0o644
    assert (tmp_path / "Hand.md").stat().st_mode & 0o777 == 0o644


def test_names_are_kept_short_enough_for_any_file_system():
    name = sanitize_name("é" * 300)
    assert len(name.encode("utf-8")) <= 200 and name == "é" * 100


def test_the_kept_disk_version_is_its_own_page(tmp_path):
    vault = Vault(tmp_path)
    first = vault.write("Krebs.md", "---\nid: k1\ntitle: Krebs\n---\nOne\n", create=True)
    (tmp_path / "Krebs.md").write_text("---\nid: k1\ntitle: Krebs\n---\nChanged by hand\n")
    clash = vault.write("Krebs.md", "---\nid: k1\ntitle: Krebs\n---\nTwo\n", base_version=first["version"])["clash"]
    meta, body = split_frontmatter((tmp_path / clash).read_text())
    assert meta["id"] != "k1" and meta["title"].startswith("Krebs (from disk ") and body == "Changed by hand\n"
    assert {f["id"] for f in vault.snapshot()["files"]} == {"k1", meta["id"]}


def test_original_markdown_is_opaque_and_unchanged(tmp_path):
    vault = Vault(tmp_path)
    original = b'# My original\nNo metadata.\n'
    path = vault.upload('Sources/files/Folder/note.md', [original], len(original))
    snapshot = vault.snapshot()
    assert snapshot['files'] == []
    assert 'Sources/files/Folder' not in snapshot['folders']
    assert (tmp_path / path).read_bytes() == original


def test_crash_parts_cleaned_but_originals_and_other_hidden_files_kept(tmp_path):
    directory = tmp_path / 'Sources/files/nested'
    directory.mkdir(parents=True)
    stale = directory / ('.kratt-upload-' + 'a' * 24 + '.part')
    stale.write_bytes(b'incomplete')
    original = directory / 'file.bin'
    original.write_bytes(b'complete')
    hidden = directory / '.personal.part'
    hidden.write_bytes(b'private')
    Vault(tmp_path)
    assert not stale.exists()
    assert original.read_bytes() == b'complete'
    assert hidden.read_bytes() == b'private'


def test_concurrent_uploads_never_replace_each_other(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    vault = Vault(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(lambda i: vault.upload('Sources/files/same.bin', [bytes([i])], 1), range(8)))
    assert len(set(paths)) == 8
    assert sorted((tmp_path / path).read_bytes() for path in paths) == [bytes([i]) for i in range(8)]


def test_originals_do_not_follow_symlinks(tmp_path):
    (tmp_path / 'Sources').mkdir()
    (tmp_path / 'Biology').mkdir()
    (tmp_path / 'Sources/files').symlink_to(tmp_path / 'Biology', target_is_directory=True)
    with pytest.raises(VaultError, match='symbolic links'):
        Vault(tmp_path).upload('Sources/files/a.txt', [b'x'], 1)
