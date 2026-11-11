"""Every CHANGELOG [2.13.0] "Added" bullet maps to a feature guide linked from the guide index."""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FEATURES = ROOT / "docs/guide/features"
RELEASE = "2.13.0"


def _added_bullets() -> list[str]:
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    section = re.search(rf"^## \[{re.escape(RELEASE)}\].*?(?=^## \[|\Z)", text, re.M | re.S)
    assert section, f"CHANGELOG has no [{RELEASE}] section"
    added = re.search(r"^### Added\n(.*?)(?=^### |\Z)", section.group(0), re.M | re.S)
    assert added, "no ### Added block"
    return [m.group(1).strip() for m in re.finditer(r"^- (.+)$", added.group(1), re.M)]


def _coverage() -> dict[str, dict]:
    return {e["item"]: e for e in json.loads((FEATURES / "coverage.json").read_text())["items"]}


def test_every_added_bullet_is_mapped():
    mapped = _coverage()
    missing = [b for b in _added_bullets() if b not in mapped]
    assert not missing, f"CHANGELOG bullets with no coverage.json entry: {missing}"


def test_no_stale_entries():
    bullets = set(_added_bullets())
    stale = [i for i in _coverage() if i not in bullets]
    assert not stale, f"coverage.json entries not in CHANGELOG: {stale}"


@pytest.mark.parametrize("item", list(_coverage()))
def test_mapped_guides_exist_and_are_linked(item):
    entry = _coverage()[item]
    if entry.get("gap"):
        pytest.xfail(f"known gap, no guide yet: {entry['gap']}")
    assert entry["guides"], f"no guide mapped for: {item}"
    index = (FEATURES / "README.md").read_text(encoding="utf-8")
    for guide in entry["guides"]:
        assert (FEATURES / guide).is_file(), f"missing guide file {guide}"
        assert f"]({guide})" in index, f"{guide} not linked from features/README.md"
