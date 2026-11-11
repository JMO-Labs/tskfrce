"""Release notes pages for scripts/build_site.py: docs/releases/*.md -> site/releases/*.html."""

import html as html_lib
import re
from pathlib import Path

from site_templates import standalone_page


def _version_key(path):
    return tuple(int(n) for n in re.findall(r"\d+", path.stem))


def _title(md_text, fallback):
    m = re.search(r"^#\s+(.+?)\s*$", md_text, re.MULTILINE)
    return m.group(1) if m else fallback


def _links(html):
    """Release-note links: ../guide/x.md -> ../guide/x.html, 2.10.0.md -> 2.10.0.html."""
    html = re.sub(r'href="(\.\./guide/[^"]+)\.md([#"])', r'href="\1.html\2', html)
    return re.sub(r'href="(\d+\.\d+\.\d+)\.md([#"])', r'href="\1.html\2', html)


def build_releases(source, output, render):
    """Write one page per release plus index.html (newest first). Returns the versions built."""
    files = sorted(Path(source).glob("*.md"), key=_version_key, reverse=True)
    if not files:
        return []
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    titles = {f.stem: _title(f.read_text(), f.stem) for f in files}

    def sidebar(current):
        links = '<a href="index.html" class="guide-chapter-link">All releases</a>\n'
        for v in titles:
            cur = ' active" aria-current="page' if v == current else ""
            links += f'<a href="{v}.html" class="guide-chapter-link{cur}">{html_lib.escape(v)}</a>\n'
        return links

    for f in files:
        html = render(f.read_text())
        html = re.sub(r"<h1[^>]*>.+?</h1>\n?", "", html, count=1, flags=re.DOTALL)
        page = standalone_page(
            titles[f.stem], sidebar(f.stem), f"Releases › {f.stem}", "", _links(html),
            f"releases/{f.name}", releases=True,
        )
        (output / f"{f.stem}.html").write_text(page)

    items = "".join(
        f'<li><a href="{v}.html">{html_lib.escape(t)}</a></li>\n' for v, t in titles.items()
    )
    body = f"<p>What changed in each version, newest first.</p>\n<ul>\n{items}</ul>\n"
    index = standalone_page(
        "Release notes", sidebar(None), "Releases", "", body, "releases/", releases=True
    )
    (output / "index.html").write_text(index)
    return list(titles)
