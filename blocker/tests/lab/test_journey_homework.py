"""Homework mode end-to-end journey tests."""

import pytest

from .journey import (
    lab,
    make_kid,
    parent,
    wait_for,
    wait_online,
)

pytestmark = pytest.mark.integration


def test_homework_mode_journey():
    """Full homework mode journey: allow sites, turn on homework, check DNS/activity."""
    # Step 1: Create and pause kid1
    kid1_device = make_kid("HomeworkKid", "1234", "kid1")
    lab("block", "kid1", check=True)
    wait_online("kid1", False, timeout=30)

    # Step 2: Family allow `allowed.test`
    parent(
        "POST",
        "/api/v1/homework/sites",
        {"domain": "allowed.test", "kind": "allow", "kid_id": None},
    )

    # Step 3: Turn homework on for 10 minutes
    device_id = kid1_device["device_id"]
    parent(
        "POST",
        f"/api/v1/devices/{device_id}/override",
        {"action": "homework", "minutes": 10},
    )
    # Note: kid1 may not immediately come online; wait for homework to take effect
    import time

    time.sleep(2)

    # ponytail: the lab has no DNS server yet (fake-internet is HTTP only), so the DNS steps
    # skip until one answers allowed/helper/other.test; blocker unit tests cover the homework DNS path.
    probe = lab(
        "dig", "parent", "example.com"
    )  # parent is never blocked: asks 203.0.113.1 directly
    if "communications error" in probe.stdout or probe.stdout.strip() == "error":
        pytest.skip("lab has no upstream DNS server; steps 4-10 need one")

    # Step 4: Check DNS for allowed.test resolves to real IP (203.0.113.1)
    def check_allowed_dns():
        try:
            result = lab(
                "dig",
                "kid1",
                "allowed.test",
            )
            # lab dig should return the IP - if it fails or returns box IP, it's not working
            return "203.0.113.1" in result.stdout.split()
        except Exception:  # noqa: BLE001 - lab probe: any failure means not yet
            return False

    assert wait_for(check_allowed_dns, timeout=60), "allowed.test DNS resolution failed"

    # Step 5: HTTP fetch to allowed.test should succeed (203.0.113.1)
    def check_allowed_http():
        try:
            result = lab("check", "kid1", check=False)
            return result.returncode == 0  # HTTP 200 means connection works
        except Exception:  # noqa: BLE001 - lab probe: any failure means not yet
            return False

    assert wait_for(check_allowed_http, timeout=60), "HTTP fetch to 203.0.113.1 failed"

    # Step 6: DNS for helper.test within 10s after allowed.test should work (session follow)
    def check_helper_dns():
        try:
            result = lab(
                "dig",
                "kid1",
                "helper.test",
            )
            return "203.0.113.1" in result.stdout.split()
        except Exception:  # noqa: BLE001 - lab probe: any failure means not yet
            return False

    assert wait_for(check_helper_dns, timeout=10), (
        "helper.test (session follow) DNS resolution failed"
    )

    # Step 7: DNS for other.test after 15s should return box IP (portal)
    import time

    time.sleep(15)

    def check_other_dns_portal():
        try:
            result = lab(
                "dig",
                "kid1",
                "other.test",
            )
            # Portal returns 10.99.0.4 (the blocker box)
            return "10.99.0.4" in result.stdout.split()
        except Exception:  # noqa: BLE001 - lab probe: any failure means not yet
            return False

    assert wait_for(check_other_dns_portal, timeout=10), (
        "other.test should resolve to portal (box IP)"
    )

    # Step 8: Block helper.test and check DNS returns portal IP
    parent(
        "POST",
        "/api/v1/homework/sites",
        {"domain": "helper.test", "kind": "block", "kid_id": None},
    )

    def check_blocked_helper_dns():
        try:
            result = lab(
                "dig",
                "kid1",
                "helper.test",
            )
            # After blocking, should return box IP
            return "10.99.0.4" in result.stdout.split()
        except Exception:  # noqa: BLE001 - lab probe: any failure means not yet
            return False

    assert wait_for(check_blocked_helper_dns, timeout=10), (
        "blocked helper.test should resolve to portal"
    )

    # Step 9: Delete override and check HTTP fails within 15s
    parent("DELETE", f"/api/v1/devices/{device_id}/override")
    time.sleep(2)

    def check_http_fails():
        try:
            result = lab("check", "kid1", check=False)
            # Should fail (timeout or connection refused)
            return result.returncode != 0
        except Exception:  # noqa: BLE001 - any failure counts as blocked
            return True

    assert wait_for(check_http_fails, timeout=15), (
        "HTTP to 203.0.113.1 should fail after homework ends"
    )

    # Step 10: Activity should list allowed.test and helper.test
    activity = parent("GET", f"/api/v1/homework/activity?device_id={device_id}")
    domains = [a["domain"] for a in activity]
    assert "allowed.test" in domains, "allowed.test missing from activity"
    assert "helper.test" in domains, "helper.test missing from activity"
