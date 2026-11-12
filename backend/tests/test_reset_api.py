"""Box reset API, services and CLI: lines reported untested on #182."""

import json
import subprocess
from unittest.mock import patch

import pytest
from sqlalchemy import text
from app.core import lockout
from app.core.auth import AuthService
from app.core.config import settings
from app.models import FamilySettings
from app.models.family import get_family
from app.models.user import User
from app.services import reset as svc

CODE = "K7M2QXA9PB"
R = "/api/v1/settings"


@pytest.fixture(autouse=True)
def _claim(monkeypatch):
    monkeypatch.setattr(settings, "CLAIM_CODE", CODE)
    lockout.reset()


@pytest.fixture
def owner(db, parent):
    fam = get_family(db)
    fam.owner_id = parent.id
    db.commit()
    return parent


def _body(**kw):
    return {"password": "pw-12345", "confirm": "RESET", **kw}


# --- POST /reset ---------------------------------------------------------


def test_reset_wrong_password(client, parent_headers):
    r = client.post(f"{R}/reset", json=_body(password="nope"), headers=parent_headers)
    assert r.status_code == 403


def test_reset_wrong_confirm(client, parent_headers):
    r = client.post(f"{R}/reset", json=_body(confirm="reset!"), headers=parent_headers)
    assert r.status_code == 403
    assert "Confirmation" in r.json()["detail"]


def test_reset_ok_returns_setup_token_when_unclaimed(client, parent_headers, monkeypatch):
    monkeypatch.setattr(settings, "CLAIM_CODE", None)
    with patch("app.services.reset.push_state", return_value=True):
        r = client.post(f"{R}/reset", json=_body(), headers=parent_headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True and r.json()["setup_token"]


def test_reset_ok_without_setup_token_when_claim_code_set(client, parent_headers):
    with patch("app.services.reset.push_state", return_value=True):
        r = client.post(f"{R}/reset", json=_body(), headers=parent_headers)
    assert r.status_code == 200 and "setup_token" not in r.json()


def test_factory_reset_restarts_network(client, parent_headers):
    with (
        patch("app.services.reset.push_state", return_value=True),
        patch("app.services.reset.restart_network_manager") as net,
    ):
        r = client.post(f"{R}/reset", json=_body(factory=True), headers=parent_headers)
    assert r.status_code == 200
    net.assert_called_once()


def test_reset_failure_is_500(client, parent_headers):
    with patch("app.api.reset.reset_app_data", side_effect=RuntimeError("boom")):
        r = client.post(f"{R}/reset", json=_body(), headers=parent_headers)
    assert r.status_code == 500 and "boom" in r.json()["detail"]


# --- GET /backup/export --------------------------------------------------


def test_backup_export_ok(client, parent_headers):
    r = client.get(f"{R}/backup/export", headers=parent_headers)
    assert r.status_code == 200
    assert "family" in json.loads(r.json()["data"])


def test_backup_export_failure_is_500(client, parent_headers):
    with patch("app.api.reset.backup_export", side_effect=RuntimeError("bad")):
        r = client.get(f"{R}/backup/export", headers=parent_headers)
    assert r.status_code == 500


# --- POST /forgot-pin ----------------------------------------------------


def _forgot(client, code=CODE, pw="new-pin-1234"):
    return client.post(f"{R}/forgot-pin", json={"claim_code": code, "new_password": pw})


def test_forgot_pin_wrong_code_then_lockout(client, owner):
    assert _forgot(client, "WRONGCODE1").status_code == 403
    for _ in range(10):
        _forgot(client, "WRONGCODE1")
    assert _forgot(client).status_code == 429


def test_forgot_pin_resets_password_and_bumps_epoch(client, db, owner):
    fam = get_family(db)
    before = fam.token_epoch or 0
    with patch("app.services.notify.notify_parents", create=True) as notify:
        r = _forgot(client)
    assert r.status_code == 200 and r.json()["ok"] is True
    notify.assert_called_once()
    db.expire_all()
    assert get_family(db).token_epoch == before + 1
    user = db.query(User).filter(User.id == owner.id).one()
    assert AuthService(db).verify_password("new-pin-1234", user.hashed_password)


def test_forgot_pin_survives_notify_failure(client, owner):
    with patch("app.services.notify.notify_parents", create=True, side_effect=RuntimeError("x")):
        assert _forgot(client).status_code == 200


def _dangling_owner(db):
    """Point owner_id at a missing user (FKs off; SQLite only)."""
    if db.get_bind().dialect.name != "sqlite":
        pytest.skip("dangling FK needs SQLite")
    db.execute(text("PRAGMA foreign_keys=OFF"))
    get_family(db).owner_id = 987654
    db.commit()


def test_forgot_pin_no_owner(client, db):
    get_family(db).owner_id = None
    db.commit()
    r = _forgot(client)
    assert r.status_code == 500 and "No parent" in r.json()["detail"]


def test_forgot_pin_owner_row_missing(client, db):
    _dangling_owner(db)
    r = _forgot(client)
    assert r.status_code == 500 and "not found" in r.json()["detail"]


def test_forgot_pin_unexpected_error_is_500(client, owner):
    with patch.object(AuthService, "get_password_hash", side_effect=RuntimeError("hash")):
        r = _forgot(client)
    assert r.status_code == 500 and "hash" in r.json()["detail"]


# --- services/reset.py ---------------------------------------------------


def test_reset_app_data_warns_when_blocker_unreachable(db, owner):
    with patch("app.services.reset.push_state", return_value=False):
        svc.reset_app_data(db, unblock=True)
    assert db.query(User).count() == 0


def test_reset_app_data_rolls_back_and_raises(db, owner):
    with patch("app.services.reset._log_telemetry_intent", side_effect=RuntimeError("t")):
        with pytest.raises(RuntimeError):
            svc.reset_app_data(db, unblock=False)


def test_factory_reset_propagates_errors(db):
    with patch("app.services.reset.reset_app_data", side_effect=RuntimeError("f")):
        with pytest.raises(RuntimeError):
            svc.factory_reset(db, unblock=False)


def test_restart_network_manager_runs_networkd():
    with patch("app.services.reset.subprocess.run") as run:
        svc.restart_network_manager()
    assert "systemd-networkd" in run.call_args[0][0]


def test_restart_network_manager_falls_back():
    calls = []

    def run(cmd, **kw):
        calls.append(cmd[-1])
        if cmd[-1] == "systemd-networkd":
            raise OSError("no")

    with patch("app.services.reset.subprocess.run", side_effect=run):
        svc.restart_network_manager()
    assert calls == ["systemd-networkd", "NetworkManager"]


def test_restart_network_manager_both_fail():
    with patch("app.services.reset.subprocess.run", side_effect=subprocess.SubprocessError):
        svc.restart_network_manager()  # must not raise


def test_backup_export_empty_without_family(db):
    db.query(FamilySettings).delete()
    db.commit()
    assert json.loads(svc.backup_export(db)) == {}


@pytest.mark.xfail(
    strict=True,
    reason="backup_export reads Chore.name / Chore.category (seeded chores), which don't exist",
)
def test_backup_export_includes_kids_and_rewards(db, kid):
    from app.models import Reward

    db.add(Reward(name="Ice cream", price=10))
    db.commit()
    data = json.loads(svc.backup_export(db))
    assert [k["id"] for k in data["kids"]] == [kid.id]
    assert data["rewards"][0]["price"] == 10


@pytest.mark.xfail(
    strict=True,
    reason="backup_export reads Points.kid_id / Chore.name / Chore.category, which don't exist",
)
def test_backup_export_includes_points_and_chores(db, kid):
    from app.models import Chore, Points, PointsType

    db.add(Chore(title="Dishes"))
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=5, reason="bonus"))
    db.commit()
    data = json.loads(svc.backup_export(db))
    assert "error" not in data
    assert data["points_history"][0]["amount"] == 5


