#!/usr/bin/env python3
"""
Build script to generate the t@sk4ce guide as static HTML pages.
Converts markdown guide files to styled HTML pages matching the main site.
"""

import html as html_lib
import re
import shutil
from pathlib import Path

try:
    import markdown
    from markdown.extensions import fenced_code, tables, toc
except ImportError:
    print("Error: markdown package not installed. Install with: pip install markdown")
    exit(1)

from site_templates import (  # noqa: E402 (needs the check above)
    chapter_page,
    nav_card,
    standalone_page,
)

# Configuration
GUIDE_SOURCE = Path("docs/guide")
REMOTE_ACCESS_SOURCE = Path("docs/remote-access.md")
SITE_OUTPUT = Path("site/guide")
IMG_SOURCE = GUIDE_SOURCE / "img"
IMG_OUTPUT = SITE_OUTPUT / "img"

# Guide chapters in order
GUIDE_CHAPTERS = [
    ("README.md", "Beginner's Guide"),
    ("01-what-you-need.md", "1. What you need"),
    ("02-install.md", "2. Install"),
    ("03-first-setup.md", "3. First-time setup"),
    ("04-everyday-use.md", "4. Everyday use"),
    ("05-for-kids.md", "5. For kids"),
    ("06-troubleshooting.md", "6. Troubleshooting"),
    ("07-faq.md", "7. FAQ"),
]

# Standalone pages: (source md, output html, edit-link path under docs/)
STANDALONE = [
    (REMOTE_ACCESS_SOURCE, "remote-access.html", "remote-access.md"),
    (Path("docs/integrations/protocol-v1.md"), "integrations-protocol.html",
     "integrations/protocol-v1.md"),
]

REMOTE_ACCESS_ENTRY = ("remote-access.md", "Remote access (Tailscale)")

# Per-feature guides: docs/guide/features/*.md -> site/guide/features/*.html
FEATURES_SOURCE = GUIDE_SOURCE / "features"
FEATURES_ENTRY = ("features/README.md", "Feature guides")


def ensure_dirs():
    """Create output directories if they don't exist."""
    SITE_OUTPUT.mkdir(parents=True, exist_ok=True)
    IMG_OUTPUT.mkdir(parents=True, exist_ok=True)


def copy_images():
    """Copy images from docs/guide/img to site/guide/img."""
    if IMG_SOURCE.exists():
        for img_file in IMG_SOURCE.glob("*"):
            if img_file.is_file() and img_file.name != "SHOTS.md":
                shutil.copy2(img_file, IMG_OUTPUT / img_file.name)


def extract_headings(html):
    """The page's h2 headings, in order, for the 'On this page' list."""
    headings = []
    for m in re.finditer(r'<h2[^>]*id="([^"]*)"[^>]*>(.*?)</h2>', html, re.DOTALL):
        text = html_lib.unescape(re.sub(r"<[^>]+>", "", m.group(2))).replace("¶", "").strip()
        text = html_lib.escape(text, quote=False)
        headings.append(("h2", text, m.group(1)))
    return headings


def render_toc(headings):
    """'On this page': a row of links to the page's sections."""
    if len(headings) < 2:
        return ""
    items = "".join(f'<li><a href="#{anchor}">{text}</a></li>\n' for _, text, anchor in headings)
    return (
        '<nav class="guide-toc" aria-labelledby="toc-title">\n'
        '<p class="guide-toc-title" id="toc-title">On this page</p>\n'
        f"<ul>\n{items}</ul>\n</nav>\n"
    )


