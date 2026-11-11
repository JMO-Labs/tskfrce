"""Golden fixtures for contract suite testing.

Defines fixture schemas and validation for:
- DHCP request frames
- mDNS query and answer frames
- DNS query frames
- VLAN 802.1Q frames
- ARP spoofing examples
- Corrupted/malformed variants

Fixtures are stored as JSON with hex-encoded frames for use by both
Python (pytest) and Go (go test) implementations.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class FrameFixture:
    """A captured or constructed network frame."""

    name: str
    description: str
    frame_hex: str  # Hex string of frame bytes
    expected_parsing: dict[str, Any]  # Expected parse result

    def bytes(self) -> bytes:
        """Get frame as bytes."""
        return bytes.fromhex(self.frame_hex)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict."""
        return {
            "name": self.name,
            "description": self.description,
            "frame_hex": self.frame_hex,
            "expected_parsing": self.expected_parsing,
        }


def load_fixtures(fixture_dir: Path | str = ".") -> dict[str, FrameFixture]:
    """Load all fixtures from JSON files."""
    fixture_dir = Path(fixture_dir)
    fixtures = {}

    for json_file in fixture_dir.glob("fixtures-*.json"):
        with open(json_file) as f:
            data = json.load(f)
            for frame_data in data.get("frames", []):
                fixture = FrameFixture(
                    name=frame_data["name"],
                    description=frame_data["description"],
                    frame_hex=frame_data["frame_hex"],
                    expected_parsing=frame_data.get("expected_parsing", {}),
                )
                fixtures[fixture.name] = fixture

    return fixtures


def save_fixtures(fixtures: list[FrameFixture], output_file: Path | str) -> None:
    """Save fixtures to JSON file."""
    output_file = Path(output_file)
    data = {
        "frames": [f.to_dict() for f in fixtures],
    }
    with open(output_file, "w") as f:
        json.dump(data, f, indent=2)


# Golden fixture definitions
DHCP_REQUEST = FrameFixture(
    name="dhcp_request_example",
    description="Example DHCP DISCOVER request from a device",
    frame_hex=(
        "ffffffffffff"  # dst MAC (broadcast)
        "aabbccddeeff"  # src MAC (client)
        "0800"  # EtherType: IPv4
        "45"  # version + IHL
        "00"  # DSCP + ECN
        "0144"  # Total length
        "00000000"  # Identification, flags, fragment offset
        "40"  # TTL
        "11"  # Protocol: UDP
        "39a5"  # Checksum
        "00000000"  # src IP: 0.0.0.0
        "ffffffff"  # dst IP: 255.255.255.255
        "0044"  # src port: 68 (DHCP client)
        "0043"  # dst port: 67 (DHCP server)
        "0130"  # length
        "0000"  # checksum
        "01"  # message type: BOOTREQUEST
        "01aabbccddeeff"  # htype + hlen + chaddr start
        "0000000000000000000000000000"  # chaddr padding
        + "00" * 64  # sname (64 bytes)
        + "00" * 128  # file (128 bytes)
        + "63825363"  # magic cookie
        "350101"  # option 53: DHCP Message Type = DHCPDISCOVER
        "ff"  # end option
    ),
    expected_parsing={
        "frame_type": "DHCP",
        "message_type": "BOOTREQUEST",
        "client_mac": "aa:bb:cc:dd:ee:ff",
        "is_dhcp_discover": True,
    },
)

MDNS_QUERY = FrameFixture(
    name="mdns_query_example",
    description="Example mDNS PTR query for _device-info._tcp.local",
    frame_hex=(
        "01005e0000fb"  # dst MAC: 01:00:5e:00:00:fb (mDNS multicast)
        "aabbccddeeff"  # src MAC
        "0800"  # EtherType: IPv4
        "45"  # version + IHL
        "00"  # DSCP + ECN
        "0056"  # Total length: 86 bytes
        "0000"  # Identification
        "0000"  # flags + fragment offset
        "ff"  # TTL: 255
        "11"  # Protocol: UDP
        "0000"  # Checksum
        "c0a80101"  # src IP: 192.168.1.1
        "e00000fb"  # dst IP: 224.0.0.251 (mDNS multicast)
        "e5e9"  # src port: 58857
        "14e9"  # dst port: 5353 (mDNS)
        "0042"  # length: 66
        "0000"  # checksum
        "0000"  # Transaction ID: 0
        "0000"  # Flags: standard query
        "0001"  # Questions: 1
        "0000"  # Answer RRs: 0
        "0000"  # Authority RRs: 0
        "0000"  # Additional RRs: 0
        "0b5f646576696365"  # Label: _device
        "2d696e666f04"  # Label: -info
        "5f746370"  # Label: _tcp
        "05"  # Label length: 5
        "6c6f63616c"  # Label: local
        "00"  # Root label
        "000c"  # Type: PTR
        "8001"  # Class: IN, cache flush
    ),
    expected_parsing={
        "frame_type": "mDNS",
        "query_type": "PTR",
        "query_name": "_device-info._tcp.local",
        "source_ip": "192.168.1.1",
    },
)