def test_backup_export_reports_error(db):
    with patch.object(db, "query", side_effect=RuntimeError("q")):
        assert json.loads(svc.backup_export(db)) == {"error": "q"}


# --- core/auth + refresh -------------------------------------------------


def test_check_epoch_bad_sub_is_false(db):
    auth = AuthService(db)
    assert auth.check_epoch({"sub": "abc"}) is False
    assert auth.check_epoch({}) is False


def test_refresh_rejects_stale_epoch_and_copies_epoch(client, db, parent):
    auth = AuthService(db)
    fam = get_family(db)
    ok = auth.create_refresh_token({"sub": str(parent.id), "token_epoch": fam.token_epoch})
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": ok})
    assert r.status_code == 200
    fam.token_epoch = (fam.token_epoch or 0) + 1
    db.commit()
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": ok})
    assert r.status_code == 401 and "invalidated" in r.json()["detail"]


# --- CLI set-pin / main --------------------------------------------------


@pytest.fixture
def cli(db, monkeypatch):
    import app.cli as cli

    class Sess:
        def __enter__(self):
            return db

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(cli, "SessionLocal", lambda: Sess())
    return cli


def test_set_pin_no_owner(cli, db, capsys):
    get_family(db).owner_id = None
    db.commit()
    assert cli.set_pin_cmd() == 1
    assert "No parent account" in capsys.readouterr().out


def test_set_pin_owner_row_missing(cli, db, capsys):
    _dangling_owner(db)
    assert cli.set_pin_cmd() == 1
    assert "not found" in capsys.readouterr().out


def test_set_pin_too_short(cli, owner, monkeypatch, capsys):
    monkeypatch.setattr(cli, "getpass", lambda _: "short")
    assert cli.set_pin_cmd() == 1
    assert "at least 8" in capsys.readouterr().out


def test_set_pin_updates_and_bumps_epoch(cli, db, owner, monkeypatch, capsys):
    monkeypatch.setattr(cli, "getpass", lambda _: "long-enough-pin")
    before = get_family(db).token_epoch or 0
    assert cli.set_pin_cmd() == 0
    assert "updated" in capsys.readouterr().out
    db.expire_all()
    assert get_family(db).token_epoch == before + 1
    user = db.query(User).filter(User.id == owner.id).one()
    assert AuthService(db).verify_password("long-enough-pin", user.hashed_password)


def test_migrate_to_success_and_failure(monkeypatch, capsys):
    import app.cli as cli

    monkeypatch.setattr("app.services.db_move.move", lambda a, b: {"t": 3})
    assert cli.migrate_to("postgresql://x") == 0
    assert "Moved 3 rows" in capsys.readouterr().out

    def boom(a, b):
        raise RuntimeError("down")

    monkeypatch.setattr("app.services.db_move.move", boom)
    assert cli.migrate_to("postgresql://x") == 1
    assert "untouched" in capsys.readouterr().out


def test_main_dispatch(monkeypatch, capsys):
    import app.cli as cli

    monkeypatch.setattr(cli, "set_pin_cmd", lambda: 0)
    monkeypatch.setattr(cli, "migrate_to", lambda u: 0)
    assert cli.main(["set-pin"]) == 0
    assert cli.main(["migrate-to", "u"]) == 0
    assert cli.main(["bogus"]) == 2
    assert "Usage" in capsys.readouterr().out
