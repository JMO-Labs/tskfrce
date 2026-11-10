"""`scripts/lab.sh pw-version`: the Playwright image tag comes from frontend/package.json."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "frontend" / "package.json"

pytestmark = pytest.mark.skipif(
    not (shutil.which("bash") and shutil.which("jq")), reason="needs bash and jq"
)


def _pw_version(pkg=None):
    env = dict(os.environ)
    if pkg is not None:
        env["LAB_PKG_JSON"] = str(pkg)
    return subprocess.run(
        ["bash", "scripts/lab.sh", "pw-version"],
        check=False,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )


def _fake_pkg(tmp_path, version):
    dev = {} if version is None else {"@playwright/test": version}
    p = tmp_path / "package.json"
    p.write_text(json.dumps({"devDependencies": dev}))
    return p


def test_pw_version_matches_real_package_json():
    want = json.loads(PKG.read_text())["devDependencies"]["@playwright/test"].lstrip("^~")
    r = _pw_version()
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == want


@pytest.mark.parametrize("raw", ["^1.65.0", "~1.65.0", "1.65.0"])
def test_pw_version_strips_range_prefix(tmp_path, raw):
    r = _pw_version(_fake_pkg(tmp_path, raw))
    assert r.returncode == 0, r.stderr
    assert r.stdout == "1.65.0\n"


@pytest.mark.parametrize(
    "raw", ["latest", ">=1.60.0", "1.x", "", None, "1.65.0; rm -rf /", "^~1.65.0"]
)
def test_pw_version_rejects_bad_values(tmp_path, raw):
    r = _pw_version(_fake_pkg(tmp_path, raw))
    assert r.returncode != 0
    assert r.stdout == ""
    assert r.stderr.strip()


def test_bump_needs_no_compose_edit(tmp_path):
    """Regression for #71: bumping @playwright/test alone moves the e2e image."""
    r = _pw_version(_fake_pkg(tmp_path, "1.65.0"))
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "1.65.0"
    if not shutil.which("docker"):
        return
    images = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "lab/docker-compose.lab.yml",
            "--profile",
            "e2e",
            "config",
            "--images",
        ],
        check=False,
        cwd=ROOT,
        env={**os.environ, "PW_VERSION": r.stdout.strip(), "INTERNAL_TOKEN": "labtoken"},
        capture_output=True,
        text=True,
    )
    assert images.returncode == 0, images.stderr
    assert "mcr.microsoft.com/playwright:v1.65.0-jammy" in images.stdout.split()


def test_suite_collects_without_jq(tmp_path):
    """The default (non-docker) suite must not need jq just to import the lab conftest."""
    (tmp_path / "bash").symlink_to(shutil.which("bash"))  # PATH holds bash but no jq
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/lab", "--collect-only", "-q"],
        check=False,
        cwd=ROOT / "blocker",
        env={**os.environ, "PATH": str(tmp_path), "PYTHONPATH": str(ROOT)},
        capture_output=True,
        text=True,
    )
    assert r.returncode in (0, 5), r.stdout + r.stderr  # 5 = all deselected
