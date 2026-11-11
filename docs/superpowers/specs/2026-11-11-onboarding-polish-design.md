# Onboarding wizard polish

Every decision here was approved by the owner on 2026-11-11 (grilling session). Mockups come first; see
`docs/mockups/onboarding/*.html` (approved 2026-11-11).

1. **More parents.** The Family step has "Add another parent". It creates a one-time invite with the
   existing invite_parent flow. Finish shows it as a QR code and a link, and the other parent picks
   their own username and password.
2. **Edit kids.** Each kid is an editable row (name, age group, avatar, PIN, remove). Back from any later
   step returns here. Once kids are saved, edits PATCH the server.
3. **Live validation.** Rules show while you type, each with a Tabler check or x: password 8+ characters,
   passwords match, username uses allowed characters and is available, kid PIN is 4 digits, kid names
   don't repeat. Errors also appear when a field loses focus.
4. **"See what this sets".** One card per distinct plan, with kids as name chips and the 5 settings as a
   short icon list. Open by default.
5. **Plan step.** It opens on the starter-chore picker; the plan summary sits below it.
6. **Default chores by age group**, showing only the groups present in the family and preselected for
   kids of that age. Little: put toys away, clothes in hamper, help set table, make bed. Kid: make bed,
   tidy room, set and clear table, homework, take out trash. Teen: own laundry, load or unload dishes,
   vacuum a room, homework, help cook dinner. Pet, plant and instrument chores sit under a collapsed
   "More ideas" section and are not preselected.
7. **Devices.** The router (gateway) and the box itself are hidden. With more than one network, devices
   are grouped under network headers (the PR 4 network tags).
8. **Private-address names.** Best available name: mDNS name, then DHCP hostname, then a fingerprint
   guess. A hint reads "Open t@sk4ce on this device to claim it".
9. **Maker glyphs.** Use the maker from the OUI, or guess it from DHCP/mDNS signals for private
   addresses; otherwise show a device-type icon.
10. **Rescan.** The button sweeps every network, at most once every 10 s, and shows "Last scan N s ago".
11. **Avatars.** Fluent 3D emoji (MIT), static WebP in `frontend/public/art/fluent/` (owner chose (a) 2026-11-11): fox, panda, lion, frog, octopus, unicorn, tiger, monkey, penguin, T-rex, rocket, star. Matches the minigame art stack, no attribution needed; mascots stay for celebrations.
12. **Process.** One "onboarding polish" PR off dev, after the mockups are approved.
