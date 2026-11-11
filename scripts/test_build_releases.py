"""Tests for the release-notes pages built by scripts/build_site.py.

Run: python -m unittest scripts/test_build_releases.py (needs the `markdown` package)."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

try:
    import build_site
    from build_releases import build_releases
except SystemExit:  # build_site exits when markdown is missing
    build_site = None


@unittest.skipIf(build_site is None, "markdown package not installed")
class ReleasePages(unittest.TestCase):
    def build(self):
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "releases"
        src.mkdir()
        (src / "2.9.0.md").write_text("# 2.9.0: Homework\n\nSee [guide](../guide/04-everyday-use.md#x).\n")
        (src / "2.10.0.md").write_text("# 2.10.0: Goals\n\nBack to [2.9.0](2.9.0.md).\n")
        out = tmp / "out"
        build_releases(src, out, build_site.markdown_to_html)
        return out

    def test_page_per_release(self):
        out = self.build()
        page = (out / "2.10.0.html").read_text()
        self.assertIn("Goals", page)
        self.assertIn('href="2.9.0.html"', page)
        self.assertIn('href="../guide/04-everyday-use.html#x"', (out / "2.9.0.html").read_text())

    def test_index_newest_first(self):
        index = (self.build() / "index.html").read_text()
        self.assertLess(index.index('href="2.10.0.html"'), index.index('href="2.9.0.html"'))

    def test_release_pages_link_back_to_guide(self):
        page = (self.build() / "2.9.0.html").read_text()
        self.assertIn('href="../guide/index.html"', page)


if __name__ == "__main__":
    unittest.main()