def rewrite_links(html, source_file):
    """Rewrite markdown links to point to the correct locations."""
    # Links to other guide chapters: 0N-x.md[#anchor] -> 0N-x.html[#anchor]
    html = re.sub(r'href="(\d{2}-[^"]+)\.md([#"])', r'href="\1.html\2', html)

    # Feature guides: features/x.md -> features/x.html (the index is features/index.html)
    html = re.sub(r'href="features/README\.md([#"])', r'href="features/index.html\1', html)
    html = re.sub(r'href="(features/[^"/]+)\.md([#"])', r'href="\1.html\2', html)
    # From a feature page back to a chapter: ../0N-x.md -> ../0N-x.html
    html = re.sub(r'href="(\.\./\d{2}-[^"]+)\.md([#"])', r'href="\1.html\2', html)
    # Between feature pages (same folder): x.md -> x.html
    if source_file.parent.name == "features":
        html = re.sub(r'href="(?!README)([^"/:#]+)\.md([#"])', r'href="\1.html\2', html)

    # Links to README.md in guide: README.md[#anchor] -> index.html[#anchor]
    html = re.sub(r'href="README\.md([#"])', r'href="index.html\1', html)

    # Links to remote-access.md: ../remote-access.md or remote-access -> remote-access.html
    html = re.sub(r'href="\.\./remote-access\.md([#"]?)', r'href="remote-access.html\1', html)
    html = re.sub(r'href="remote-access([#"]?)"', r'href="remote-access.html\1"', html)

    # Integrations protocol: ../integrations/protocol-v1.md -> integrations-protocol.html
    html = re.sub(
        r'href="\.\./integrations/protocol-v1\.md([#"]?)', r'href="integrations-protocol.html\1', html
    )

    # Links to engineering.md: ../engineering.md -> ../engineering.html
    html = re.sub(r'href="\.\./engineering\.md"', r'href="../engineering.html"', html)

    # Links to other repo files: docs/*.md, LICENSE, etc -> GitHub URLs
    html = re.sub(
        r'href="\.\./((?:routers|blocker)\.md)"',
        r'href="https://github.com/JMO-Labs/tskfrce/blob/main/docs/\1"',
        html,
    )
    html = re.sub(
        r'href="\.\./\.\./(LICENSE)"',
        r'href="https://github.com/JMO-Labs/tskfrce/blob/main/\1"',
        html,
    )

    return html


def build_page_html(content_html, title, chapters_list, current_idx, headings, prefix="", crumb=""):
    """Build complete HTML page with site styling."""
    # Remove the first <h1> from content (will be in header instead)
    content_html = re.sub(r'<h1[^>]*>.+?</h1>\n?', '', content_html, count=1, flags=re.DOTALL)

    # Find previous and next chapters
    prev_ch = chapters_list[current_idx - 1] if current_idx > 0 else None
    next_ch = chapters_list[current_idx + 1] if current_idx < len(chapters_list) - 1 else None

    prev_link = ""
    if prev_ch:
        prev_file, prev_title = prev_ch
        prev_html = get_output_filename(prev_file)
        prev_link = nav_card(prev_html, "prev", "← Previous", prev_title)

    next_link = ""
    if next_ch:
        next_file, next_title = next_ch
        next_html = get_output_filename(next_file)
        next_link = nav_card(next_html, "next", "Next →", next_title)

    toc_html = render_toc(headings)

    # Build chapter list
    chapter_links = ""
    for i, (ch_file, ch_title) in enumerate(chapters_list):
        ch_url = get_output_filename(ch_file)
        is_active = i == current_idx
        active_class = " active" if is_active else ""
        current = ' aria-current="page"' if is_active else ''
        chapter_links += f'<a href="{ch_url}" class="guide-chapter-link{active_class}"{current}>{ch_title}</a>\n'

    # Build breadcrumb
    breadcrumb = "Guide"
    if crumb:
        breadcrumb = crumb
    elif current_idx > 0:  # Not the intro page
        breadcrumb = f"Guide › {title}"

    # Build chapter summary for mobile (closed by default)
    summary_text = "Chapters" if current_idx == 0 else f"Chapters · {title}"

    return chapter_page(
        title, summary_text, chapter_links, breadcrumb, toc_html, content_html,
        prev_link, next_link, first=not prev_ch, source=prefix + chapters_list[current_idx][0].removeprefix("./"),
    )


def get_output_filename(source_filename):
    """Convert source markdown filename to output HTML filename."""
    if source_filename.endswith("README.md"):
        return source_filename[: -len("README.md")] + "index.html"
    elif source_filename == "remote-access.md":
        return "remote-access.html"
    else:
        return source_filename.replace(".md", ".html")


