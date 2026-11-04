import pytest
from app.services.homework_domains import normalize_domain, domain_matches, STARTER


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
    assert not any(
        domain_matches("youtube.com", d) or d.endswith("youtube.com") for d in STARTER
    )
