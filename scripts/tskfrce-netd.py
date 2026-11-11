#!/usr/bin/env python3
"""t@sk4ce host network daemon: Wi-Fi join, setup hotspot, fallback watchdog.

Runs as root on the host (systemd: tskfrce-netd.service). The backend container
talks to it over a Unix socket (root:tskfrce-wifi 0660), one JSON line each way.
Stdlib only. Wi-Fi secrets never reach argv: profiles are written as 0600
NetworkManager keyfiles and loaded with `nmcli connection load`.

CLI (host, root): tskfrce-netd.py serve | forget-all | status
"""

import grp
import hashlib
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

SOCK_DIR = Path("/run/tskfrce")
SOCK = SOCK_DIR / "wifi.sock"
STATE = Path("/var/lib/tskfrce")
COUNTRY_FILE = STATE / "country"  # persisted regulatory domain
EDGE_COUNTRY = STATE / "edge" / "country"  # written by the edge container (CF-IPCountry)
SETUP_CREDS = Path("/etc/tskfrce/setup-wifi.json")  # {"ssid","password"} from the factory image
KEYFILES = Path("/etc/NetworkManager/system-connections")
CAPTIVE_DNS = Path("/etc/NetworkManager/dnsmasq-shared.d/99-tskfrce-captive.conf")
HOTSPOT = "tskfrce-setup"
PREFIX = "tskfrce-wifi-"
HOTSPOT_IP = "10.42.0.1"
FALLBACK_AFTER = 300  # spec: saved Wi-Fi unreachable 5 min -> hotspot
RETRY_EVERY = 600  # in fallback, drop the hotspot this often so saved Wi-Fi can retry
TICK = 30

lock = threading.Lock()  # ponytail: one global lock for state-changing nmcli calls; joins are rare
setup = {"phase": "idle", "error": None}  # idle | connecting | connected | failed


# --- validation (mirrors backend/app/services/network_wifi.py; never trust the caller) ---
def valid_ssid(s):
    b = s.encode() if isinstance(s, str) else b""
    return 1 <= len(b) <= 32 and all(0x20 <= c != 0x7F for c in b)


def valid_psk(p):
    if not isinstance(p, str):
        return False
    if len(p) == 64:
        return all(c in "0123456789abcdefABCDEF" for c in p)
    return 8 <= len(p) <= 63 and all(0x20 <= ord(c) < 0x7F for c in p)


def valid_cc(cc):
    return isinstance(cc, str) and re.fullmatch(r"[A-Z]{2}", cc) is not None


# --- nmcli ---
def nm(*args, timeout=30):
    return subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)


def terse(line):
    """Split one `nmcli -t` line: ':' separates fields, '\\:' and '\\\\' are escapes."""
    return [f.replace("\\:", ":").replace("\\\\", "\\") for f in re.split(r"(?<!\\):", line)]


def wifi_device():
    for line in nm("-t", "-f", "DEVICE,TYPE", "device").stdout.splitlines():
        dev, typ = terse(line)[:2]
        if typ == "wifi":
            return dev
    return None


def active():
    """Active connections as (name, type, device)."""
    out = nm("-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active").stdout
    return [tuple(terse(line)[:3]) for line in out.splitlines() if line]


def online():
    """True when any non-hotspot connection is up (wired or Wi-Fi, any interface)."""
    return any(name != HOTSPOT and typ != "loopback" for name, typ, _ in active())


def hotspot_active():
    return any(name == HOTSPOT for name, _, _ in active())


def saved_wifi():
    out = nm("-t", "-f", "NAME,TYPE", "connection", "show").stdout
    return [
        terse(ln)[0]
        for ln in out.splitlines()
        if ln and "wireless" in terse(ln)[1] and terse(ln)[0] != HOTSPOT
    ]


def kf_escape(v):
    """GKeyFile value escaping. Control chars are already rejected by validation."""
    v = v.replace("\\", "\\\\")
    return "\\s" + v[1:] if v.startswith(" ") else v


