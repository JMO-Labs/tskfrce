"""Device name and type guessing from DHCP fingerprints and mDNS hints."""

# DHCP option-55 fingerprints mapped to device type guesses
# See: https://dhcp-fingerprint.github.io/
FINGERPRINT_HINTS = {
    # iPhone/iPad (common option sequences)
    "1,121,3,6,15,119,252,95": "iPhone",
    "1,121,3,6,15,119,252": "iPhone",
    "1,3,6,15,119,252,95": "iPhone",
    "1,3,6,15,119": "iPhone",
    # Android phones
    "1,33,3,6,7,31,42": "Android phone",
    "1,3,6,7,31,42,66": "Android phone",
    "1,3,6,7,31": "Android phone",
    # Google Nest (various products)
    "1,33,3,6,15": "Google device",
    # Nintendo Switch
    "1,121,33,3,6,15,119,252,95": "Nintendo Switch",
    "1,3,6,15,252": "Nintendo Switch",
    # PlayStation
    "1,3,6,15,119,120,121": "PlayStation",
    "1,3,6,15,120,121": "PlayStation",
    # Xbox
    "1,3,6,15,26,44,47": "Xbox",
    "1,3,6,15,44": "Xbox",
    # Smart TV
    "1,3,6,15,119,120,121": "Smart TV",
    "1,15,3,6,44,46": "Smart TV",
    # Windows PC
    "1,15,3,6,44,46,47,31,33,249,43": "Windows PC",
    "1,15,3,6,44,46,47": "Windows PC",
    # Mac
    "1,3,6,15,119,120,121": "Mac",
    # Chromebook
    "1,121,3,6,15,119,252": "Chromebook",
    "1,3,6,15,252": "Chromebook",
}


def guess_device_type_from_fingerprint(dhcp_fp: str | None, mdns_name: str | None) -> str | None:
    """Guess device type from DHCP fingerprint or mDNS hints.

    Returns a friendly device type string like "iPhone", "Windows PC", etc.
    Returns None if unable to guess.
    """
    if not dhcp_fp:
        return None

    # ponytail: simple lookup; upgrade to machine learning if accuracy matters
    return FINGERPRINT_HINTS.get(dhcp_fp)


def guess_maker_from_signals(dhcp_fp: str | None, mdns_name: str | None) -> str | None:
    """Guess maker/brand for private MAC addresses from DHCP/mDNS signals.

    Returns a vendor name like "Apple", "Google", "Samsung", etc.
    Returns None if unable to guess.
    """
    if not mdns_name and not dhcp_fp:
        return None

    # mDNS hints for private addresses
    if mdns_name:
        lower = mdns_name.lower()
        if "apple" in lower or "iphone" in lower or "ipad" in lower:
            return "Apple"
        if "google" in lower or "nest" in lower:
            return "Google"
        if "samsung" in lower:
            return "Samsung"

    # ponytail: simple heuristics; could expand with DHCP fingerprint analysis
    return None


def display_device_name(
    mdns_name: str | None, hostname: str | None, dhcp_fp: str | None, vendor: str | None
) -> tuple[str, str]:
    """Choose the best device display name and return (name, source).

    Priority: mDNS name > hostname > fingerprint guess > vendor guess > "Unknown device".
    source is one of: "mdns", "hostname", "fingerprint", "vendor", "unknown".
    """
    if mdns_name:
        return mdns_name, "mdns"
    if hostname:
        return hostname, "hostname"

    device_type = guess_device_type_from_fingerprint(dhcp_fp, mdns_name)
    if device_type:
        return device_type, "fingerprint"

    if vendor:
        return f"{vendor} device", "vendor"

    return "Unknown device", "unknown"
