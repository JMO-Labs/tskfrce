"""Escape lab runner: lock a device on the beta box, try to get around the lock, score the result.

Phase 1: platform A (Android emulator via adb). See docs/superpowers/specs/2026-11-12-escape-lab-design.md.
Probe exit codes: 0 = reached the real internet (verified), 1 = blocked, 3 = partial (bytes on last line).
"""

import argparse
import fcntl
import fnmatch
import json
import subprocess
import sys
import time
import tomllib
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ADB = [
    *("sudo", "-n", "/usr/local/sbin/droidns", "run"),
    "/home/user/Android/Sdk/platform-tools/adb",
]
SSH = [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-i",
    str(Path.home() / ".ssh/id_gen_key"),
    "ubuntu@192.168.1.98",
]
MAC = "c4:8b:66:54:72:0d"


@dataclass
class Row:
    id: str
    platform: str
    verdict: str
    flags: list = field(default_factory=list)
    detail: str = ""
    duration: float = 0.0


def adb(*args, timeout=30):
    """Run adb on the droid netns; returns (rc, stdout). Timeout gives rc 124."""
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
    return adb("shell", cmd, timeout=timeout)


def alert_signal(before, after):
    """True if the box raised an alert/resisting flag between two status snapshots."""
    bd, ad = before["device"], after["device"]
    bc, ac = before["activity"]["counts"], after["activity"]["counts"]
    # new alert-feed event ids (workaround_try, bypass, ...) catch alerts the counters miss
    seen = {e.get("id") for e in before["activity"].get("events", [])}
    fresh = [e for e in after["activity"].get("events", []) if e.get("id") not in seen]
    return bool(
        ad.get("resisting")
        or fresh
        or ad.get("alerts", 0) > bd.get("alerts", 0)
        or ac.get("bypass", 0) > bc.get("bypass", 0)
    )


def score(base_rc, lock_rcs, alerted, expect_alert, restored):
    """Pure verdict logic. Returns (verdict, flags). lock_rcs: probe rcs while locked."""
    flags = [] if restored else ["NO_RESTORE"]
    if base_rc != 0:
        return "INVALID", flags
    if 0 in lock_rcs:
        return "LEAK", flags
    if 3 in lock_rcs:
        return "PARTIAL", flags
    if any(rc not in (1, 124) for rc in lock_rcs):
        # a probe that errored proves nothing: never let it pass as BLOCKED
        return "INVALID", flags + ["PROBE_ERROR"]
    if expect_alert and not alerted:
        return "ALERT_MISS", flags
    if alerted and not expect_alert:
        return "ALERT_FALSE", flags
    return "BLOCKED", flags


def last_line(out):
    lines = out.strip().splitlines()
    return lines[-1][:120] if lines else ""


def run_one(sc, platform, opt):
    """Full unlock -> baseline -> lock -> probe -> unlock -> restore flow for one scenario."""
    t0 = time.time()
    to, probe = sc.get("timeout", 20), sc["probe"]
    row = Row(sc["id"], platform, "INVALID")
    try:
        box("unlock")
        time.sleep(opt.base_wait)
        if sc.get("host_setup"):
            sh("H", sc["host_setup"], 120)
        if sc.get("setup"):
            sh(platform, sc["setup"], 60)
        base_rc, out = sh(platform, probe, to)
        row.detail = f"base rc={base_rc} {last_line(out)}"
        if base_rc != 0:
            row.flags = ["BASELINE_FAILED"]
            return row
        before = box("status")
        box("lock")
        time.sleep(opt.settle)
        if sc.get("host_locked_setup"):  # host-side kid move while paused (MAC rotation, static IP)
            sh("H", sc["host_locked_setup"], 120)
        if sc.get("locked_setup"):  # the kid's move made while paused (e.g. flip Private DNS)
            sh(platform, sc["locked_setup"], 60)
        rcs, outs = [], []
        for _ in range(sc.get("repeat", 1)):
            rc, out = sh(platform, probe, to)
            rcs.append(rc)
            outs.append(last_line(out))
        after = box("status")
        box("unlock")
        restored = False
        for _ in range(opt.restore_tries):
            if sh(platform, sc.get("restore_probe", probe), to)[0] == 0:
                restored = True
                break
            time.sleep(5)
        alerted = alert_signal(before, after)
        row.verdict, row.flags = score(0, rcs, alerted, sc.get("expect_alert", False), restored)
        row.detail = f"locked rc={rcs} {outs[-1]} alert={alerted}"
    except Exception as e:
        row.verdict, row.detail = "INVALID", f"runner error: {e!r}"[:200]
    finally:
        try:
            if sc.get("teardown"):
                sh(platform, sc["teardown"], 60)
            if sc.get("host_teardown"):
                sh("H", sc["host_teardown"], 120)
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
    # (base_rc, lock_rcs, alerted, expect_alert, restored) -> (verdict, flags)
    cases = [
        ((0, [1], False, False, True), ("BLOCKED", [])),
        ((0, [0], False, False, True), ("LEAK", [])),
        ((0, [1, 0, 1], True, True, True), ("LEAK", [])),
        ((2, [1], False, False, True), ("INVALID", [])),
        ((0, [3], False, False, True), ("PARTIAL", [])),
        ((0, [1], False, True, True), ("ALERT_MISS", [])),
        ((0, [124], True, False, True), ("ALERT_FALSE", [])),
        ((0, [1], True, True, False), ("BLOCKED", ["NO_RESTORE"])),
        ((0, [255], False, False, True), ("INVALID", ["PROBE_ERROR"])),
    ]
    for args, want in cases:
        assert score(*args) == want, (args, score(*args), want)
    before = {"device": {"alerts": 0}, "activity": {"counts": {"bypass": 0}}}
    after = {"device": {"alerts": 1}, "activity": {"counts": {"bypass": 0}}}
    assert alert_signal(before, after) and not alert_signal(before, before)
    ev = {"device": {"alerts": 0}, "activity": {"counts": {"bypass": 0}, "events": [{"id": 7}]}}
    assert alert_signal(before, ev)  # new feed event alone counts as an alert
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="*", help="fnmatch on scenario id")
    ap.add_argument("--platform", default="A")
    ap.add_argument("--settle", type=int, default=25)
    ap.add_argument("--base-wait", type=int, default=10)
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