def markdown_to_html(md_text):
    """Convert markdown to HTML with extensions."""
    md = markdown.Markdown(
        extensions=[
            tables.TableExtension(),
            fenced_code.FencedCodeExtension(),
            toc.TocExtension(permalink=True, permalink_class="header-link"),
        ]
    )
    html = md.convert(md_text)
    return html


def process_guide_file(source_file, all_chapters, chapter_idx, features=False):
    """Process a single guide markdown file and generate HTML."""
    if not source_file.exists():
        print(f"Warning: {source_file} not found, skipping")
        return None

    with open(source_file) as f:
        md_content = f.read()

    # Strip maintainer notes from README
    if source_file.name == "README.md":
        # Remove the "Screenshots in this guide are listed in..." line
        md_content = re.sub(
            r'\nScreenshots in this guide are listed in.*?\n',
            '\n',
            md_content,
            flags=re.DOTALL
        )

    # Convert markdown to HTML
    html = markdown_to_html(md_content)

    # Extract title from first h1 or use chapter title
    title_match = re.search(r"<h1[^>]*>(.+?)</h1>", html, re.DOTALL)
    if title_match:
        # Extract text content, removing any tags
        title_html = title_match.group(1)
        title = re.sub(r"<[^>]+>", "", title_html).strip()
        title = html_lib.unescape(title)
    else:
        title = "t@sk4ce Guide"

    # Clean up title
    title = title.strip("#").strip()
    title = title.rstrip("¶").strip()  # Remove pilcrow from header-link

    # Extract headings for TOC
    headings = extract_headings(html)

    # Rewrite links
    html = rewrite_links(html, source_file)

    # Add copy buttons to code blocks
    html = add_copy_buttons(html)

    # Screenshots load as they scroll into view; tap one to see it full size
    html = re.sub(
        r'<img ([^>]*?)src="([^"]+)"([^>]*)>',
        r'<a class="guide-shot" href="\2"><img loading="lazy" decoding="async" \1src="\2"\3></a>',
        html,
    )

    # Add callout styling
    html = style_callouts(html)

    # Build complete page HTML
    if features:
        return build_feature_page(html, title, all_chapters, chapter_idx, headings)
    return build_page_html(html, title, all_chapters, chapter_idx, headings)


def build_feature_page(html, title, features, idx, headings):
    """A feature page lives one folder deeper: build the shell, push its links up, add the body."""
    marker = "@@BODY@@"
    crumb = "Guide › Feature guides" + (f" › {title}" if idx else "")
    shell = build_page_html(marker, title, features, idx, headings, prefix="features/", crumb=crumb)
    body = re.sub(r'<h1[^>]*>.+?</h1>\n?', '', html, count=1, flags=re.DOTALL)
    return deepen(shell).replace(marker, body)


def deepen(page):
    """Rewrite the page shell's relative links for a page one folder below the guide."""
    def fix(m):
        url = m.group(2)
        if re.match(r"(https?:|#|/|\./)", url):
            return m.group(0)
        return f'{m.group(1)}"../{url}"'
    return re.sub(r'((?:href|src)=)"([^"]*)"', fix, page)


def feature_guides():
    """Feature guides as ("./file", title) pairs: the index first, then the rest by name.

    The "./" keeps their links in the same folder when deepen() moves the shell's other links up."""
    if not FEATURES_SOURCE.is_dir():
        return []
    files = sorted(FEATURES_SOURCE.glob("*.md"), key=lambda f: (f.name != "README.md", f.name))
    entries = []
    for f in files:
        m = re.search(r"^#\s+(.+?)\s*$", f.read_text(), re.MULTILINE)
        entries.append(("./" + f.name, m.group(1) if m else f.stem))
    return entries


