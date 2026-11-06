from app.core.config import Settings


def test_defaults():
    s = Settings()
    assert s.NTFY_UPSTREAM_URL == "https://ntfy.sh"
    assert s.NTFY_UPSTREAM_TOKEN is None


def test_trailing_slash_stripped_and_empty_stays_off():
    assert Settings(NTFY_UPSTREAM_URL="https://ntfy.example.net/").NTFY_UPSTREAM_URL == (
        "https://ntfy.example.net"
    )
    assert Settings(NTFY_UPSTREAM_URL="").NTFY_UPSTREAM_URL == ""
