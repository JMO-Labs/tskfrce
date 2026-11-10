#!/usr/bin/env python3
"""Tier bench (stdlib only). See scripts/tier.sh. Exits 1 on --gate misses or a soak leak."""

import argparse
import json
import re
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import benchlib as bl

HERE = Path(__file__).resolve().parent
PROJECT = "task4ce-tier"


def get(url, headers=None, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def timed(fn):
    t = time.perf_counter()
    fn()
    return (time.perf_counter() - t) * 1000


def load(fn, n, threads=4):
    with ThreadPoolExecutor(threads) as ex:
        return list(ex.map(lambda _: timed(fn), range(n)))


# ---- docker stats -------------------------------------------------------------------
def _mb(s):
    m = re.match(r"([\d.]+)\s*([KMG]i?B)", s)
    return float(m[1]) * {"KiB": 1 / 1024, "KB": 1 / 1024, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1024}[m[2]]


def stats():
    ids = subprocess.check_output(
        ["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}"], text=True
    ).split()
    out = subprocess.check_output(["docker", "stats", "--no-stream", "--format", "{{json .}}", *ids], text=True)
    res = {}
    for line in out.splitlines():
        j = json.loads(line)
        res[j["Name"].removeprefix(f"{PROJECT}-").rsplit("-", 1)[0]] = {
            "rss_mb": _mb(j["MemUsage"].split("/")[0]),
            "cpu": float(j["CPUPerc"].rstrip("%")),
        }
    return res


def mean_stats(samples):
    return {
        s: {k: round(statistics.mean(x[s][k] for x in samples if s in x), 1) for k in ("rss_mb", "cpu")}
        for s in samples[0]
    }


# ---- scenarios -----------------------------------------------------------------------
def endpoints(a, seed):
    p = {"Authorization": f"Bearer {seed['parent_token']}"}
    k = {"Authorization": f"Bearer {seed['kid_token']}"}
    i = {"X-Internal-Token": a.internal_token}
    v = f"{a.base}/api/v1"
    return {
        "today": (f"{v}/today", p),
        "family": (f"{v}/family", p),
        "inbox": (f"{v}/notifications", p),
        "kid_today": (f"{v}/kid/today", k),
        "kid_whoami": (f"{v}/kid/whoami", k),
        "kid_inbox": (f"{v}/notifications", k),
        "internal_state": (f"{v}/internal/state", i),
    }


def paint(front, route):
    t = time.perf_counter()
    html = get(front + route).decode()
    urls = re.findall(r'<script[^>]+src="(/[^"]+)"', html) + re.findall(
        r'<link[^>]+href="(/[^"]+\.css[^"]*)"', html
    )
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda u: get(front + u), dict.fromkeys(urls)))
    return (time.perf_counter() - t) * 1000, len(set(urls))


def block_latency(a, seed, samples=10):
    v, p = f"{a.base}/api/v1", {"Authorization": f"Bearer {seed['parent_token']}"}
    i, mac, dev = {"X-Internal-Token": a.internal_token}, seed["device_mac"], seed["device_id"]

    def wait(want):
        t = time.perf_counter()
        while time.perf_counter() - t < 15:
            if (mac in json.loads(get(f"{v}/internal/state", i))["blocked"]) == want:
                return time.perf_counter() - t
            time.sleep(0.1)
        raise SystemExit(f"/internal/state never {'blocked' if want else 'unblocked'} {mac}")

    # chores lock the kid's devices by default, so alternate unlock/lock overrides and time each flip
    out = []
    for _ in range(samples):
        for action, want in (("unlock", False), ("lock", True)):
            get(f"{v}/devices/{dev}/override", p, "POST", {"action": action})
            out.append(wait(want))
    get(f"{v}/devices/{dev}/override", p, "DELETE")
    return out


