"""build_site.py renders every docs/guide/features/*.md to site/guide/features/*.html."""

import sys
from pathlib import Path

import pytest

pytest.importorskip("markdown")  # CI installs it for this test; the app itself doesn't need it
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))


def test_features_pages_are_generated(tmp_path, monkeypatch):
    import build_site

    monkeypatch.chdir(ROOT)
    monkeypatch.setattr(build_site, "SITE_OUTPUT", tmp_path / "guide")
    monkeypatch.setattr(build_site, "IMG_OUTPUT", tmp_path / "guide" / "img")
    build_site.build_site()

    out = tmp_path / "guide" / "features"
    for src in (ROOT / "docs/guide/features").glob("*.md"):
        name = "index.html" if src.name == "README.md" else src.with_suffix(".html").name
        assert (out / name).exists(), name
    assert (out / "homework.html").exists()
    index = (out / "index.html").read_text()
    assert 'href="homework.html"' in index
    assert 'href="../styles.css"' not in index  # one level deeper: ../../styles.css
    assert 'href="../../styles.css"' in index
    # guide nav and guide home link to the section
    assert "features/index.html" in (tmp_path / "guide" / "index.html").read_text()
    assert "features/index.html" in (tmp_path / "guide" / "01-what-you-need.html").read_text()
