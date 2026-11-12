#!/usr/bin/env bash
# Idempotent: install real kid apps on the Android emulator for the apps.* escape rows.
#  1. F-Droid parts (Aurora Store, Firefox/Fennec, Orbot): download, check sha256 against the repo index, adb install.
#  2. WireGuard: official APK (not on F-Droid; no published hash, so sha256 is pinned below, trust-on-first-use).
#  3. Genuine Play builds via Aurora Store anonymous login, driven by uiautomator (apps-kit.sh aurora PKG...).
#  4. Push app-probe.sh.
# Usage: apps-kit.sh [fdroid|aurora PKG...|probe]   (no arg = fdroid + probe; aurora needs the box UNLOCKED, hold runs/.lock)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ADB=(sudo -n /usr/local/sbin/droidns run /home/user/Android/Sdk/platform-tools/adb)
W=${APPS_CACHE:-$(mktemp -d)}
WG_URL=https://download.wireguard.com/android-client/com.wireguard.android-1.0.20260315.apk
WG_SHA=f92971bc804f4c448e8845ae97e426095eab06ec09a2473a3fa2cfe7288e3298

# fdroid_pick REPO_INDEX PKG ABI: prints "<apk filename> <sha256>" for the newest build that ships ABI.
fdroid_pick() {
  python3 -I - "$1" "$2" "$3" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
vs = [v for v in d["packages"][sys.argv[2]]["versions"].values()
      if sys.argv[3] in (v["manifest"].get("nativecode") or [sys.argv[3]])]
v = max(vs, key=lambda v: v["manifest"].get("versionCode", 0) or v["file"]["name"])
print(v["file"]["name"].lstrip("/"), v["file"]["sha256"])
PY
}

# The repo index is fetched from the same server as the APK, so its hash only proves transfer
# integrity. Pin the APK hashes we verified and installed (2026-11-12); a changed upstream build is
# refused unless APPS_ALLOW_NEW=1, which prints the new hash to review and pin.
declare -A PIN=(
  [com.aurora.store]=fd9c75d90d0f4a7c132b9b4a5a2cf1992a45e03b8d8ff988b7dcfbc0db2c4d11
  [org.mozilla.fennec_fdroid]=c1caf99ca2bbed0e75bd53d5f9ba07a7d27cd6ed96218ecd3dd4f702adb2d4a3
  [org.torproject.android]=6b79cb30d59278fd66b2740223e0592a1f8363274ac8498960491b0201b9b4f2
)

fdroid_install() { # REPO_URL PKG
  local repo=$1 pkg=$2 idx="$W/$(echo "$1" | md5sum | cut -c1-8).json"
  curl -fsSL -o "$idx" "$repo/index-v2.json"  # never reuse a cached index
  read -r name sha < <(fdroid_pick "$idx" "$pkg" x86_64)
  name=$(basename -- "$name")  # index-supplied: never let it escape $W
  [[ $name =~ ^[A-Za-z0-9._-]+\.apk$ ]] || { echo "refusing odd APK name '$name'" >&2; return 1; }
  if [ "$sha" != "${PIN[$pkg]:-}" ] && [ "${APPS_ALLOW_NEW:-0}" != 1 ]; then
    echo "$pkg: index hash $sha != pinned ${PIN[$pkg]:-none}; review, then pin or set APPS_ALLOW_NEW=1" >&2
    return 1
  fi
  curl -fsSL -o "$W/$name" "$repo/$name"
  echo "$sha  $W/$name" | sha256sum -c -
  "${ADB[@]}" install -r "$W/$name" | tail -1
}

fdroid() {
  fdroid_install https://f-droid.org/repo com.aurora.store
  fdroid_install https://f-droid.org/repo org.mozilla.fennec_fdroid
  fdroid_install https://guardianproject.info/fdroid/repo org.torproject.android # Orbot is not in the main repo
  curl -fsSL -o "$W/wg.apk" "$WG_URL"
  echo "$WG_SHA  $W/wg.apk" | sha256sum -c -
  "${ADB[@]}" install -r "$W/wg.apk" | tail -1
}

probe() {
  "${ADB[@]}" push "$HERE/app-probe.sh" /data/local/tmp/kit/app-probe.sh >/dev/null
  "${ADB[@]}" shell chmod 755 /data/local/tmp/kit/app-probe.sh
}

