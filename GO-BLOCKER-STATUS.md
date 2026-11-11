# Go blocker: paused 2026-11-10 (WIP, not for merge)

Done and real: config, api, backend client, store, firewall (netlink, F27-F31 + H3), redirect (F23-F26), portal, workaround, vlan, sites; build/vet/race/staticcheck/govulncheck (go1.26.10) green.
Stubs: discovery (F36-F39), signals (F40-F43), homework integration (H1-H6 beyond Decide).

Open security findings to fix on resume (from automated review):
- HIGH homework.go: normalize case + trailing dot for query and list entries before block/allow matching.
- discovery (when written): never hardcode .1 / fe80::1 sources; validate ARP replies (probed IP, in-subnet, eth.src==arp.sha, no bcast/zero MAC, first reply); no reader goroutine outliving the call.
Resume plan: one package at a time, single agent, coordinator review per package, contract suite as the gate.
- MEDIUM redirect.go: IPv6 NA frames are built without the NeighborAdvertisement layer (no target/flags/TLLA option, bad checksum), so IPv6 redirection silently fails. Build a proper NA (R|O flags toward the device, O toward the gateway; TargetAddress; TLLA option = box MAC; SetNetworkLayerForChecksum) in both spoof and restore paths. Add a contract assertion on captured NA frames.
- MEDIUM homework manager.go: sessions removed in Update/Expire don't return their IPs, so conntrack entries survive the cut (H4). Return ended-session IPs and delete their conntrack entries.
- MEDIUM homework manager.go: listed-name branch inserts into Names without admit() → per-session caps bypassed. Apply caps on every insert path (Names, Activity, FollowedNames, IPNames).
- NOTE follow window (H6) mirrors the Python design (10s window after an allowed name). Review flagged it as broad; consider limiting to the allowed answer's CNAME chain or same eTLD+1, in BOTH implementations (owner decision).
