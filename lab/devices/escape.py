"""Escape lab runner: lock a device on the beta box, try to get around the lock, score the result.

Phase 1: platform A (Android emulator via adb). See docs/superpowers/specs/2026-11-12-escape-lab-design.md.
Probe exit codes: 0 = reached the real internet (verified), 1 = blocked, 3 = partial (bytes on last line).
The real rc is echoed by the runner (`__RC=n`): adb itself exits 1 when the device drops, same as "blocked".
"""

import argparse
import fcntl
import fnmatch
import json
import re
import subprocess
import sys
import time
import tomllib
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
# emulator runs in the root ns (emu-split.sh); only its Wi-Fi TAP lives in the droid netns
ADB = ["/home/user/Android/Sdk/platform-tools/adb"]
SSH = [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-i",
    str(Path.home() / ".ssh/id_gen_key"),
    "ubuntu@192.168.1.98",
]
MAC = "c4:8b:66:54:72:0d"
RC_RE = re.compile(r"__RC=(\d+)\s*$")
VIA_RE = re.compile(r"via=(\S+)")
CELL_PREFIX = "10.0.2."  # emulator cellular (eth0); Wi-Fi/box side is 10.0.77.x
LIVE = "/data/local/tmp/kit/live.sh"


@dataclass
class Row:
    id: str
    platform: str
    verdict: str
    flags: list = field(default_factory=list)
    detail: str = ""
    duration: float = 0.0


