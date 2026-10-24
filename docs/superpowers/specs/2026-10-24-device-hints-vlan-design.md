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

## Part B: VLAN coverage (approved 2026-10-24)

**Why.** The blocker works at layer 2, so it only reaches devices on its own VLAN. Families with a kids/IoT VLAN get nothing.

**Setups (owner's choice).**
- **One trunk port** (recommended): `LAN_IFACE` is plugged into a switch port carrying the tagged VLANs. Broadcast/multicast of every VLAN (ARP, DHCP, mDNS) reaches it, so it discovers *and* enforces.
- **Optional mirror port**: `MIRROR_IFACE` (Ethernet only; Wi-Fi never carries tags) on a SPAN port. Listen-only: VLAN + device discovery, never transmits.
- **"Listen only" setting** (`FamilySettings.listen_only`, default false): nothing is paused anywhere; discovery continues.

**Libraries.** VLAN tags: scapy `Dot1Q` (scapy re-inserts offloaded tags from packet aux data). Interfaces: `ip link add link <LAN_IFACE> name <LAN_IFACE>.<vid> type vlan id <vid>` (iproute2, already in the image). Addresses: busybox `udhcpc` with a small script. If an interface named `<LAN_IFACE>.<vid>` or `br0.<vid>` already exists (Unraid), use it and never delete it.

### Contract
- Blocker → `POST /api/v1/internal/vlans` every 60 s: `{"vlans": [{"vid": 20, "macs": 6, "subnet": "192.168.20.0/24" | null}]}` (vid 1–4094; subnet guessed from ARP sender IPs as /24). Only tagged VLANs are listed.
- `SeenReport` gains optional `vid` (int | null; null = the untagged LAN). Stored as `Device.vlan_id`.
- Backend table `vlans`: `vid` PK, `name` (null), `subnet`, `device_count`, `first_seen`, `last_seen`, `covered` bool default false. Upsert on report; never auto-delete.
- `GET /api/v1/internal/state` → `{"blocked": [...], "listen_only": bool, "covered_vlans": [20, 30]}`. When `listen_only`, `blocked` is `[]`.
- Parent API: `GET /api/v1/network` → `{"listen_only", "vlans": [...], "trunk_detected": bool}`; `PATCH /api/v1/network` `{listen_only}`; `PATCH /api/v1/network/vlans/{vid}` `{name?, covered?}`. Changes trigger reconcile.

### Blocker behaviour
- Detection sniffs `LAN_IFACE` and `MIRROR_IFACE` (if set) for 802.1Q frames; counts distinct source MACs per vid.
- For each covered vid: ensure the VLAN interface, bring it up, run `udhcpc`. With an address and a router from DHCP, run the existing discovery + redirection + resist machinery on that interface ("site"). Without DHCP: passive discovery only, no enforcement on that VLAN, logged.
- Uncovered or removed vid: stop that site, restore its targets (fail open), delete the interface only if the blocker created it.
- Discovery reports carry the site's vid. Shutdown restores every site and deletes created interfaces.
- `MIRROR_IFACE` never transmits.

### Out of scope
Parent screens (after the v3 merge), router-API enforcement, IPv6-only VLANs.
