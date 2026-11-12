# Device escape lab

Locks a real device on the beta box, tries to get around the lock, scores the result. Lab only, never CI.
Spec: `docs/superpowers/specs/2026-11-12-escape-lab-design.md`; plan: `docs/superpowers/plans/2026-11-12-escape-lab-p1.md`.

Needs: Android emulator up in the `droid` netns (`droidns`), ssh key `~/.ssh/id_gen_key` to the beta box.

```
bash lab/devices/android-kit.sh                      # once: push curl/q/helpers to the emulator
python3 lab/devices/escape.py --list                 # scenarios
python3 lab/devices/escape.py --selftest             # verdict logic, no device
python3 lab/devices/escape.py --only 'tx.*'          # subset (fnmatch on id)
python3 lab/devices/escape.py                        # full no-server matrix (~25 s settle per row)
```

Flags: `--settle N` (s after lock, default 25), `--base-wait N`, `--platform A`.
Output: `lab/devices/runs/<ts>/{results.json,report.md}` (gitignored; report diffs against the previous run).
Files: `boxctl.py` (runs inside the backend container: lock/unlock/status), `escape.py` (runner),
`scenarios.toml` (rows; `skip = "why"` marks rows the platform cannot do), `android-kit.sh`.
The runner always unlocks the device on exit.
