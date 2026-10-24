# Device hints + VLAN coverage

Branch `feat/device-hints-vlan` (from `feat/v2-teen-redesign` @ 59c620d). UI for both parts lands after the v3 merge; this branch ships blocker + backend + API.

## Part A: Device hints (approved 2026-10-24)

**Why.** Learning mode keeps new devices online. A kid can get a fresh private Wi-Fi address (toggle Private Address, pick Rotating, forget the network). The box sees a new device, so the pause is gone. Names are not a key: iOS sends a generic DHCP hostname with a private address on, and names are user-editable.

**What.** When a new device appears and it looks like a kid's device that just went quiet, give it that device's owners and groups (so the same rules, pause included, apply) and tell parents, with Undo.

### Libraries (owner asked: reuse, don't hand-roll)
- mDNS: **python-zeroconf** (LGPL, used by Home Assistant). `ServiceBrowser` on `_device-info._tcp.local.` and `_companion-link._tcp.local.` (iPhone/iPad), `_airplay._tcp.local.`; read server name + `model` TXT. No hand-written mDNS parsing.
- DHCP: **scapy's `DHCP` layer** (scapy already a dependency); `sniff(filter="udp and (port 67 or 68)")` and read the `param_req_list` option. Clients broadcast DISCOVER/REQUEST, so the box sees them without being the DHCP server.
- Random MAC bit, matching rules: a few lines each; no library does same-device continuity.

### Signals
- `mdns_name`: the advertised host/server name, e.g. `Bobbys-iPad.local.` → `Bobbys-iPad`.
- `model`: `model=` from the `_device-info._tcp` TXT record, e.g. `iPad13,1`.
- `dhcp_fp`: DHCP option 55 (parameter request list) as comma-joined decimals, e.g. `1,121,3,6,15,119,252`. Same OS build → same list.
- Random MAC: locally administered bit (second-least-significant bit of the first octet). Backend derives it; not reported.

Blocker adds optional `mdns_name`, `model`, `dhcp_fp` (each `str | None`, ≤255 chars) to the `Seen` report and `POST /api/v1/internal/devices/seen` body. Reports when a signal first appears or changes. Malformed packets never raise.

### Matching (backend, pure function in `app/lock/hints.py`)
`find_hint(new: DeviceSignals, candidates: list[DeviceSignals], now) -> Hint | None`

Candidates: devices with at least one kid owner, not the new device, not previously rejected for this new device, and **not seen within 2 minutes before the new device's first_seen** (two devices online together are two devices). Candidate must have been seen in the last 24 h.

| Strength | Rule |
|---|---|
| strong | same `mdns_name` (case-insensitive), not empty |
| medium | same `model` and same `dhcp_fp`, both non-empty |
| weak | new MAC is random, same `dhcp_fp`, candidate last_seen ≤ 30 min before new first_seen, **and candidate is paused now** |

Best strength wins; tie → most recently seen candidate. Two+ candidates tied on strength and owners differ → no hint (ambiguous).

### On match
- Copy owners and groups; status `assigned`; copy unexpired manual `lock` override.
- `Device.hint_of_id` = candidate id, `Device.hint_reason` = `"name" | "model" | "timing"`.
- Inbox notice to parents (`kind="device_hint"`): title `"<candidate name> came back with a new address"`, body `"We gave it <owner names>'s rules. Not the same device? Undo."`, `device_id` = new device.
- `POST /api/v1/devices/{id}/hint/undo` (parent): clear owners/groups, status `unassigned`, record rejection (`device_hint_rejections` new_id/candidate_id), clear `hint_of_id`. Idempotent; 404 when no hint.
- Hint evaluation also runs when a still-unassigned device first reports a signal later (mDNS often arrives after ARP).
- Device API responses include `hint_of_id`, `hint_reason`, `mdns_name`, `model`, `random_mac`.

### Out of scope
Merging old + new rows; matching guests; UI (after v3 merge).

## Part B: VLAN coverage (draft — awaiting owner confirmation)
See chat playback; filled in once confirmed.