def write_profile(name, ssid, psk, dev, ap=False):
    """Write a 0600 keyfile and load it. Secrets never touch argv."""
    path = KEYFILES / f"{name}.nmconnection"
    lines = [
        "[connection]",
        f"id={name}",
        f"uuid={uuid.uuid4()}",
        "type=wifi",
        f"interface-name={dev}",
        f"autoconnect={'false' if ap else 'true'}",
        "",
        "[wifi]",
        f"mode={'ap' if ap else 'infrastructure'}",
        f"ssid={kf_escape(ssid)}",
    ]
    if ap:
        lines += ["band=bg", "channel=6"]
    # ponytail: an SSID like "1;2;" reads as a byte list in keyfiles; real SSIDs never look like that
    lines += [
        "",
        "[wifi-security]",
        "key-mgmt=wpa-psk",
        f"psk={kf_escape(psk)}",
        "",
        "[ipv4]",
        f"method={'shared' if ap else 'auto'}",
        "",
        "[ipv6]",
        "method=ignore" if ap else "method=auto",
        "",
    ]
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines))
    nm("connection", "load", str(path))


def delete(name):
    nm("connection", "delete", "id", name)
    (KEYFILES / f"{name}.nmconnection").unlink(missing_ok=True)


def wifi_name(ssid):
    return PREFIX + hashlib.sha256(ssid.encode()).hexdigest()[:8]


def try_up(name, wait=60):
    r = nm("--wait", str(wait), "connection", "up", "id", name, timeout=wait + 15)
    if r.returncode == 0:
        return None
    # ponytail: NM reports a bad PSK as missing secrets; anything else is a generic failure
    return "wrong_password" if "secrets" in (r.stderr + r.stdout).lower() else "failed"


# --- actions ---
def join(ssid, psk, rollback=True):
    """Join from Settings: keep the previous network and return to it on failure."""
    dev = wifi_device()
    if not dev:
        return {"success": False, "error": "no_wifi_device"}
    prev = next((n for n, t, _ in active() if "wireless" in t and n != HOTSPOT), None)
    name = wifi_name(ssid)
    write_profile(name, ssid, psk, dev)
    err = try_up(name)
    if err is None:
        return {"success": True}
    delete(name)
    if rollback and prev:
        try_up(prev)
    return {"success": False, "error": err}


def hotspot_up():
    try:
        creds = json.loads(SETUP_CREDS.read_text())
    except (OSError, ValueError):
        return {"success": False, "error": "no_setup_credentials"}
    dev = wifi_device()
    if not dev or not (valid_ssid(creds.get("ssid")) and valid_psk(creds.get("password"))):
        return {"success": False, "error": "bad_setup_config"}
    apply_country()
    CAPTIVE_DNS.parent.mkdir(parents=True, exist_ok=True)
    CAPTIVE_DNS.write_text(f"address=/#/{HOTSPOT_IP}\n")  # read by NM's shared dnsmasq at start
    write_profile(HOTSPOT, creds["ssid"], creds["password"], dev, ap=True)
    return {"success": try_up(HOTSPOT, wait=30) is None}


def hotspot_down():
    CAPTIVE_DNS.unlink(missing_ok=True)
    delete(HOTSPOT)
    return {"success": True}


def setup_join(ssid, psk):
    """Captive-page join. Single radio: drop the hotspot, try, bring it back on failure."""
    # ponytail: drop-and-retry only; concurrent AP+managed needs a second virtual iface, add if the UX needs it
    setup.update(phase="connecting", error=None)
    hotspot_down()
    res = join(ssid, psk, rollback=False)
    if res["success"]:
        setup.update(phase="connected", error=None)
    else:
        setup.update(phase="failed", error=res.get("error"))
        hotspot_up()
    return res


def forget_all():
    for name in saved_wifi():
        delete(name)
    return {"success": True}


def apply_country(cc=None):
    if cc is None:
        for f in (EDGE_COUNTRY, COUNTRY_FILE):
            cc = f.read_text().strip() if f.exists() else None
            if valid_cc(cc):
                break
        else:
            cc = "US"
    if not valid_cc(cc):
        return {"success": False, "error": "bad_country"}
    assert isinstance(cc, str)
    subprocess.run(["iw", "reg", "set", cc], capture_output=True, timeout=10)
    STATE.mkdir(parents=True, exist_ok=True)
    COUNTRY_FILE.write_text(cc)
    return {"success": True, "country": cc}


def status():
    ssid, signal = None, 0
    dev = wifi_device()
    if dev:
        for line in nm(
            "-t",
            "-f",
            "ACTIVE,SSID,SIGNAL",
            "device",
            "wifi",
            "list",
            "ifname",
            dev,
            "--rescan",
            "no",
        ).stdout.splitlines():
            f = terse(line)
            if f[0] == "yes":
                ssid, signal = f[1], int(f[2] or 0)
                break
    return {
        "online": online(),
        "connected": ssid is not None and not hotspot_active(),
        "ssid": ssid,
        "signal": signal,
        "hotspot_active": hotspot_active(),
        "setup": dict(setup),
        "country": COUNTRY_FILE.read_text().strip() if COUNTRY_FILE.exists() else "US",
    }


