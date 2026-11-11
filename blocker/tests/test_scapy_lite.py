"""Small boxes: the blocker never loads scapy.all (~33MB), yet dissects every layer it reads."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_blocker_code_never_imports_scapy_all():
    offenders = [p.name for p in (ROOT / "blocker").glob("*.py") if "scapy.all" in p.read_text()]
    assert offenders == []


def test_lite_loads_without_scapy_all():
    code = "import sys, blocker.scapy_lite; print('scapy.all' in sys.modules)"
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, check=True
    )
    assert out.stdout.strip().splitlines()[-1] == "False"


def test_lite_dissects_dhcp_and_dns_from_raw_bytes():
    from blocker.scapy_lite import BOOTP, DHCP, DNS, DNSQR, IP, UDP, Ether

    dhcp = Ether(bytes(Ether() / IP() / UDP(sport=68, dport=67) / BOOTP() / DHCP(options=["end"])))
    dns = Ether(bytes(Ether() / IP() / UDP(sport=5353, dport=5353) / DNS(qd=DNSQR(qname="a."))))
    assert dhcp.haslayer(DHCP) and dns.haslayer(DNS)
