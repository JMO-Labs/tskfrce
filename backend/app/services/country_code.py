"""Country code management from domain service."""

from pathlib import Path

from app.services import network_wifi

# Country code written by edge.sh when it gets CF-IPCountry header
COUNTRY_FILE = Path("/data/cf_country")


def apply_country_code() -> bool:
    """Read country code from edge.sh and apply it."""
    if not COUNTRY_FILE.exists():
        return False

    try:
        cc = COUNTRY_FILE.read_text().strip().upper()
        if len(cc) == 2 and cc.isalpha():
            return network_wifi.set_country(cc)
    except Exception:
        pass
    return False


def get_country_code() -> str:
    """Get the current country code, or 'US' if not set."""
    if COUNTRY_FILE.exists():
        try:
            return COUNTRY_FILE.read_text().strip().upper()
        except Exception:
            pass
    return "US"
