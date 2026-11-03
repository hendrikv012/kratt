"""Create an unsigned draft from a successful native CI run, without rebuilding binaries."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

PLATFORMS = {
    "linux-x86_64": ["AppImage", "deb", "tar.gz"],
    "macos-arm64": ["dmg"],
    "macos-x86_64": ["dmg"],
    "windows-x64": ["exe", "msi"],
}


def gh_json(*args):
    return json.loads(subprocess.check_output(["gh", *args], text=True))


def validate_assets(folder, commit, version):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Release version must be MAJOR.MINOR.PATCH")
    expected_files, combined = set(), []
    for platform, extensions in PLATFORMS.items():
        names = {f"Kratt-{version}-{platform}.{ext}" for ext in extensions}
        metadata_name = f"metadata-{platform}.json"
        metadata = json.loads((folder / metadata_name).read_text())
        if (metadata["commit"], metadata["version"], metadata["platform"], metadata["signing"]) != (commit, version, platform, "unsigned-preview"):
            raise ValueError(f"Wrong source/version/platform/signing metadata: {platform}")
        if not {"engine-present-in-package", "frozen-engine-smoke"}.issubset(metadata["verification"]):
            raise ValueError(f"Missing engine verification: {platform}")
        if {a["name"] for a in metadata["assets"]} != names:
            raise ValueError(f"Wrong package set: {platform}")
        for asset in metadata["assets"]:
            data = (folder / asset["name"]).read_bytes()
            if len(data) != asset["bytes"] or hashlib.sha256(data).hexdigest() != asset["sha256"]:
                raise ValueError(f"Package differs from metadata: {asset['name']}")
        names |= {metadata_name, f"INSTALL-{platform}.md"}
        checksum_name = f"SHA256SUMS-{platform}.txt"
        seen = set()
        for line in (folder / checksum_name).read_text().splitlines():
            digest, name = line.split("  ", 1)
            if name not in names or name in seen:
                raise ValueError(f"Unexpected checksum entry: {name}")
            if hashlib.sha256((folder / name).read_bytes()).hexdigest() != digest:
                raise ValueError(f"Checksum mismatch: {name}")
            seen.add(name)
            combined.append(line)
        if seen != names:
            raise ValueError(f"Incomplete checksum set: {platform}")
        expected_files |= names | {checksum_name}
    if {p.name for p in folder.iterdir()} != expected_files:
        raise ValueError("Missing or unexpected release files")
    return "\n".join(combined) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    args = parser.parse_args()
    if not args.run_id.isdigit():
        raise ValueError("Run ID must be numeric")
    repo = os.environ["GITHUB_REPOSITORY"]
    run = gh_json("api", f"repos/{repo}/actions/runs/{args.run_id}")
    if (run["conclusion"] != "success" or run["head_repository"]["full_name"] != repo
            or run["path"] != ".github/workflows/build-release.yml"
            or run["event"] not in {"push", "workflow_dispatch"}):
        raise ValueError("Use a successful build-release run from this repository")
    jobs = gh_json("api", f"repos/{repo}/actions/runs/{args.run_id}/jobs?per_page=100")["jobs"]
    passed = {job["name"] for job in jobs if job["conclusion"] == "success"}
    if not (set(PLATFORMS) | {"verify"}).issubset(passed):
        raise ValueError("All four native builds and frontend verification must pass")
    commit = run["head_sha"]
    subprocess.run(["git", "fetch", "--depth=1", "origin", commit], check=True)
    manifest = json.loads(subprocess.check_output(["git", "show", f"{commit}:apps/study/package.json"], text=True))
    version = manifest["version"]
    with tempfile.TemporaryDirectory(prefix="kratt-draft-") as temporary:
        root = Path(temporary)
        assets = root / "assets"
        assets.mkdir()
        for platform in PLATFORMS:
            subprocess.run(["gh", "run", "download", args.run_id, "--repo", repo,
                            "--name", f"Kratt-{platform}-unsigned", "--dir", str(assets)], check=True)
        checksums = validate_assets(assets, commit, version)
        (assets / "SHA256SUMS.txt").write_text(checksums)
        notes = root / "notes.md"
        notes.write_bytes(subprocess.check_output(["git", "show", f"{commit}:docs/RELEASE_NOTES.md"]))
        subprocess.run(["gh", "release", "create", f"v{version}", "--repo", repo, "--target", commit,
                        "--draft", "--prerelease", "--title", f"Kratt v{version} — unsigned preview",
                        "--notes-file", str(notes), "--generate-notes",
                        *[str(p) for p in sorted(assets.iterdir())]], check=True)


if __name__ == "__main__":
    main()
