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


def test_feature_guides_empty_when_source_dir_missing(tmp_path, monkeypatch):
    import build_site

    monkeypatch.setattr(build_site, "FEATURES_SOURCE", tmp_path / "nope")
    assert build_site.feature_guides() == []


def test_site_check_and_home_cover_every_feature_guide():
    """Each docs/guide/features/*.md is in FEATURES (check.mjs) and linked from the home page."""
    check = (ROOT / "site/check.mjs").read_text()
    home = (ROOT / "site/index.html").read_text()
    for src in (ROOT / "docs/guide/features").glob("*.md"):
        if src.name == "README.md":
            continue
        assert f"'{src.stem}'" in check, src.stem
        assert f'href="guide/features/{src.stem}.html"' in home, src.stem
    for phrase in ("multi-network", "block page", "relink", "mobile data"):
        assert phrase in home.lower(), phrase


def test_feature_page_links_to_docs_go_to_github():
    """Feature pages sit two folders deep, so ../../blocker.md must also map to GitHub."""
    import build_site

    html = build_site.rewrite_links(
        '<a href="../../blocker.md">b</a> <a href="../../routers.md">r</a>', Path("features/x.md")
    )
    assert "../../" not in html
    assert html.count("https://github.com/JMO-Labs/tskfrce/blob/main/docs/") == 2