def run_bench(a, seed):
    ep = endpoints(a, seed)
    for u, h in ep.values():
        for _ in range(20):
            get(u, h)
    idle = []
    for _ in range(10):  # ~30s of no load
        idle.append(stats())
        time.sleep(1.5)
    busy, stop = [], threading.Event()

    def sampler():
        while not stop.is_set():
            busy.append(stats())

    th = threading.Thread(target=sampler)
    th.start()
    p50, p95 = {}, {}
    for n, (u, h) in ep.items():
        ms = load(lambda u=u, h=h: get(u, h), 200)
        p50[n], p95[n] = round(bl.percentile(ms, 50), 1), round(bl.percentile(ms, 95), 1)
    stop.set()
    th.join()
    pt, assets = {}, {}
    for r, route in (("parent", "/"), ("kid", "/kid")):
        runs = [paint(a.front, route) for _ in range(10)]
        pt[r], assets[r] = round(statistics.median(x[0] for x in runs), 1), runs[0][1]
    blk = block_latency(a, seed)
    idle_m, busy_m = mean_stats(idle), mean_stats(busy or idle)
    return {
        "tier": a.tier, "arch": a.arch, "startup_s": a.startup_s,
        "p50_ms": p50, "p95_ms": p95, "paint_ms": pt, "paint_assets": assets,
        "block_s": [round(x, 2) for x in blk], "block_s_p50": round(statistics.median(blk), 2),
        "block_s_max": round(max(blk), 2),
        "idle": idle_m, "load": busy_m,
        "idle_cpu_pct_total": round(sum(s["cpu"] for s in idle_m.values()), 1),
        "rss_mb": {s: v["rss_mb"] for s, v in idle_m.items()},
        "rss_mb_total": round(sum(s["rss_mb"] for s in idle_m.values()), 1),
        "rss_mb_peak_load": round(max(sum(s["rss_mb"] for s in x.values()) for x in busy or [idle[0]]), 1),
    }


def run_soak(a, seed):
    ep = list(endpoints(a, seed).values())
    stop, rss = threading.Event(), []

    def worker(off):
        j = off
        while not stop.is_set():
            u, h = ep[j % len(ep)]
            try:
                get(u, h)
                if j % 25 == 0:
                    get(a.front + "/kid")
            except Exception:
                pass
            j += 1
            time.sleep(0.1)

    ths = [threading.Thread(target=worker, args=(n,)) for n in (0, 3)]
    [t.start() for t in ths]
    for m in range(a.soak):
        time.sleep(60)
        rss.append(round(sum(s["rss_mb"] for s in stats().values()), 1))
        print(f"soak minute {m + 1}: {rss[-1]}MB", flush=True)
    stop.set()
    ok, msg = bl.soak_ok(rss)
    return {"tier": a.tier, "arch": a.arch, "soak_rss_mb": rss, "ok": ok, "msg": msg}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", required=True)
    ap.add_argument("--base", default="http://127.0.0.1:18000")
    ap.add_argument("--front", default="http://127.0.0.1:13000")
    ap.add_argument("--internal-token", required=True)
    ap.add_argument("--seed", default=str(HERE / "results/.seed.json"))
    ap.add_argument("--out", default=None)
    ap.add_argument("--arch", default="amd64")
    ap.add_argument("--startup-s", type=float, default=None)
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--soak", type=int, default=0, metavar="MINUTES")
    a = ap.parse_args()
    seed = json.loads(Path(a.seed).read_text())
    out = Path(a.out or HERE / f"results/{a.tier}-{a.arch}{'-soak' if a.soak else ''}.json")
    if a.soak:
        res = run_soak(a, seed)
        out.write_text(json.dumps(res, indent=1))
        print(res["msg"])
        return 0 if res["ok"] else 1
    res = run_bench(a, seed)
    out.write_text(json.dumps(res, indent=1))
    print(json.dumps({k: res[k] for k in ("p95_ms", "paint_ms", "block_s_max", "rss_mb_total", "idle_cpu_pct_total")}))
    if a.gate:
        misses = bl.gate(res, bl.load_targets(str(HERE / f"tiers/{a.tier}.env")))
        for m in misses:
            print("MISS:", m, file=sys.stderr)
        return 1 if misses else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