aurora() { # PKG...: one-time Aurora login (Anonymous) then Play install through its UI
  "${ADB[@]}" shell "P=com.aurora.store; appops set \$P REQUEST_INSTALL_PACKAGES allow; appops set \$P MANAGE_EXTERNAL_STORAGE allow; pm grant \$P android.permission.POST_NOTIFICATIONS"
  local d; d=$(mktemp -d); cat >"$d/aurora_install.py" <<'PY'
#!/usr/bin/env python3
"""aurora_install.py PKG [max_seconds]: drive Aurora Store (anonymous login already done) to install PKG from Play."""
import re, subprocess, sys, time
ADB = ["sudo", "-n", "/usr/local/sbin/droidns", "run", "/home/user/Android/Sdk/platform-tools/adb"]
pkg = sys.argv[1]; maxs = 360
def adb(*a):
    return subprocess.run([*ADB, *a], capture_output=True, text=True).stdout
def nodes():
    adb("shell", "uiautomator dump /sdcard/u.xml")
    x = adb("exec-out", "cat /sdcard/u.xml")
    out = []
    for m in re.finditer(r"<node [^>]*>", x):
        n = m.group(0); g = lambda k: (re.search(k + r'="([^"]*)"', n) or [0, ""])[1]
        b = list(map(int, re.findall(r"\d+", g("bounds"))))
        if len(b) == 4:
            out.append((g("text") or g("content-desc"), g("resource-id").split("/")[-1], b))
    return out
def tap(b): adb("shell", f"input tap {(b[0]+b[2])//2} {(b[1]+b[3])//2}")
def installed(): return f"package:{pkg}" in adb("shell", "pm list packages", pkg).split()
adb("shell", f"am start -a android.intent.action.VIEW -d market://details?id={pkg} -p com.aurora.store")
t0 = time.time(); last = ""
while time.time() - t0 < maxs:
    time.sleep(4)
    ns = nodes(); texts = [t for t, _, _ in ns]
    focus = adb("shell", "dumpsys window | grep mCurrentFocus")
    if "packageinstaller" in focus:
        for t, rid, b in ns:
            if rid in ("button1",) : tap(b); last = "confirm"; break
        continue
    for t, rid, b in ns:
        if t == "Open" and b[1] > 1700 and any(x == "Continue to Aurora Store?" for x in texts): tap(b); last = "sheet"; break
    else:
        # details page buttons
        done = False
        for t, rid, b in ns:
            if b[1] < 800 and 600 < b[1] < 700 and t in ("Install", "Update"):
                if installed() and t == "Update" and False: pass
                tap(b); last = t; done = True; break
        if done: continue
        if any("re-authentication" in t or "Failed to generate session" in t for t in texts) or ("Anonymous" in texts and "Google" in texts):
            for t, rid, b in ns:
                if t == "Okay": tap(b)
            if "Anonymous" not in texts:
                adb("shell", "am force-stop com.aurora.store; monkey -p com.aurora.store -c android.intent.category.LAUNCHER 1"); time.sleep(4); ns = nodes()
            for t, rid, b in ns:
                if t == "Anonymous": tap(b); time.sleep(10)
            adb("shell", f"am start -a android.intent.action.VIEW -d market://details?id={pkg} -p com.aurora.store")
            last = "relogin"; continue
        if "Retry" in texts:
            for t, rid, b in ns:
                if t == "Retry": tap(b); break
            last = "retry"; continue
        if "Open" in texts and installed(): print("OK", pkg); sys.exit(0)
        if any(("Unable" in t or "not available" in t.lower() or "incompatible" in t.lower() or "Purchase" == t or "country" in t.lower()) for t in texts):
            print("FAIL", pkg, [t for t in texts if t][:12]); sys.exit(1)
        last = [t for t in texts if t][:6]
print("TIMEOUT", pkg, last, "installed" if installed() else "not installed"); sys.exit(2)
PY
  local p; for p in "$@"; do python3 -I "$d/aurora_install.py" "$p" || true; done
}

case "${1:-}" in
aurora) shift; aurora "$@" ;;
probe) probe ;;
*) fdroid; probe ;;
esac
