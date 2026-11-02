"""Device identity helpers: MAC vendor lookup and friendly display names."""

import csv
import re
from pathlib import Path

_OUI_PATH = Path(__file__).parent / "data" / "oui.csv"
_MAX_NAME = 100


def _load() -> dict[str, str]:
    with _OUI_PATH.open(newline="", encoding="utf-8") as f:
        rows = csv.reader(f)
        next(rows, None)
        return {r[0].upper(): r[1] for r in rows if len(r) >= 2}


_OUI = _load()
PRIVATE_MAC = "Private MAC"


# ponytail: MA-L (24-bit) prefixes only; MA-M/MA-S sub-blocks resolve to the parent block's owner.
def vendor_for(mac: str) -> str | None:
    hexes = re.sub(r"[^0-9A-Fa-f]", "", mac).upper()
    if len(hexes) < 6:
        return None
    # Locally-administered bit = randomized MAC (iOS/Android/Windows privacy); no vendor exists.
    if int(hexes[:2], 16) & 0x02:
        return PRIVATE_MAC
    return _OUI.get(hexes[:6])


def friendly_name(hostname: str | None, vendor: str | None) -> str:
    if hostname:
        name = hostname
    elif vendor:
        name = f"{vendor} device"
    else:
        name = "Unknown device"
    return name[:_MAX_NAME]
