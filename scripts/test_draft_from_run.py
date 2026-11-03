import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from draft_from_run import PLATFORMS, validate_assets


class AssetValidation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        for platform, extensions in PLATFORMS.items():
            assets = []
            names = []
            for ext in extensions:
                name = f"Kratt-1.3.3-{platform}.{ext}"
                data = b"fixture package"
                (self.folder / name).write_bytes(data)
                assets.append(dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
                names.append(name)
            meta = f"metadata-{platform}.json"
            (self.folder / meta).write_text(json.dumps(dict(commit="abc", version="1.3.3", platform=platform,
                signing="unsigned-preview", verification=["engine-present-in-package", "frozen-engine-smoke"], assets=assets)))
            install = f"INSTALL-{platform}.md"
            (self.folder / install).write_text("Install fixture")
            names += [meta, install]
            (self.folder / f"SHA256SUMS-{platform}.txt").write_text("".join(
                f"{hashlib.sha256((self.folder / name).read_bytes()).hexdigest()}  {name}\n" for name in names))

    def test_complete_matching_set(self):
        self.assertEqual(len(validate_assets(self.folder, "abc", "1.3.3").splitlines()), 15)

    def test_tampered_binary(self):
        (self.folder / "Kratt-1.3.3-windows-x64.exe").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "differs from metadata"):
            validate_assets(self.folder, "abc", "1.3.3")

    def test_wrong_commit(self):
        with self.assertRaisesRegex(ValueError, "Wrong source"):
            validate_assets(self.folder, "other", "1.3.3")

    def test_incomplete_checksums(self):
        (self.folder / "SHA256SUMS-macos-arm64.txt").write_text("")
        with self.assertRaisesRegex(ValueError, "Incomplete checksum"):
            validate_assets(self.folder, "abc", "1.3.3")

    def test_extra_file(self):
        (self.folder / "unexpected.exe").write_bytes(b"extra")
        with self.assertRaisesRegex(ValueError, "unexpected release files"):
            validate_assets(self.folder, "abc", "1.3.3")

    def test_unsafe_checksum_path(self):
        (self.folder / "SHA256SUMS-linux-x86_64.txt").write_text("0  ../escape\n")
        with self.assertRaisesRegex(ValueError, "Unexpected checksum"):
            validate_assets(self.folder, "abc", "1.3.3")


if __name__ == "__main__":
    unittest.main()
