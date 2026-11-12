"""Tests for box reset functionality (PR 2)."""

import json
from unittest.mock import patch

import pytest
from app.core.auth import AuthService
from app.models import Chore, ChoreType, FamilySettings, Points, User
from app.models.family import get_family
from app.models.points import PointsType
from app.models.user import UserRole
from app.services.reset import backup_export, reset_app_data
from sqlalchemy.orm import Session


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
    """Test reset_app_data: wipes family data, keeps box ID/settings."""

    def test_reset_wipes_kids(self, db: Session, setup_family):
        """After reset, all kids are deleted."""
        fam, parent, kids = setup_family
        assert db.query(User).filter(User.role == UserRole.KID).count() == 2

        token = reset_app_data(db, unblock=False)

        # Verify kids are wiped
        assert db.query(User).filter(User.role == UserRole.KID).count() == 0

    def test_reset_deletes_parent_user(self, db: Session, setup_family):
        """After reset, parent user is deleted (setup wizard reachable)."""
        fam, parent, kids = setup_family
        parent_id = parent.id

        token = reset_app_data(db, unblock=False)

        # Verify parent is deleted
        assert db.query(User).filter(User.id == parent_id).first() is None
        assert db.query(User).count() == 0

    def test_reset_clears_owner_id(self, db: Session, setup_family):
        """After reset, owner_id is None (claim code re-armed)."""
        fam, parent, kids = setup_family
        assert fam.owner_id is not None

        token = reset_app_data(db, unblock=False)

        # Verify owner is cleared
        fam_after = db.query(FamilySettings).first()
        assert fam_after.owner_id is None

    def test_reset_keeps_family_settings(self, db: Session, setup_family):
        """After reset, family settings record exists."""
        fam, parent, kids = setup_family
        orig_name = fam.name

        token = reset_app_data(db, unblock=False)

        # Verify family_settings still exists (now with owner_id=None)
        fam_after = db.query(FamilySettings).first()
        assert fam_after is not None
        assert fam_after.id == fam.id

    def test_reset_setup_step_none(self, db: Session, setup_family):
        """After reset, setup_step is None (wizard starts fresh)."""
        fam, parent, kids = setup_family
        fam.setup_step = 3  # Simulate mid-wizard

        token = reset_app_data(db, unblock=False)

        fam_after = db.query(FamilySettings).first()
        assert fam_after.setup_step is None

    @patch("app.services.reset.push_state")
    def test_reset_calls_blocker_unblock(self, mock_push, db: Session, setup_family):
        """reset_app_data calls push_state([], {}) to unblock all devices."""
        token = reset_app_data(db, unblock=True)

        # Verify blocker was called with empty blocked list and empty homework
        mock_push.assert_called_once_with([], {})

    @patch("app.services.reset.push_state")
    def test_reset_blocker_unreachable_proceeds(self, mock_push, db: Session, setup_family):
        """If blocker is unreachable, reset still completes (fail-safe)."""
        mock_push.return_value = False  # Blocker didn't respond

        # Should not raise
        token = reset_app_data(db, unblock=True)

        # Data is still wiped
        assert db.query(User).count() == 0


class TestBackupExport:
    """Test backup_export: JSON with family data, no secrets."""

    def test_backup_export_without_family_returns_empty_object(self, db: Session):
        """No FamilySettings row: export is an empty JSON object."""
        db.query(FamilySettings).delete()
        db.flush()

        assert json.loads(backup_export(db)) == {}

    def test_backup_includes_family(self, db: Session, setup_family):
        """Backup JSON includes family name and config."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        assert data["family"]["name"] == fam.name
        assert data["family"]["timezone"] == fam.timezone

    def test_backup_includes_kids(self, db: Session, setup_family):
        """Backup includes kid list."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        assert "kids" in data
        assert len(data["kids"]) == 2

    def test_backup_no_parent_password(self, db: Session, setup_family):
        """Backup does NOT include parent hashed_password."""
        fam, parent, kids = setup_family

        export = backup_export(db)
        data = json.loads(export)

        # Backup should have kids, not parent data
        assert "hashed_password" not in json.dumps(data)