def add_copy_buttons(html):
    """Add copy buttons to code blocks."""
    # Pattern to match <pre><code>...</code></pre>
    pattern = r'(<pre><code[^>]*>)(.*?)(</code></pre>)'

    def replace_code_block(match):
        prefix = match.group(1)
        code = match.group(2)
        suffix = match.group(3)
        # Plain text of the code, kept in a data attribute (an inline JS string broke on quotes)
        code_text = html_lib.unescape(re.sub(r"<[^>]+>", "", code)).strip()
        attr = html_lib.escape(code_text, quote=True)
        pre_open = prefix.replace("<pre>", '<pre tabindex="0">')
        button = (
            f'<div class="code-block-wrapper">'
            f'<button class="copy-btn" type="button" data-copy="{attr}" '
            f'onclick="copyToClipboard(this.dataset.copy, this)">📋 Copy</button>'
            f"{pre_open}{code}{suffix}"
            f"</div>"
        )
        return button

    html = re.sub(pattern, replace_code_block, html, flags=re.DOTALL)
    return html


def style_callouts(html):
    """Style callouts for 'You should see:' and warnings."""
    # Style "You should see:" lines (success callout)
    html = re.sub(
        r'<p>You should see:',
        '<p class="callout callout-success">You should see:',
        html,
    )

    # Style warning patterns (soft coral callout)
    warning_patterns = [
        "Warning:",
        "Warning —",
        "Important:",
        "Note:",
        "Caution:",
    ]
    for pattern in warning_patterns:
        html = re.sub(
            rf'<p>({re.escape(pattern)})',
            r'<p class="callout callout-warning">\1',
            html,
        )

    return html


def build_site():
    """Build the entire guide site."""
    print("Building t@sk4ce guide site...")

    ensure_dirs()
    copy_images()

    # Build all guide chapters
    all_chapters = list(GUIDE_CHAPTERS)
    # Add remote-access if it exists
    features = feature_guides()
    if features:
        all_chapters.append(FEATURES_ENTRY)
    if REMOTE_ACCESS_SOURCE.exists():
        all_chapters.append(REMOTE_ACCESS_ENTRY)

    for idx, (source_file, chapter_title) in enumerate(GUIDE_CHAPTERS):
        source_path = GUIDE_SOURCE / source_file
        output_filename = get_output_filename(source_file)
        output_path = SITE_OUTPUT / output_filename

        print(f"  Building {output_filename}...")
        page_html = process_guide_file(source_path, all_chapters, idx)

        if page_html:
            with open(output_path, "w") as f:
                f.write(page_html)

    # Feature guides (own sidebar, one folder deeper)
    if features:
        (SITE_OUTPUT / "features").mkdir(parents=True, exist_ok=True)
    for idx, (source_file, _title) in enumerate(features):
        out_name = get_output_filename(source_file)
        print(f"  Building features/{out_name}...")
        page_html = process_guide_file(FEATURES_SOURCE / source_file, features, idx, features=True)
        (SITE_OUTPUT / "features" / out_name).write_text(page_html)

    # Standalone pages (no chapter nav)
    for source, out_name, edit_path in STANDALONE:
        if not source.exists():
            continue
        print(f"  Building {out_name}...")
        html = markdown_to_html(source.read_text())
        title_match = re.search(r"<h1[^>]*>([^<]+)</h1>", html)
        title = title_match.group(1) if title_match else source.stem

        html = rewrite_links(html, source.name)
        html = add_copy_buttons(html)
        html = style_callouts(html)

        page_html = build_standalone_page(html, title, edit_path)
        (SITE_OUTPUT / out_name).write_text(page_html)

    print("✓ Guide site built successfully!")
    print(f"  Output: {SITE_OUTPUT}")


def build_standalone_page(content_html, title, edit_path="remote-access.md"):
    """Build a standalone page (like remote-access) without chapter navigation."""
    # Remove the first <h1> from content (will be in header instead)
    content_html = re.sub(r'<h1[^>]*>.+?</h1>\n?', '', content_html, count=1, flags=re.DOTALL)

    headings = extract_headings(content_html)
    toc_html = render_toc(headings)

    chapter_links = '<a href="index.html" class="guide-chapter-link">← Back to guide</a>\n'

    # Breadcrumb
    breadcrumb = f"Guide › {title}"

    return standalone_page(title, chapter_links, breadcrumb, toc_html, content_html, edit_path)


if __name__ == "__main__":
    build_site()
