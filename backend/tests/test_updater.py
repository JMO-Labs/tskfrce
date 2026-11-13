"""install/update-check.sh, run for real against stub docker/curl/systemctl.

Owner hard rule: an eval (beta) box never pulls a stable/prod image.
"""

import json
import os
import stat
import subprocess
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "install" / "update-check.sh"

CURL = """#!/bin/sh
for a in "$@"; do url=$a; done
echo "curl $*" >> "$T/calls"
case $url in
  */internal/update-state) cat "$T/state" ;;
  */internal/kid-session-active) cat "$T/active" ;;
  */internal/update-result) : ;;
  */health) echo '{"version": "2.13.0"}' ;;
  */api/health) echo ok ;;
esac
"""

DOCKER = """#!/bin/sh
echo "docker $*" >> "$T/calls"
case "$*" in
  *"ps --services"*) echo backend; echo frontend ;;
  *" ps -q "*) echo cid ;;
  "image inspect --format {{index .RepoDigests 0}} "*) echo "$5@sha256:new" ;;
  "image inspect --format {{.Id}} "*) echo sha256:new ;;
  "inspect --format {{.Image}} "*) echo sha256:old ;;
  run*) [ -f "$T/badsig" ] && exit 1 ; exit 0 ;;
esac
exit 0
"""


@pytest.fixture
def box(tmp_path):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for name, body in {
        "curl": CURL,
        "docker": DOCKER,
        "systemctl": '#!/bin/sh\necho "systemctl $*" >> "$T/calls"\n',
    }.items():
        f = bin_ / name
        f.write_text(body)
        f.chmod(f.stat().st_mode | stat.S_IEXEC)
    (tmp_path / "active").write_text('{"active": false}')

    def run(install="stable", state=None, hour="03", hold_lock=False):
        (tmp_path / ".env").write_text(f"UPDATE_CHANNEL={install}\nINTERNAL_TOKEN=tok\n")
        (tmp_path / "state").write_text(
            json.dumps(state or {"channel": install, "requested_major": None})
        )
        env = {
            **os.environ,
            "T": str(tmp_path),
            "TASK4CE_DIR": str(tmp_path),
            "REBOOT_FLAG": str(tmp_path / "reboot-required"),
            "NOW_HOUR": hour,
            "TASK4CE_LOCK": str(tmp_path / "install.lock"),
            "PATH": f"{bin_}:{os.environ['PATH']}",
        }
        holder = None
        if hold_lock:  # simulate a running installer
            holder = subprocess.Popen(["flock", str(tmp_path / "install.lock"), "sleep", "30"])
            time.sleep(0.5)
        try:
            subprocess.run(
                ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
            )
        finally:
            if holder:
                holder.kill()
        calls = (tmp_path / "calls").read_text() if (tmp_path / "calls").exists() else ""
        (tmp_path / "calls").unlink(missing_ok=True)
        return calls

    run.dir = tmp_path  # type: ignore[attr-defined]
    return run


def pulls(calls):
    return [line.split()[-1] for line in calls.splitlines() if line.startswith("docker pull")]


def test_eval_box_only_ever_pulls_eval_even_if_state_says_stable(box):
    calls = box(install="eval", state={"channel": "stable", "requested_major": 3})
    assert pulls(calls) and all(p.endswith(":eval") for p in pulls(calls))


def test_stable_box_follows_its_major_or_the_requested_one(box):
    assert {p.split(":")[-1] for p in pulls(box())} == {"2"}
    assert {
        p.split(":")[-1] for p in pulls(box(state={"channel": "stable", "requested_major": 3}))
    } == {"3"}


def test_internal_calls_use_the_internal_token_header(box):
    calls = box()
    assert "X-Internal-Token: tok" in calls and "Authorization" not in calls


def test_off_means_nothing_is_pulled(box):
    assert pulls(box(state={"channel": "off"})) == []
    assert pulls(box(install="eval", state={"channel": "off"})) == []


def test_running_kid_timer_skips_the_night(box):
    (box.dir / "active").write_text('{"active": true}')
    assert pulls(box()) == []


def test_bad_signature_never_deploys(box):
    (box.dir / "badsig").write_text("")
    calls = box()
    assert pulls(calls) and " up -d" not in calls
    assert '"result":"failed"' in calls


def test_verified_update_deploys_pinned_digests_and_reports(box):
    calls = box()
    assert " up -d --no-build" in calls and '"result":"success"' in calls
    override = (box.dir / "docker-compose.override.yml").read_text()
    assert "ghcr.io/jmo-labs/tskfrce/backend:2@sha256:new" in override


def test_os_reboot_only_when_pending_and_no_kid_timer(box):
    assert "systemctl reboot" not in box()  # nothing pending
    (box.dir / "reboot-required").write_text("")
    (box.dir / "active").write_text('{"active": true}')
    assert "systemctl reboot" not in box()  # pending, but a kid timer is running
    (box.dir / "active").write_text('{"active": false}')
    assert "systemctl reboot" in box()


def test_no_reboot_outside_nightly_window(box):
    (box.dir / "reboot-required").write_text("")
    for hour in ("00", "01", "05", "14", "23"):
        assert "systemctl reboot" not in box(hour=hour)
    for hour in ("02", "03", "04"):
        assert "systemctl reboot" in box(hour=hour)


def test_nothing_runs_while_installer_holds_the_lock(box):
    (box.dir / "reboot-required").write_text("")
    calls = box(hold_lock=True)
    assert "systemctl reboot" not in calls
    assert "docker pull" not in calls


def test_timer_does_not_pull_in_the_service():
    unit = (SCRIPT.parent / "update-check.timer").read_text()
    assert "Requires=" not in unit and "Wants=" not in unit
    assert "Persistent=true" in unit


def test_installer_takes_the_shared_lock():
    sh = (SCRIPT.parents[1] / "install.sh").read_text()
    assert "tskfrce-install.lock" in sh and "flock" in sh
