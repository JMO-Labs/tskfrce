"""Tests for homework mode lock state."""

from datetime import datetime, timedelta

from app.lock.homework import block_list, effective_allow, state_map
from app.lock.rules import DeviceFacts
from app.models import Device, Override, User
from app.services.homework_domains import STARTER


def _make_user(db, username, role):
    """Helper to create a user with a hashed password."""
    from app.core.auth import AuthService

    u = User(
        username=username,
        email=f"{username}@test",
        hashed_password=AuthService(db).get_password_hash("pw-12345"),
        full_name=username.title(),
        role=role,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_effective_allow_merges_kid_list_and_excludes_other_kid(db):
    """Test that effective_allow includes starter, family, and the specified kid's list only."""
    kid1 = _make_user(db, "kid1", "kid")
    kid2 = _make_user(db, "kid2", "kid")

    from app.models import HomeworkSite

    # Add family allow
    db.add(HomeworkSite(kid_id=None, domain="family.com", kind="allow"))
    # Add kid1's allow
    db.add(HomeworkSite(kid_id=kid1.id, domain="kid1.com", kind="allow"))
    # Add kid2's allow (should not appear for kid1)
    db.add(HomeworkSite(kid_id=kid2.id, domain="kid2.com", kind="allow"))
    db.commit()

    result = effective_allow(db, kid1.id)

    # Should include starter items, family.com, and kid1.com, but not kid2.com
    assert "family.com" in result
    assert "kid1.com" in result
    assert "kid2.com" not in result
    # Check starter items are there (at least one)
    assert any(s in result for s in STARTER)


def test_block_list_in_map(db):
    """Test that block_list returns family block sites."""
    from app.models import HomeworkSite

    db.add(HomeworkSite(kid_id=None, domain="blocked.com", kind="block"))
    db.commit()

    result = block_list(db)
    assert "blocked.com" in result


def test_homework_device_stays_blocked_and_in_map(db, parent):
    """Test device with homework override stays in blocked set and appears in homework map."""
    from datetime import datetime, timedelta

    from app.models import Device

    device = Device(mac="aa:bb:cc:dd:ee:ff", name="test", status="assigned")
    db.add(device)
    db.commit()
    db.refresh(device)

    now_utc = datetime.utcnow()
    expires_at = now_utc + timedelta(hours=1)

    # Add an override for chores (to put device in blocked set)
    # and a homework override
    chore_override = Override(
        device_id=device.id,
        action="lock",
        source="manual",
        expires_at=None,
        created_by_id=parent.id,
    )
    homework_override = Override(
        device_id=device.id,
        action="homework",
        source="manual",
        expires_at=expires_at,
        created_by_id=parent.id,
    )
    db.add(chore_override)
    db.add(homework_override)
    db.commit()

    # Create DeviceFacts with all required fields and homework_until set
    facts_list = [
        (
            device,
            DeviceFacts(
                status="assigned",
                owners=tuple(),
                allowed_sets=tuple(),
                free=tuple(),
                override=None,
                bonus_active=False,
                new_devices_blocked=False,
                points_unlock_early=False,
                homework_until=expires_at,
            ),
        )
    ]

    # Generate homework map
    blocked_set = {"aa:bb:cc:dd:ee:ff"}
    result = state_map(db, facts_list, blocked_set)

    assert "aa:bb:cc:dd:ee:ff" in result
    assert "allow" in result["aa:bb:cc:dd:ee:ff"]
    assert "block" in result["aa:bb:cc:dd:ee:ff"]
    assert "until" in result["aa:bb:cc:dd:ee:ff"]


def test_expired_homework_not_in_map(db):
    """Test that expired homework is not in the map."""
    device = Device(mac="aa:bb:cc:dd:ee:01", name="test", status="assigned")
    db.add(device)
    db.commit()
    db.refresh(device)

    now_utc = datetime.utcnow()
    expired_at = now_utc - timedelta(hours=1)

    # Facts with expired homework_until
    facts_list = [
        (
            device,
            DeviceFacts(
                status="assigned",
                owners=tuple(),
                allowed_sets=tuple(),
                free=tuple(),
                override=None,
                bonus_active=False,
                new_devices_blocked=False,
                points_unlock_early=False,
                homework_until=expired_at,
            ),
        )
    ]

    blocked_set = {"aa:bb:cc:dd:ee:01"}
    result = state_map(db, facts_list, blocked_set)

    # Should not be in map since it's expired
    assert "aa:bb:cc:dd:ee:01" not in result


def test_tick_returns_tuple(db):
    """Test that tick returns a tuple of (blocked, homework)."""
    from app.lock.state import tick

    result = tick(db, datetime.utcnow())
    assert isinstance(result, tuple)
    assert len(result) == 2
    blocked, homework = result
    assert isinstance(blocked, list)
    assert isinstance(homework, dict)


def test_push_state_body(db, monkeypatch):
    """Test that push_state sends the correct body."""
    from app.lock.blocker_client import push_state
    import json

    captured_body = None

    def mock_post(url, json=None, headers=None, timeout=None):
        nonlocal captured_body
        captured_body = json

        class MockResponse:
            def raise_for_status(self):
                pass

        return MockResponse()

    import httpx

    monkeypatch.setattr(httpx, "post", mock_post)

    blocked = ["aa:bb:cc:dd:ee:ff"]
    homework = {
        "aa:bb:cc:dd:ee:ff": {"allow": ["test.com"], "block": [], "until": "2026-11-04T12:00:00Z"}
    }

    push_state(blocked, homework)

    assert captured_body is not None
    assert captured_body["blocked"] == blocked
    assert captured_body["homework"] == homework
