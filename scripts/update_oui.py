#!/usr/bin/env python3
"""Refresh blocker/data/oui.csv from the IEEE MA-L registry.

Run from repo root: python3 scripts/update_oui.py
Output is committed and baked into the blocker image, so lookups stay offline.
"""

import csv
import io
import urllib.request
from pathlib import Path

URL = "https://standards-oui.ieee.org/oui/oui.csv"
OUT = Path(__file__).resolve().parent.parent / "blocker" / "data" / "oui.csv"


def main() -> None:
    # IEEE answers 418 to Python's default User-Agent.
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (tskfrce oui refresh)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf-8")
    rows = csv.reader(io.StringIO(text))
    next(rows)  # Registry,Assignment,Organization Name,Organization Address
    table = {r[1].upper(): r[2].strip() for r in rows if len(r) >= 3 and len(r[1]) == 6}
    if len(table) < 10000:
        raise SystemExit(f"Only {len(table)} prefixes parsed; refusing to overwrite {OUT}")
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["prefix", "vendor"])
        w.writerows(sorted(table.items()))
    print(f"Wrote {len(table)} prefixes to {OUT}")


if __name__ == "__main__":
    main()