DNS_QUERY = FrameFixture(
    name="dns_query_example",
    description="Example DNS A query",
    frame_hex=(
        "aabbccddee00"  # dst MAC: gateway
        "aabbccddeeff"  # src MAC: device
        "0800"  # EtherType: IPv4
        "45"  # version + IHL
        "00"  # DSCP + ECN
        "003c"  # Total length: 60
        "0000"  # Identification
        "4000"  # flags + fragment offset
        "40"  # TTL: 64
        "11"  # Protocol: UDP
        "0000"  # Checksum
        "c0a80102"  # src IP: 192.168.1.2
        "08080808"  # dst IP: 8.8.8.8
        "d1a3"  # src port: 53667
        "0035"  # dst port: 53 (DNS)
        "0028"  # length: 40
        "0000"  # checksum
        "abcd"  # Transaction ID
        "0100"  # Flags: standard query
        "0001"  # Questions: 1
        "0000"  # Answer RRs: 0
        "0000"  # Authority RRs: 0
        "0000"  # Additional RRs: 0
        "06676f6f676c"  # "google"
        "6503636f6d"  # ".com"
        "00"  # root
        "0001"  # Type: A
        "0001"  # Class: IN
    ),
    expected_parsing={
        "frame_type": "DNS",
        "query_type": "A",
        "query_name": "google.com",
        "source_ip": "192.168.1.2",
    },
)

VLAN_802_1Q = FrameFixture(
    name="vlan_802_1q_example",
    description="Example VLAN-tagged (802.1Q) Ethernet frame",
    frame_hex=(
        "aabbccddee00"  # dst MAC
        "aabbccddeeff"  # src MAC
        "8100"  # EtherType: 802.1Q
        "000a"  # VLAN tag: VID=10, priority=0
        "0800"  # Inner EtherType: IPv4
        "45"  # version + IHL
        "00"  # DSCP
        "001c"  # Total length: 28
        "0000"  # Identification
        "4000"  # flags
        "40"  # TTL
        "11"  # Protocol: UDP
        "0000"  # Checksum
        "c0a80a02"  # src IP: 192.168.10.2
        "c0a80a01"  # dst IP: 192.168.10.1
        "0044"  # src port: 68
        "0043"  # dst port: 67
        "0008"  # length
        "0000"  # checksum
        "0000"  # DHCP payload (minimal)
    ),
    expected_parsing={
        "frame_type": "VLAN",
        "vlan_id": 10,
        "inner_type": "IPv4",
        "source_mac": "aa:bb:cc:dd:ee:ff",
    },
)

ARP_REPLY = FrameFixture(
    name="arp_reply_example",
    description="Example ARP reply (used for spoofing redirection)",
    frame_hex=(
        "aabbccddee00"  # dst MAC: device
        "112233445566"  # src MAC: box (spoofed as gateway)
        "0806"  # EtherType: ARP
        "0001"  # Hardware type: Ethernet
        "0800"  # Protocol type: IPv4
        "06"  # Hardware size: 6
        "04"  # Protocol size: 4
        "0002"  # Operation: ARP reply
        "112233445566"  # sender hardware address (box MAC)
        "c0a80101"  # sender protocol address (gateway IP)
        "aabbccddeeff"  # target hardware address (device MAC)
        "c0a80102"  # target protocol address (device IP)
    ),
    expected_parsing={
        "frame_type": "ARP",
        "operation": "reply",
        "sender_mac": "11:22:33:44:55:66",
        "sender_ip": "192.168.1.1",
        "target_mac": "aa:bb:cc:dd:ee:ff",
        "target_ip": "192.168.1.2",
    },
)

CORRUPTED_DNS = FrameFixture(
    name="corrupted_dns_query",
    description="Malformed DNS query (truncated)",
    frame_hex=(
        "aabbccddee00"  # dst
        "aabbccddeeff"  # src
        "0800"
        "45000000"  # minimal IPv4
        "4011"  # TTL + protocol
        "0000c0a80102c0a80101"  # IPs
        "d1a3003500000000"  # UDP header
        "abcd"  # Transaction ID
    ),
    expected_parsing={
        "frame_type": "DNS",
        "parsing_status": "corrupted",
    },
)


def create_default_fixtures() -> list[FrameFixture]:
    """Return list of all golden fixtures."""
    return [
        DHCP_REQUEST,
        MDNS_QUERY,
        DNS_QUERY,
        VLAN_802_1Q,
        ARP_REPLY,
        CORRUPTED_DNS,
    ]


if __name__ == "__main__":
    # Save fixtures to JSON file
    import sys

    fixtures = create_default_fixtures()
    output_path = Path(__file__).parent / "fixtures-golden.json"
    save_fixtures(fixtures, output_path)
    print(f"Saved {len(fixtures)} fixtures to {output_path}")
    sys.exit(0)
