import os

import pytest

from memory_engine.frontmatter import split_frontmatter
from memory_engine.vault import Vault, VaultError, sanitize_name



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
    assert vault.upload("Sources/files/lecture.pdf", b"%PDF") == "Sources/files/lecture.pdf"
    with pytest.raises(VaultError, match="Sources/files"):
        vault.upload("Biology/x.pdf", b"%PDF")


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