def adb(*args, timeout=30):
    """Run adb against the emulator; returns (rc, stdout). Timeout gives rc 124."""
    try:
        p = subprocess.run([*ADB, *args], capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except subprocess.TimeoutExpired:
        return 124, ""


def box(cmd, mac=MAC):
    """Run boxctl.py inside the backend container; returns parsed JSON."""
    remote = f"docker exec -i task4ce-backend-1 python - {cmd} {mac}"
    with open(HERE / "boxctl.py", "rb") as f:
        p = subprocess.run([*SSH, remote], stdin=f, capture_output=True, text=True, timeout=90)
    try:
        out = json.loads(p.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        raise RuntimeError(f"boxctl {cmd}: rc={p.returncode} {p.stdout[-200:]} {p.stderr[-200:]}")
    if p.returncode or out.get("ok") is False:
        raise RuntimeError(f"boxctl {cmd}: {out}")
    return out


def sh(platform, cmd, timeout):
    """Run a shell string on a platform; returns (rc, stdout). A = adb shell, H = this host."""
    if (
        platform == "H"
    ):  # host-side hooks, e.g. `sudo -n droidns mac random` to rotate the Wi-Fi MAC
        try:
            r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=timeout)
            return r.returncode, r.stdout
        except subprocess.TimeoutExpired:
            return 124, "timeout"
    if platform != "A":
        return 255, f"no driver for {platform}"
    # subshell so `exit N` inside a probe still reaches the sentinel; missing sentinel = adb/transport failure
    rc, out = adb("shell", f"( {cmd}\n); echo __RC=$?", timeout=timeout)
    if rc == 124:
        return 124, out
    m = RC_RE.search(out)
    if not m:
        return 255, out
    return int(m.group(1)), out[: m.start()]


def alert_kinds(before, after):
    """Set of alert kinds the box raised between two status snapshots (new or updated events, edges)."""
    bd, ad = before["device"], after["device"]
    bc, ac = before["activity"]["counts"], after["activity"]["counts"]
    old = {e.get("id"): e for e in before["activity"].get("events", [])}
    kinds = set()
    for e in after["activity"].get("events", []):
        o = old.get(e.get("id"))
        # a merged event (locked_try merges for 30 min) keeps its id: catch count/last_at changes too
        if o is None or (o.get("count"), o.get("last_at")) != (e.get("count"), e.get("last_at")):
            kinds.add(e.get("kind") or "event")
    if ad.get("resisting") and not bd.get(
        "resisting"
    ):  # level signal: only the false->true edge counts
        kinds.add("resisting")
    if ac.get("bypass", 0) > bc.get("bypass", 0):
        kinds.add("bypass")
    if ad.get("alerts", 0) > bd.get("alerts", 0) and not kinds:
        kinds.add("alert")
    return kinds


def expectations(sc):
    """(expected, allowed) alert kinds. Legacy expect_alert=true means "any kind" (['*'])."""
    exp = list(sc.get("alerts_expected", []))
    if sc.get("expect_alert") and not exp:
        exp = ["*"]
    allowed = list(sc.get("alerts_allowed", []))
    if re.search(r"http://|http80|:80\b", sc["probe"]):
        allowed.append("locked_try")  # :80 is DNATed to the portal on purpose
    return exp, allowed


def score(base_rc, lock_rcs, kinds, expected, allowed, restored, live=True, via=None):
    """Pure verdict logic. Returns (verdict, flags). lock_rcs: probe rcs while locked."""
    flags = [] if restored else ["RESTORE_FAILED"]
    if not live:
        flags.append("WIFI_LOST")
    if base_rc != 0:
        return "INVALID", flags
    if 0 in lock_rcs:  # a verified leak stays a leak even if the liveness check also failed
        return ("LEAK_CELL" if via and via.startswith(CELL_PREFIX) else "LEAK"), flags
    if not live:
        return "INVALID", flags
    if 3 in lock_rcs:
        return "PARTIAL", flags
    if 124 in lock_rcs:
        return "INVALID", flags + ["PROBE_TIMEOUT"]
    if any(rc != 1 for rc in lock_rcs):
        # a probe that errored proves nothing: never let it pass as BLOCKED
        return "INVALID", flags + ["PROBE_ERROR"]
    missing = [k for k in expected if k != "*" and k not in kinds]
    if "*" in expected and not kinds:
        missing = ["*"]
    if missing:
        return "ALERT_MISS", flags
    if kinds - set(expected) - set(allowed) and "*" not in expected:
        return "ALERT_FALSE", flags
    if not restored:
        return "INVALID", flags  # cannot tell whether the device was online at all
    return "BLOCKED", flags


def last_line(out):
    lines = out.strip().splitlines()
    return lines[-1][:120] if lines else ""


def live_check(platform):
    """True if the device still reaches Google's 204 endpoint through the box (still on its Wi-Fi)."""
    if platform != "A":
        return True
    for i in range(2):
        rc, out = sh(platform, LIVE, 30)
        if rc == 0:
            return True
        time.sleep(3)
    return False


def run_one(sc, platform, opt):
    """Full unlock -> baseline -> lock -> probe -> unlock -> restore flow for one scenario."""
    t0 = time.time()
    to, probe = sc.get("timeout", 20), sc["probe"]
    row = Row(sc["id"], platform, "INVALID")
    try:
        box("unlock")
        time.sleep(opt.base_wait)
        for plat, key, tmo in (("H", "host_setup", 120), (platform, "setup", 60)):
            if sc.get(key):
                rc, out = sh(plat, sc[key], tmo)
                if rc != 0:
                    row.flags, row.detail = ["SETUP_FAILED"], f"{key} rc={rc} {last_line(out)}"
                    return row
        base_rc, out = sh(platform, sc.get("base_probe", probe), to)  # base_probe: inverted rows
        row.detail = f"base rc={base_rc} {last_line(out)}"
        if base_rc != 0:
            row.flags = ["BASELINE_FAILED"]
            return row
        live_check(platform)  # primes the kit's cached Google IP for the locked check
        before = box("status")
        box("lock")
        time.sleep(opt.settle)
        # host-side kid move while paused (MAC rotation, static IP), then the kid's own move (Private DNS)
        for plat, key, tmo in (("H", "host_locked_setup", 120), (platform, "locked_setup", 60)):
            if sc.get(key):
                rc, out = sh(plat, sc[key], tmo)
                if rc != 0:
                    row.flags, row.detail = ["SETUP_FAILED"], f"{key} rc={rc} {last_line(out)}"
                    return row
        rcs, outs, via = [], [], None
        for _ in range(sc.get("repeat", 1)):
            rc, out = sh(platform, probe, to)
            rcs.append(rc)
            outs.append(last_line(out))
            m = VIA_RE.search(out) if rc == 0 else None
            via = via or (m and m.group(1))
        live = live_check(platform)
        time.sleep(sc.get("alert_wait", opt.alert_wait))  # box reports hits/resisting every ~15 s
        after = box("status")
        box("unlock")
        restored = False
        for _ in range(opt.restore_tries):
            if sh(platform, sc.get("restore_probe", probe), to)[0] == 0:
                restored = True
                break
            time.sleep(5)
        kinds = alert_kinds(before, after)
        exp, allowed = expectations(sc)
        row.verdict, row.flags = score(0, rcs, kinds, exp, allowed, restored, live, via)
        row.detail = f"locked rc={rcs} {outs[-1]} alerts={sorted(kinds)} live={live} via={via}"
    except Exception as e:
        row.verdict, row.detail = "INVALID", f"runner error: {e!r}"[:200]
    finally:
        try:
            for plat, key, tmo in ((platform, "teardown", 60), ("H", "host_teardown", 120)):
                if sc.get(key):
                    rc, out = sh(plat, sc[key], tmo)
                    if rc != 0:
                        row.flags.append("TEARDOWN_FAILED")
            box("unlock")
        except Exception as e:
            row.flags.append(f"CLEANUP_ERR:{e!r}"[:80])
        row.duration = round(time.time() - t0, 1)
    return row


def load(paths):
    """Scenarios from every given TOML file (default: all scenarios*.toml next to this file)."""
    out = []
    for path in paths:
        with open(path, "rb") as f:
            out += tomllib.load(f).get("scenario", [])
    return out


def report(rows, prev):
    c = Counter(r["verdict"] for r in rows)
    out = ["# Escape lab report", "", "| verdict | count |", "|---|---|"]
    out += [f"| {v} | {n} |" for v, n in sorted(c.items())]
    out += [
        "",
        "## Not BLOCKED",
        "",
        "| id | plat | verdict | flags | detail |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        if r["verdict"] != "BLOCKED":
            out.append(
                f"| {r['id']} | {r['platform']} | {r['verdict']} | {','.join(r['flags'])} | {r['detail']} |"
            )
    out += ["", "## Changed vs previous run", ""]
    if prev is None:
        out.append("(no previous run)")
    else:
        old = {(r["id"], r["platform"]): r["verdict"] for r in prev}
        diff = [
            f"- {r['id']} [{r['platform']}]: {old.get((r['id'], r['platform']), 'new')} -> {r['verdict']}"
            for r in rows
            if old.get((r["id"], r["platform"])) != r["verdict"]
        ]
        out += diff or ["(no changes)"]
    return "\n".join(out) + "\n"


def selftest():
    # (base_rc, lock_rcs, kinds, expected, allowed, restored, live, via) -> (verdict, flags)
    N, K = set(), {"locked_try"}
    cases = [
        ((0, [1], N, [], [], True), ("BLOCKED", [])),
        ((0, [0], N, [], [], True), ("LEAK", [])),
        ((0, [1, 0, 1], K, ["*"], [], True), ("LEAK", [])),
        ((2, [1], N, [], [], True), ("INVALID", [])),
        ((0, [3], N, [], [], True), ("PARTIAL", [])),
        ((0, [1], N, ["*"], [], True), ("ALERT_MISS", [])),
        ((0, [1], N, ["workaround_try"], [], True), ("ALERT_MISS", [])),
        ((0, [1], K, ["workaround_try"], [], True), ("ALERT_MISS", [])),
        ((0, [1], {"workaround_try"}, ["workaround_try"], [], True), ("BLOCKED", [])),
        ((0, [1], {"workaround_try"}, ["*"], [], True), ("BLOCKED", [])),
        ((0, [124], K, [], [], True), ("INVALID", ["PROBE_TIMEOUT"])),  # timeout is never BLOCKED
        ((0, [1], K, [], [], True), ("ALERT_FALSE", [])),
        ((0, [1], K, [], ["locked_try"], True), ("BLOCKED", [])),  # :80 rows allow locked_try
        ((0, [1], {"bypass"}, [], ["locked_try"], True), ("ALERT_FALSE", [])),
        ((0, [1], N, [], [], False), ("INVALID", ["RESTORE_FAILED"])),
        ((0, [255], N, [], [], True), ("INVALID", ["PROBE_ERROR"])),
        ((0, [1], N, [], [], True, False), ("INVALID", ["WIFI_LOST"])),  # Wi-Fi dropped: not a pass
        ((0, [0], N, [], [], True, False), ("LEAK", ["WIFI_LOST"])),
        ((0, [0], N, [], [], True, True, "10.0.2.15"), ("LEAK_CELL", [])),
        ((0, [0], N, [], [], True, True, "10.0.77.21"), ("LEAK", [])),
    ]
    for args, want in cases:
        assert score(*args) == want, (args, score(*args), want)
    # sentinel parsing (sh is exercised for real by the lab; here only the regex)
    assert RC_RE.search("x\n__RC=1\n").group(1) == "1" and not RC_RE.search("no sentinel")
    assert expectations({"id": "a", "probe": "curl http://x", "expect_alert": True}) == (
        ["*"],
        ["locked_try"],
    )
    assert expectations({"id": "a", "probe": "x", "alerts_expected": ["bypass"]}) == (
        ["bypass"],
        [],
    )
    bd = {"alerts": 0, "resisting": True}
    before = {
        "device": bd,
        "activity": {
            "counts": {"bypass": 0},
            "events": [{"id": 1, "kind": "locked_try", "count": 1, "last_at": "a"}],
        },
    }
    assert alert_kinds(before, before) == set()  # resisting stays True: a level, not an edge
    same_id = json.loads(json.dumps(before))
    same_id["activity"]["events"][0].update(count=2, last_at="b")
    assert alert_kinds(before, same_id) == {"locked_try"}  # merged event updated in place
    edge = json.loads(json.dumps(before))
    edge["device"]["resisting"] = False
    assert alert_kinds(edge, before) == {"resisting"}
    new = json.loads(json.dumps(before))
    new["activity"]["events"].append({"id": 7, "kind": "workaround_try"})
    assert alert_kinds(before, new) == {"workaround_try"}
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="*", help="fnmatch on scenario id")
    ap.add_argument("--platform", default="A")
    ap.add_argument("--settle", type=int, default=25)
    ap.add_argument("--base-wait", type=int, default=10)
    ap.add_argument(
        "--alert-wait", type=int, default=20, help="s to wait before the alert snapshot"
    )
    ap.add_argument("--restore-tries", type=int, default=12)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument(
        "--scenarios", nargs="*", default=sorted(map(str, HERE.glob("scenarios*.toml")))
    )
    opt = ap.parse_args()
    if opt.selftest:
        return selftest()
    scs = [s for s in load(opt.scenarios) if fnmatch.fnmatch(s["id"], opt.only)]
    scs = [s for s in scs if opt.platform in s["platforms"]]
    if opt.list:
        for s in scs:
            print(
                f"{s['id']:22} {','.join(s['platforms']):6} {s.get('skip', '') and 'SKIP: ' + s['skip'] or s['title']}"
            )
        return
    runs = HERE / "runs"
    runs.mkdir(exist_ok=True)
    # one run at a time: runs lock/unlock the same real device on the box
    lock = open(runs / ".lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX)
    # diff baseline: latest verdict per (id, platform) across all earlier runs, so subset runs compare fairly
    latest = {}
    for p in sorted(p for p in runs.iterdir() if (p / "results.json").exists()):
        for r in json.loads((p / "results.json").read_text()):
            latest[(r["id"], r["platform"])] = r
    prev = list(latest.values()) or None
    out = runs / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir()
    rows = []
    try:
        for s in scs:
            if s.get("skip"):
                row = Row(s["id"], opt.platform, "SKIP", [], s["skip"])
            elif (
                s.get("optin") and opt.only == "*"
            ):  # disruptive rows (MAC rotation) need an explicit --only
                row = Row(s["id"], opt.platform, "SKIP", [], "opt-in: run with --only")
            else:
                row = run_one(s, opt.platform, opt)
            rows.append(asdict(row))
            print(f"{row.id:22} {row.verdict:12} {','.join(row.flags):12} {row.detail}", flush=True)
            if {"RESTORE_FAILED", "TEARDOWN_FAILED"} & set(row.flags) or any(
                f.startswith("CLEANUP_ERR") for f in row.flags
            ):
                print("STOP: device state unknown after", row.id, file=sys.stderr)
                break
    finally:
        try:
            box("unlock")
        except Exception as e:
            print("FINAL UNLOCK FAILED:", e, file=sys.stderr)
        (out / "results.json").write_text(json.dumps(rows, indent=1))
        (out / "report.md").write_text(report(rows, prev))
        print("wrote", out)


if __name__ == "__main__":
    main()
