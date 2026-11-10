"""Guards that CONTRIBUTING.md keeps matching what CI runs."""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "CONTRIBUTING.md"
CI = ROOT / ".github" / "workflows" / "ci-cd.yml"

CI_COMMANDS = [
    "ruff format --check backend blocker examples",
    "ruff check backend blocker examples",
    "npm run lint",
    "npm run type-check",
    "python -m pytest tests -q",
    "npm test -- --ci",
    "npm run typecheck",
]


def _doc() -> str:
    return DOC.read_text(encoding="utf-8")


def test_contributing_exists():
    assert DOC.is_file()
    assert _doc().strip()


@pytest.mark.parametrize("cmd", CI_COMMANDS)
def test_contributing_lists_ci_commands(cmd):
    assert cmd in CI.read_text(encoding="utf-8"), f"CI no longer runs {cmd!r}"
    assert cmd in _doc(), f"CONTRIBUTING.md is missing {cmd!r}"


def test_contributing_branch_flow():
    doc = _doc()
    assert "`dev`" in doc and "`main`" in doc
    assert "into `dev`" in doc
    assert "only the owner" in doc.lower()


def test_contributing_commits_and_semver():
    doc = _doc().lower()
    assert "conventional commits" in doc
    assert "semver" in doc or "semantic versioning" in doc