def scan():
    dev = wifi_device()
    if not dev:
        return {"networks": []}
    best = {}
    out = nm(
        "-t",
        "-f",
        "SSID,SECURITY,SIGNAL",
        "device",
        "wifi",
        "list",
        "ifname",
        dev,
        "--rescan",
        "auto",
    ).stdout
    for line in out.splitlines():
        ssid, sec, sig = (terse(line) + ["", "", "0"])[:3]
        if ssid and (ssid not in best or int(sig or 0) > best[ssid]["signal"]):
            best[ssid] = {"ssid": ssid, "security": sec or "open", "signal": int(sig or 0)}
    return {"networks": sorted(best.values(), key=lambda n: -n["signal"])}


def handle(req):
    cmd = req.get("cmd")
    if cmd == "status":
        return status()
    if cmd == "scan":
        return scan()
    ssid, psk = req.get("ssid"), req.get("password")
    if cmd in ("join", "setup_join", "forget") and not valid_ssid(ssid):
        return {"error": "bad_ssid"}
    if cmd in ("join", "setup_join") and not valid_psk(psk):
        return {"error": "bad_password"}
    with lock:
        if cmd == "join":
            return join(ssid, psk)
        if cmd == "setup_join":
            if not hotspot_active():
                return {"error": "not_in_setup_mode"}
            threading.Thread(target=locked, args=(setup_join, ssid, psk), daemon=True).start()
            return {"success": True, "status": "connecting"}  # page polls status.setup
        if cmd == "forget":
            delete(wifi_name(ssid))
            return {"success": True}
        if cmd == "forget_all":
            return forget_all()
        if cmd == "set_country":
            return apply_country(req.get("country"))
    return {"error": "unknown_command"}


def locked(fn, *args):
    with lock:
        fn(*args)


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline(4096)
        try:
            resp = handle(json.loads(line))
        except (ValueError, AttributeError):
            resp = {"error": "bad_request"}
        except Exception as e:  # keep the daemon alive; report, don't crash
            resp = {"error": type(e).__name__}
        self.wfile.write((json.dumps(resp) + "\n").encode())


def watchdog():
    """Boot with nothing to join -> hotspot now. Saved Wi-Fi down 5 min -> hotspot, retry every 10."""
    last_online, hotspot_since = time.monotonic(), None
    while True:
        try:
            with lock:
                now = time.monotonic()
                if online():
                    last_online = now
                    if hotspot_active() and setup["phase"] != "connecting":
                        hotspot_down()
                        hotspot_since = None
                elif not hotspot_active():
                    if not saved_wifi() or now - last_online >= FALLBACK_AFTER:
                        if hotspot_up()["success"]:
                            hotspot_since = now
                elif saved_wifi() and hotspot_since and now - hotspot_since >= RETRY_EVERY:
                    hotspot_down()  # let NM autoconnect try the saved network
                    time.sleep(45)
                    if online():
                        last_online, hotspot_since = time.monotonic(), None
                    elif hotspot_up()["success"]:
                        hotspot_since = time.monotonic()
                if EDGE_COUNTRY.exists() and EDGE_COUNTRY.read_text().strip() != (
                    COUNTRY_FILE.read_text().strip() if COUNTRY_FILE.exists() else ""
                ):
                    apply_country()
        except Exception as e:
            print(f"watchdog: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        time.sleep(TICK)


def serve():
    SOCK_DIR.mkdir(parents=True, exist_ok=True)
    SOCK.unlink(missing_ok=True)
    apply_country()
    server = socketserver.ThreadingUnixStreamServer(str(SOCK), Handler)
    os.chown(SOCK, 0, grp.getgrnam("tskfrce-wifi").gr_gid)
    os.chmod(SOCK, 0o660)  # only root and the backend container (group_add) may connect
    threading.Thread(target=watchdog, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if cmd == "serve":
        serve()
    elif cmd == "forget-all":
        print(json.dumps(forget_all()))
    elif cmd == "status":
        print(json.dumps(status()))
    else:
        sys.exit("usage: tskfrce-netd.py serve | forget-all | status")
