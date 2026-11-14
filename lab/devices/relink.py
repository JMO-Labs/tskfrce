"""Relink accuracy matrix (#49): lab phone (droid netns card) + laptop, both on private MACs.

  python3 relink.py [S1 S2 S3 S4]     default: all

S1 one kid, paused phone rotates           -> expect relink to the old phone, lock carried
S2 same kid owns phone+laptop, phone rotates -> which old device does it pick?
S3 phone=Lab A, laptop=Lab B, phone rotates  -> two owners: no relink (rotated phone open?)
S4 phone=Lab A online, laptop joins as a NEW private device (guest) -> must NOT relink
Every scenario starts clean (lab private devices purged) and ends unlocked.
"""

import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import escape as e  # noqa: E402

KID_A, KID_B = 6, 7
PHONE_HW, LAPTOP_HW = "c4:8b:66:54:72:0d", "98:22:ef:94:7e:f5"
REAL = "/data/local/tmp/kit/real.sh https://www.cloudflare.com/cdn-cgi/trace fl="
NS_SSH = [
    "sudo", "-n", "/usr/local/sbin/droidns", "run", "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={Path.home()}/.ssh/known_hosts",
    "-i", f"{Path.home()}/.ssh/id_gen_key",
]  # fmt: skip
laptop_ip = "10.10.40.79"
laptop_moved = False  # only restore the laptop's MAC if a scenario changed it
log = []
created = []  # every private MAC a scenario made: cleaned up even when the scenario fails


def say(*a):
    line = f"{time.strftime('%H:%M:%S')} " + " ".join(str(x) for x in a)
    print(line, flush=True)
    log.append(line)


def rmac() -> str:
    b = bytearray(os.urandom(6))
    b[0] = (b[0] & 0xFC) | 0x02  # unicast, locally administered = private
    m = ":".join(f"{x:02x}" for x in b)
    created.append(m)
    return m


def utcnow() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def lb(*args):
    """labbox.py inside the backend container."""
    with open(HERE / "labbox.py", "rb") as f:
        p = subprocess.run(
            [*e.SSH, f"docker exec -i task4ce-backend-1 python - {' '.join(map(str, args))}"],
            stdin=f, capture_output=True, text=True, timeout=60,
        )  # fmt: skip
    return json.loads(p.stdout.strip().splitlines()[-1])


def dev(mac):
    rows = lb("dev", mac)
    return rows[0] if rows else None


def wait_dev(mac, need_ip=True, t=150, since=""):
    """Box row for mac, seen at/after `since` (UTC) so an old row's stale IP never counts."""
    end = time.time() + t
    while time.time() < end:
        d = dev(mac)
        if d and (d["ip"] or not need_ip) and d["last_seen"] >= since:
            return d
        time.sleep(4)
    raise RuntimeError(f"box never saw {mac}")


def lock(mac, action="lock"):
    return e.box(action, mac)


def phone_mac(m):
    r = subprocess.run(["sudo", "-n", "/usr/local/sbin/droidns", "mac", m], capture_output=True, text=True, timeout=120)
    say("phone mac", m, "rc", r.returncode)


def phone_open():
    return e.sh("A", REAL, 25)[0] == 0


def laptop(cmd, t=40):
    """SSH to the laptop via the droid netns. Retries transport failures (rc 255): the path rides
    the phone's netns Wi-Fi, which is still re-joining right after a phone MAC change."""
    for _ in range(12):
        p = subprocess.run([*NS_SSH, f"defender@{laptop_ip}", cmd], capture_output=True, text=True, timeout=t)
        if p.returncode != 255:
            return p
        time.sleep(5)
    raise RuntimeError(f"laptop unreachable at {laptop_ip}: {p.stderr.strip()[-120:]}")


def laptop_mac(m):
    """Switch the laptop's Wi-Fi MAC (NetworkManager cloned MAC); find its new IP via the box."""
    global laptop_ip, laptop_moved
    laptop_moved = m != LAPTOP_HW
    val = "permanent" if m == LAPTOP_HW else m
    since = utcnow()
    # detached on the laptop: `con up` drops our SSH. A 45 min safety net reverts to the real MAC.
    laptop(
        "sudo -n systemd-run --on-active=45m --unit=labmac-revert --collect sh -c "
        "'nmcli con modify Homenet5 802-11-wireless.cloned-mac-address permanent; nmcli con up Homenet5' 2>/dev/null; "
        f"sudo -n systemd-run --unit=labmac-$(date +%s) --collect sh -c "
        f"'nmcli con modify Homenet5 802-11-wireless.cloned-mac-address {val}; nmcli con up Homenet5'"
    )
    d = wait_dev(m, since=since)
    laptop_ip = d["ip"]
    for _ in range(20):
        if laptop("true", 15).returncode == 0:
            break
        time.sleep(3)
    say("laptop mac", m, "ip", laptop_ip)
    return d


