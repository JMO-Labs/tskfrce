"""The scapy pieces the blocker uses, without the catch-all module (~33MB less RSS on small boxes).

Every layer the blocker reads is imported here, before any sniffer starts, so captured
frames dissect exactly as before. Import scapy names from this module only.
"""

from scapy.arch import get_if_addr, get_if_hwaddr
from scapy.config import conf
from scapy.layers.dhcp import BOOTP, DHCP
from scapy.layers.dns import DNS, DNSQR, DNSRR
from scapy.layers.inet import IP, UDP
from scapy.layers.inet6 import (
    ICMPv6EchoRequest,
    ICMPv6ND_NA,
    ICMPv6NDOptDstLLAddr,
    IPv6,
    getmacbyip6,
)
from scapy.layers.l2 import ARP, Dot1Q, Ether, getmacbyip
from scapy.packet import Raw
from scapy.sendrecv import AsyncSniffer, send, sendp, sniff, srp

__all__ = [
    "ARP",
    "BOOTP",
    "DHCP",
    "DNS",
    "DNSQR",
    "DNSRR",
    "IP",
    "UDP",
    "AsyncSniffer",
    "Dot1Q",
    "Ether",
    "ICMPv6EchoRequest",
    "ICMPv6NDOptDstLLAddr",
    "ICMPv6ND_NA",
    "IPv6",
    "Raw",
    "conf",
    "get_if_addr",
    "get_if_hwaddr",
    "getmacbyip",
    "getmacbyip6",
    "send",
    "sendp",
    "sniff",
    "srp",
]
