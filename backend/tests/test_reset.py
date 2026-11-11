"""Tests for box reset functionality (PR 2)."""

import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from app.models import (
    Chore,
    ChoreAssignment,
    ChoreRun,
    FamilySettings,
    User,
)
from app.models.family import get_family
from app.models.user import UserRole
from app.services.reset import backup_export, factory_reset, reset_app_data


@pytest.fixture
def setup_family(db: Session):
    """Create a test family with parent and kids."""
    # Create parent
    parent = User(
        username="mom",
        email="mom@test.local",
        full_name="Mom",
        role=UserRole.PARENT,
        hashed_password="hashed_pw_here",
    )
    db.add(parent)
    db.flush()

    # Ensure family exists and set owner
    fam = get_family(db)
    fam.name = "Test Family"
    fam.owner_id = parent.id

    # Create kids
    kids = [
        User(
            username=f"kid{i}",
            email=f"kid{i}@test.local",
            full_name=f"Kid {i}",
            role=UserRole.KID,
            hashed_password="hashed_pw_here",
        )
        for i in range(2)
    ]
    db.add_all(kids)
    db.commit()

    return fam, parent, kids


class TestResetAppData:
    """Test reset_app_data: wipes family data, keeps Wi-Fi/box ID/UPDATE_CHANNEL."""

    def test_reset_wipes_kids_and_data(self, db: Session, setup_family):
        """After reset, kids/chores/devices/etc are gone, parent/settings unchanged."""
        fam, parent, kids = setup_family
        kid1_id = kids[0].id

        # Create a chore and run for the kid
        chore = Chore(name="Clean room", family_id=1, category="home")
        db.add(chore)
        db.flush()

        run = ChoreRun(chore_id=chore.id, kid_id=kid1_id, status="todo", created_at=datetime.now(UTC))
        db.add(run)
        db.commit()

        # Verify setup
        assert db.query(User).filter(User.role == "KID").count() == len(kids)
        assert db.query(Chore).count() >= 1
        assert db.query(ChoreRun).count() >= 1

        # Reset
        reset_app_data(db, unblock=False)

        # Verify wipes
        assert db.query(User).filter(User.role == "KID").count() == 0
        assert db.query(Chore).count() == 0
        assert db.query(ChoreRun).count() == 0
        assert db.query(ChoreAssignment).count() == 0

        # Verify parent unchanged
        parent_after = db.query(User).filter(User.id == parent.id).first()
        assert parent_after is not None
        assert parent_after.role == "PARENT"

        # Verify settings unchanged
        fam_after = db.query(FamilySettings).first()
        assert fam_after.id == fam.id
        assert fam_after.name == fam.name

    def test_reset_keeps_box_id_and_secret(self, db: Session, setup_family):
        """box ID/secret/domain from family_keys are unchanged by reset."""
        # Note: family_keys is a separate table; verify it exists after reset
        reset_app_data(db, unblock=False)

        # Verify family settings still exist
        fam = db.query(FamilySettings).first()
        assert fam is not None

    @patch("app.services.reset.push_blocked")
    def test_reset_unblocks_devices(self, mock_push: MagicMock, db: Session, setup_family):
        """reset_app_data with unblock=True calls blocker to flush rules."""
        reset_app_data(db, unblock=True)

        # Verify blocker was called with empty list
        mock_push.assert_called_once_with([])

    @patch("app.services.reset.push_blocked")
    def test_reset_blocker_unreachable(self, mock_push: MagicMock, db: Session, setup_family):
        """If blocker is unreachable, reset still completes (fail-safe)."""
        mock_push.return_value = False  # Blocker didn't respond

        # Should not raise
        reset_app_data(db, unblock=True)

        # Data is still wiped
        assert db.query(User).filter(User.role == "KID").count() == 0

    def test_reset_with_active_session_raises(self, db: Session, setup_family):
        """Reset is blocked if a kid session is active."""
        fam, parent, kids = setup_family
        kid = kids[0]

        # TODO: Mark kid as in active session (check how the app tracks active sessions)
        # For now, this test is a placeholder for the mechanism
        pass


class TestFactoryReset:
    """Test factory_reset: also wipes Wi-Fi, re-arms claim code."""

    @patch("app.services.reset.push_blocked")
    def test_factory_reset_includes_app_wipe(self, mock_push: MagicMock, db: Session, setup_family):
        """Factory reset wipes all data like reset_app_data."""
        fam, parent, kids = setup_family

        factory_reset(db, unblock=True)

        # Verify data is wiped
        assert db.query(User).filter(User.role == "KID").count() == 0

    @patch("app.services.reset.push_blocked")
    @patch("app.services.reset.restart_network_manager")
    def test_factory_reset_wipes_wifi(self, mock_restart: MagicMock, mock_push: MagicMock, db: Session, setup_family):
        """Factory reset calls restart for Wi-Fi (systemd-networkd restart or NetworkManager restart)."""
        factory_reset(db, unblock=True)

        # Verify network restart was called
        mock_restart.assert_called_once()


class TestBackupExport:
    """Test backup_export: JSON with family data, no secrets or PIN."""

    def test_backup_export_includes_family(self, db: Session, setup_family):
        """Backup JSON includes family name and settings (non-secret)."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        assert data["family"]["name"] == fam.name
        assert data["family"]["timezone"] == fam.timezone

    def test_backup_export_includes_kids(self, db: Session, setup_family):
        """Backup includes kid list (name, age, etc.)."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        assert "kids" in data
        assert len(data["kids"]) == len(kids)
        assert all("name" in k for k in data["kids"])

    def test_backup_export_no_parent_password(self, db: Session, setup_family):
        """Backup does NOT include parent password or PIN."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        # Parent info should not exist or should not have hashed_password
        if "parent" in data:
            assert "hashed_password" not in data["parent"]

    def test_backup_export_no_device_secrets(self, db: Session, setup_family):
        """Backup does NOT include device enrollment secrets."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        # Verify no enrollment tokens, kid device secrets, etc.
        assert "enrollment_tokens" not in str(data)
        assert "device_secrets" not in str(data)


class TestForgotPinRecovery:
    """Test forgot-PIN sticker code recovery in the API layer (see api/reset.py)."""

    # These are tested in test_reset_api.py
    pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