def purge(*macs):
    for m in macs:
        if m and int(m[:2], 16) & 2:
            lb("purge", m)


def leak_watch(secs=60):
    """Probe the phone repeatedly; returns (open probes, total, first open s, last open s)."""
    t0, n, ok, first, last = time.time(), 0, 0, None, None
    while time.time() - t0 < secs:
        n += 1
        if phone_open():
            ok += 1
            first = first if first is not None else round(time.time() - t0)
            last = round(time.time() - t0)
        time.sleep(1)
    return ok, n, first, last


def rotate(new, *watch):
    """Rotate the paused phone to `new`, probing it from the moment the MAC changes; then show rows."""
    import threading

    res = {}
    t = threading.Thread(target=lambda: res.update(r=leak_watch(100)))
    t.start()
    phone_mac(new)
    d = wait_dev(new)
    time.sleep(8)
    show("new", new)
    for tag, m in watch:
        show(tag, m)
    t.join()
    ok, n, first, last = res["r"]
    say(f"  leak from rotation: {ok}/{n} probes open, first={first}s last={last}s; new dev {d['id']} first_seen {d['first_seen']}")


def show(tag, mac):
    d = dev(mac)
    ov = None
    if d and not d["replaced"]:
        try:
            ov = (e.box("status", mac)["device"].get("override") or {}).get("action")
        except Exception:  # noqa: BLE001 - hidden/replaced rows aren't in /devices
            pass
    say(f"  {tag}:", json.dumps({k: d[k] for k in ("id", "status", "owners", "hint_of_id", "hint_reason", "replaced")} if d else None), "override", ov)  # fmt: skip
    return d


def s1():
    p0, p1 = rmac(), rmac()
    phone_mac(p0)
    d0 = wait_dev(p0)
    lb("assign", p0, KID_A)
    lock(p0)
    time.sleep(20)
    say("S1 base", d0["id"], "open while paused?", phone_open())
    rotate(p1, ("old", p0))
    return [p0, p1]


def s2():
    p0, p1, l0 = rmac(), rmac(), rmac()
    # both join while unassigned: a private MAC joining next to an assigned one relinks onto it (S4)
    phone_mac(p0)
    wait_dev(p0)
    laptop_mac(l0)
    lb("assign", p0, KID_A)
    lb("assign", l0, KID_A)
    lock(p0)
    time.sleep(20)
    say(f"S2 phone_old={dev(p0)['id']} laptop={dev(l0)['id']}")
    rotate(p1, ("phone old", p0), ("laptop", l0))
    return [p0, p1, l0]


def s3():
    p0, p1, l0 = rmac(), rmac(), rmac()
    # both join while unassigned: a private MAC joining next to an assigned one relinks onto it (S4)
    phone_mac(p0)
    wait_dev(p0)
    laptop_mac(l0)
    lb("assign", p0, KID_A)
    lb("assign", l0, KID_B)
    lock(p0)
    time.sleep(20)
    say(f"S3 phone_old={dev(p0)['id']} laptop={dev(l0)['id']}")
    rotate(p1, ("phone old", p0), ("laptop", l0))
    return [p0, p1, l0]


def s4():
    p0, l1 = rmac(), rmac()
    phone_mac(p0)
    wait_dev(p0)
    lb("assign", p0, KID_A)
    time.sleep(25)  # phone stays online and seen
    laptop_mac(l1)  # "guest" joins with a brand-new private MAC
    time.sleep(8)
    say(f"S4 phone={dev(p0)['id']}")
    show("guest", l1)
    show("phone", p0)
    return [p0, l1]


def main():
    want = sys.argv[1:] or ["S1", "S2", "S3", "S4"]
    lk = open(HERE / "runs/.lock", "w")
    fcntl.flock(lk, fcntl.LOCK_EX)
    for name in want:
        say(f"===== {name}: {globals()[name.lower()].__doc__ or ''}")
        created.clear()
        try:
            globals()[name.lower()]()
        except Exception as ex:  # noqa: BLE001
            say(name, "ERROR", repr(ex)[:200])
        finally:
            macs = list(created)
            for m in macs:
                try:
                    lock(m, "unlock")
                except Exception:  # noqa: BLE001 - replaced rows are hidden from /devices
                    pass
            phone_mac(PHONE_HW)
            if laptop_moved:
                try:
                    laptop_mac(LAPTOP_HW)
                except Exception as ex:  # noqa: BLE001
                    say("laptop restore", repr(ex)[:120])
            purge(*macs)
    out = HERE / "runs" / f"relink-{time.strftime('%Y%m%d-%H%M%S')}.log"
    out.write_text("\n".join(log) + "\n")
    say("wrote", out)


if __name__ == "__main__":
    main()
