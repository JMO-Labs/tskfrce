import pytest
from app.services.homework_domains import STARTER, domain_matches, normalize_domain


@pytest.mark.parametrize(
    "raw,want",
    [
        ("https://Classroom.Google.com/u/0/", "classroom.google.com"),
        ("khanacademy.org.", "khanacademy.org"),
        ("  docs.google.com:443 ", "docs.google.com"),
        ("user@site.example.com/x?y=1", "site.example.com"),
    ],
)
def test_normalize_ok(raw, want):
    assert normalize_domain(raw) == want


@pytest.mark.parametrize(
    "raw",
    ["", "localhost", "-bad.com", "a..b.com", "x" * 254 + ".com", "http://", "*.google.com"],
)
def test_normalize_rejects(raw):
    assert normalize_domain(raw) is None


def test_matches_subdomain():
    assert domain_matches("a.b.google.com", "google.com")
    assert not domain_matches("notgoogle.com", "google.com")


def test_starter_is_normalized_and_has_no_youtube():
    assert STARTER and all(normalize_domain(d) == d for d in STARTER)
    assert not any(domain_matches("youtube.com", d) or d.endswith("youtube.com") for d in STARTER)


@pytest.mark.parametrize(
    "zone",
    [
        "storage.googleapis.com",
        "firebasestorage.googleapis.com",
        "evil-site.googleusercontent.com",
        "anyone.sharepoint.com",
        "sites.google.com",
        "blogspot.com",
        "github.io",
        "web.app",
        "pages.dev",
    ],
)
def test_starter_has_no_user_content_zones(zone):
    """Hosts anyone can publish to must not be covered by the starter list."""
    assert not any(domain_matches(zone, d) for d in STARTER)


def test_starter_keeps_specific_google_hosts():
    assert any(domain_matches("lh3.googleusercontent.com", d) for d in STARTER)
    assert any(domain_matches("fonts.googleapis.com", d) for d in STARTER)
