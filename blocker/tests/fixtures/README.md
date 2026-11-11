# Golden Fixtures

Shared network frame fixtures for blocker contract suite testing.

## Files

- `fixtures-golden.json`: Pre-captured network frames with expected parsing results
- `fixture_schema.py`: Python schema definitions and fixture generation script

## Fixture Format

Each fixture in `fixtures-golden.json` contains:

```json
{
  "name": "unique_fixture_name",
  "description": "Human-readable description",
  "frame_hex": "000102030405...",  // Hex-encoded frame bytes
  "expected_parsing": {             // Expected parse result
    "frame_type": "DHCP",
    "field": "value"
  }
}
```

## Available Fixtures

### DHCP
- `dhcp_request_example`: DHCP DISCOVER from a device

### mDNS
- `mdns_query_example`: PTR query for _device-info._tcp.local

### DNS
- `dns_query_example`: A query for google.com

### VLAN
- `vlan_802_1q_example`: 802.1Q tagged frame (VID=10)

### ARP
- `arp_reply_example`: ARP reply (gateway spoof simulation)

### Corrupted
- `corrupted_dns_query`: Truncated/malformed DNS (for error handling)

## Using Fixtures

### In Python tests:
```python
from blocker.tests.fixtures import load_fixtures

fixtures = load_fixtures("blocker/tests/fixtures/")
dhcp_frame = fixtures["dhcp_request_example"].bytes()
```

### In Go tests:
Load fixtures from `fixtures-golden.json` directly in `go test`.

## Adding New Fixtures

1. Capture or construct a network frame
2. Convert to hex string
3. Define expected parsing result
4. Add to `fixture_schema.py` as a `FrameFixture`
5. Run `python3 fixture_schema.py` to regenerate `fixtures-golden.json`

Example:
```python
MY_FIXTURE = FrameFixture(
    name="my_frame",
    description="Description of what this frame is",
    frame_hex="0011223344...",
    expected_parsing={
        "frame_type": "DHCP",
        "client_mac": "aa:bb:cc:dd:ee:ff",
    },
)
```

Then add to `create_default_fixtures()`.

## Frame Format

Network frames are byte-for-byte captures:

- **Ethernet**: dst MAC (6) + src MAC (6) + EtherType (2) + payload
- **IPv4**: version+IHL + DSCP+ECN + length + ID + flags+offset + TTL + protocol + checksum + src + dst + payload
- **UDP**: src port + dst port + length + checksum + payload
- **VLAN (802.1Q)**: dst MAC + src MAC + 0x8100 + priority+VID (4) + inner EtherType + payload

## Validation

Hex strings are validated for:
- Even character count (valid hex pairs)
- Valid hex characters (0-9, a-f)
- Correct structure (ethertypes, protocols, etc.)

## Reference

See `fixture_schema.py` for complete definitions and validation logic.

## Future

- Add more variants (malformed, edge cases)
- Add frame generation helpers for dynamic testing
- Document frame checksums and how to calculate them
