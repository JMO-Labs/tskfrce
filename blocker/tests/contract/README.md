# Contract Suite

Black-box contract tests for blocker implementations (Python and Go).

Tests are organized by feature (F-number from spec):

## Test Files

### test_api.py (F2–F8)
HTTP API features:
- **F2**: Binding to BLOCKER_BIND:BLOCKER_PORT
- **F3**: Auth checked before body read; 403 for missing/wrong token
- **F4**: Body size cap (64 KiB)
- **F5**: GET /health returns 200 {"ok":true}, no auth required
- **F6**: POST /state with MAC list validation
- **F7**: POST /test-block with MAC
- **F8**: Exact path matching, 404 for unknown paths, JSON responses with Content-Length

**Status**: ✅ All pass on Python blocker

### test_backend.py (F9–F14)
Backend client communication:
- **F9**: Calls to /api/v1/internal with X-Internal-Token header, 5s timeout
- **F10**: Seen dataclass: `vid`/`mdns_name`/`model`/`dhcp_fp` omitted when None, never null
- **F11**: GET /state returns proper structure (blocked, listen_only, covered_vlans)
- **F12**: POST /devices/resisting with sorted MACs, even when empty (heartbeat)
- **F13**: Hits/workarounds only reported when non-empty
- **F14**: VLANs only reported when non-empty

**Status**: ✅ All pass on Python blocker

### test_enforcement.py (F16–F17, F23–F24, F58)
Network enforcement and redirection:
- **F16–F17**: Infrastructure MAC refusal and unsafe IP stripping
- **F23**: ARP/NDP spoof frames both directions every 2s
- **F24**: Heal sequence (4 rounds, 1.2s apart, truthful MACs)
- **F58**: Fail-open (SIGTERM deletes nft table within 10s, heals all devices)

**Status**: ⏳ Requires Docker container + network inspection (integration)

### test_signals.py (F40–F43)
Signal parsing and validation:
- **F40**: DHCP fingerprint format (option 55 comma-joined)
- **F41**: mDNS query periodicity (every 300s)
- **F42**: mDNS answer validation (A record match, MAC match)
- **F43**: Signal reporting (only known MACs, only when new/changed)

**Status**: ⏳ Requires Docker container + packet capture (integration)

### test_portal.py (F44–F45)
Captive portal:
- **F44**: DNS portal (UDP :53, A-only, TTL 30, correct flags)
- **F45**: HTTP portal (302 redirect, Content-Length: 0, no logging)

**Status**: ⏳ Requires Docker container + DNS/HTTP simulation (integration)

## Running Tests

### All non-integration tests (Python blocker):
```bash
pytest blocker/tests/contract/ -v
```

### Specific test class:
```bash
pytest blocker/tests/contract/test_api.py::TestF2Binding -v
```

### With coverage:
```bash
pytest blocker/tests/contract/test_api.py blocker/tests/contract/test_backend.py --cov=blocker
```

### Integration tests (Docker required):
```bash
BLOCKER_IMAGE=python pytest blocker/tests/contract/ -v -m integration
```

Or for Go implementation (once available):
```bash
BLOCKER_IMAGE=go pytest blocker/tests/contract/ -v -m integration
```

## Fixtures

### Golden Frame Fixtures
Located in `blocker/tests/fixtures/`:
- `fixtures-golden.json`: Pre-captured network frames (DHCP, mDNS, DNS, VLAN, ARP, corrupted variants)
- `fixture_schema.py`: Schema definitions and validation

These fixtures are used by both Python and Go test suites to ensure consistent parsing.

## Implementation Notes

### Black-box Testing
Contract tests are designed to be implementation-agnostic:
- Test external API (HTTP requests/responses)
- Test backend communication (call shapes, timing)
- Test network behavior (frames, redirection)
- Do NOT introspect internal state or implementation details

### Feature Mapping
Each test class corresponds to a feature in `docs/superpowers/specs/2026-11-10-go-blocker-design.md`.

### Test Structure
- Unit tests: Backend client functions (test_backend.py)
- Integration tests: Requires running blocker (test_enforcement.py, test_signals.py, test_portal.py)
- Container tests: `BLOCKER_IMAGE` env var selects Python or Go blocker

## Future Work

1. **Docker integration** (PR-2+): Add container fixtures for full integration testing
2. **Network simulation**: Frame capture and injection for enforcement tests
3. **Go implementation**: Once Go blocker is ready, tests will pass against both implementations
4. **Parity verification**: Both implementations must pass all contract tests before Go becomes default
