"""Domain normalisation and matching for homework mode."""

import re
from pathlib import Path
from urllib.parse import urlparse

# Load starter list once
_STARTER_PATH = Path(__file__).parent.parent / "data" / "homework_starter.txt"


def _load_starter() -> tuple[str, ...]:
    """Load and parse the starter list."""
    if not _STARTER_PATH.exists():
        return ()
    with open(_STARTER_PATH) as f:
        lines = (line.strip() for line in f)
        # Filter out comments and empty lines
        return tuple(line for line in lines if line and not line.startswith("#"))


STARTER = _load_starter()


def normalize_domain(raw: str) -> str | None:
    """
    Normalize a domain from user input.

    Strips scheme, userinfo, path, query, port and trailing dot.
    Lowercases and IDNA-encodes.
    Returns None if invalid: must have ≥2 labels, each label [a-z0-9-]{1,63}
    with no leading/trailing hyphen, total ≤253 chars.
    """
    raw = raw.strip()
    if not raw:
        return None

    # Parse URL to extract hostname
    if "://" in raw:
        try:
            parsed = urlparse(raw)
            domain = parsed.hostname or parsed.path.split("/")[0]
        except Exception:
            return None
    else:
        # Treat as domain with possible port/path
        domain = raw.split("/")[0].split("?")[0]

    # Remove port if present
    if ":" in domain:
        domain = domain.rsplit(":", 1)[0]

    # Remove userinfo if present (before @)
    if "@" in domain:
        domain = domain.split("@", 1)[1]

    # Remove trailing dot
    domain = domain.rstrip(".")

    # Lowercase
    domain = domain.lower()

    # Validate format
    if not domain or len(domain) > 253:
        return None

    labels = domain.split(".")
    if len(labels) < 2:
        return None

    # Validate each label
    label_pattern = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
    for label in labels:
        if not label or not label_pattern.match(label):
            return None

    # Try IDNA encoding
    try:
        return domain.encode("idna").decode("ascii")
    except Exception:
        return None


def domain_matches(name: str, entry: str) -> bool:
    """
    Check if a name matches an entry.

    True when equal, or when name ends with "." + entry.
    """
    if name == entry:
        return True
    return name.endswith("." + entry)
