"""udhcpc.sh refuses untrusted leases; sites only trust a router inside the lease."""

import os
import subprocess
from pathlib import Path

import pytest

from blocker.sites import _router_ok

SCRIPT = Path(__file__).parents[1] / "udhcpc.sh"
FAKE_IP = '#!/bin/sh\nif [ "$2" = route ]; then printf "%b" "$FAKE_ROUTES"; else echo "$*" >> "$LOG"; fi\n'


@pytest.mark.parametrize(
    ("ip", "mask", "routes", "applied"),
    [
        ("192.168.20.7", "24", "", True),
        ("192.168.20.7", "24", "192.168.20.0/24 dev eth0.20 proto kernel\n", True),
        ("192.168.1.7", "24", "192.168.1.0/24 dev eth0 proto kernel\n", False),  # overlaps LAN
        ("192.168.5.7", "16", "192.168.1.0/24 dev eth0 proto kernel\n", False),  # wraps LAN
        ("8.8.8.8", "24", "", False),  # public
        ("10.0.0.5", "8", "", False),  # too wide
        ("10.0.0.5", "30", "default via 192.168.1.1 dev eth0\n", True),
    ],
)
def test_lease_checks(tmp_path, ip, mask, routes, applied):
    (tmp_path / "ip").write_text(FAKE_IP)
    (tmp_path / "ip").chmod(0o755)
    log = tmp_path / "log"
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "LOG": str(log),
           "FAKE_ROUTES": routes, "interface": "eth0.20", "ip": ip, "mask": mask,
           "router": "x"}  # fmt: skip
    subprocess.run(["sh", str(SCRIPT), "bound"], env=env, check=True, capture_output=True)
    assert ("addr add" in log.read_text() if log.exists() else False) is applied


def test_router_must_be_inside_lease():
    assert _router_ok("192.168.20.7", 24, "192.168.20.1")
    assert not _router_ok("192.168.20.7", 24, "192.168.1.1")
    assert not _router_ok("192.168.20.7", 24, "192.168.20.7")
    assert not _router_ok("192.168.20.7", 24, "junk")