class TestBackupExportChoresPoints:
    def test_backup_export_includes_points_and_chores(self, db: Session, setup_family):
        """Chores and points rows are exported without an error payload."""
        fam, parent, kids = setup_family
        ct = ChoreType(name="bk", glyph="x", builtin=False, position=98)
        db.add(ct)
        db.flush()
        db.add(Chore(title="Dishes", points=5, created_by_id=parent.id, type_id=ct.id))
        db.add(
            Points(
                user_id=kids[0].id,
                points_type=PointsType.BONUS,
                amount=7,
                reason="bonus",
            )
        )
        db.commit()

        data = json.loads(backup_export(db))

        assert "error" not in data
        assert [c["name"] for c in data["chores"]] == ["Dishes"]
        assert data["points_history"][0]["kid_id"] == kids[0].id
        assert data["points_history"][0]["amount"] == 7

    def test_backup_export_failure_raises(self, db: Session, setup_family):
        """Failures propagate instead of returning an error payload."""
        with patch.object(db, "query", side_effect=RuntimeError("boom")):
            with pytest.raises(RuntimeError):
                backup_export(db)


class TestTokenEpochRevocation:
    """Test token_epoch enforcement: old tokens rejected after reset/PIN changes."""

    def test_token_epoch_revocation_on_reset(self, db: Session, setup_family):
        """After reset, old parent token returns 401 (token_epoch mismatch)."""
        fam, parent, kids = setup_family
        auth = AuthService(db)

        # Issue a token at epoch 0
        initial_epoch = fam.token_epoch
        token = auth.create_access_token(data={"sub": str(parent.id), "token_epoch": initial_epoch})

        # Verify token works (epoch matches)
        user = auth.get_current_user(token)
        assert user is not None
        assert user.id == parent.id

        # Reset bumps epoch
        reset_app_data(db, unblock=False)
        fam_after = db.query(FamilySettings).first()
        assert fam_after.token_epoch > initial_epoch

        # Old token now fails (epoch mismatch)
        user = auth.get_current_user(token)
        assert user is None

    def test_token_epoch_revocation_on_pin_change(self, db: Session, setup_family):
        """After set-pin (bump epoch), old token returns 401."""
        fam, parent, kids = setup_family
        auth = AuthService(db)

        # Issue token at epoch 0
        initial_epoch = fam.token_epoch
        token = auth.create_access_token(data={"sub": str(parent.id), "token_epoch": initial_epoch})
        assert auth.get_current_user(token) is not None

        # Simulate PIN change: bump epoch
        fam.token_epoch = (fam.token_epoch or 0) + 1
        db.commit()

        # Old token fails
        assert auth.get_current_user(token) is None

    def test_token_epoch_revocation_on_forgot_pin(self, db: Session, setup_family):
        """After forgot-PIN (bump epoch), old token returns 401."""
        fam, parent, kids = setup_family
        auth = AuthService(db)

        # Issue token at epoch 0
        initial_epoch = fam.token_epoch
        token = auth.create_access_token(data={"sub": str(parent.id), "token_epoch": initial_epoch})
        assert auth.get_current_user(token) is not None

        # Simulate forgot-PIN: bump epoch
        fam.token_epoch = (fam.token_epoch or 0) + 1
        db.commit()

        # Old token fails
        assert auth.get_current_user(token) is None

    def test_token_epoch_kid_tokens_unaffected(self, db: Session, setup_family):
        """Kid tokens do NOT check token_epoch (no revocation on parent PIN change)."""
        fam, parent, kids = setup_family
        auth = AuthService(db)

        kid = kids[0]

        # Issue kid token (no token_epoch)
        token = auth.create_access_token(data={"sub": str(kid.id)})
        assert auth.get_current_user(token) is not None

        # Bump family epoch (parent PIN changed)
        fam.token_epoch = (fam.token_epoch or 0) + 1
        db.commit()

        # Kid token still works (epoch not checked for kids)
        user = auth.get_current_user(token)
        assert user is not None
        assert user.id == kid.id

    def test_refresh_token_revoked_after_reset(self, db: Session, setup_family):
        """Pre-reset refresh token gets 401 when used to refresh (epoch mismatch)."""
        fam, parent, kids = setup_family
        auth = AuthService(db)

        # Issue refresh token at epoch 0
        initial_epoch = fam.token_epoch
        refresh_token = auth.create_refresh_token(
            data={
                "sub": str(parent.id),
                "username": parent.username,
                "email": parent.email,
                "token_epoch": initial_epoch,
            }
        )

        # Verify it works (check_epoch passes)
        payload = auth.verify_token(refresh_token)
        assert payload is not None
        assert auth.check_epoch(payload) is True

        # Reset bumps epoch
        reset_app_data(db, unblock=False)
        fam_after = db.query(FamilySettings).first()
        assert fam_after.token_epoch > initial_epoch

        # Old refresh token fails epoch check (HIGH security: pre-reset refresh bypassed before)
        payload = auth.verify_token(refresh_token)
        assert payload is not None
        assert auth.check_epoch(payload) is False
