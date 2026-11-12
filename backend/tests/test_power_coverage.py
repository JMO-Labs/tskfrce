"""Coverage for power heartbeat wiring (startup/shutdown), run_forever, and two fallbacks."""

import asyncio
import contextlib
import json
from datetime import datetime

import pytest
from app import main
from app.core import database
from app.core.config import settings
from app.models.family import get_family
from app.services import box_power, push, system_warnings
from app.services.suggestions import system_rules


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))


def test_run_forever_survives_oserror_then_cancels(monkeypatch):
    calls = []

    def beat():
        calls.append(1)
        raise OSError("disk full")

    async def fake_sleep(_):
        if len(calls) >= 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(box_power, "heartbeat", beat)
    monkeypatch.setattr(box_power.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(box_power.run_forever())
    assert len(calls) == 2


def test_startup_and_shutdown_power_wiring(db, monkeypatch, tmp_path):
    monkeypatch.setattr(database, "SessionLocal", lambda: contextlib.nullcontext(db))
    monkeypatch.setattr(database, "init_database", lambda: None)
    monkeypatch.setattr(push, "write_conf", lambda f: None)
    monkeypatch.setattr(settings, "LOCK_LOOP_ENABLED", False)
    monkeypatch.setattr(settings, "INTEGRATIONS_LOOP_ENABLED", False)
    monkeypatch.setattr(settings, "POWER_HEARTBEAT_ENABLED", True)
    booted = []
    monkeypatch.setattr(box_power, "check_boot", lambda: booted.append(1))

    async def forever():
        await asyncio.sleep(3600)

    monkeypatch.setattr(box_power, "run_forever", forever)

    async def run():
        await main.startup_event()
        task = main.fastapi_app.state.power_task
        await asyncio.sleep(0)  # let the task start so forever() body runs
        assert not task.done()
        await main.shutdown_event()
        await asyncio.sleep(0)
        return task

    task = asyncio.run(run())
    assert booted == [1] and task.cancelled()
    assert (tmp_path / "clean-shutdown").exists()


def test_box_power_rule_bad_timezone_falls_back_to_utc(db, monkeypatch):
    now = datetime(2026, 1, 1, 13, 0)
    (box_power.data_dir() / "outages.json").write_text(
        json.dumps([{"start": "2026-01-01T12:00:00", "end": "2026-01-01T12:30:00"}])
    )
    get_family(db).timezone = "Not/AZone"
    db.commit()
    out = system_rules.box_power_rule(db, now)
    assert out and "12:00–12:30" in out[0]["title"]


def test_storage_full_ignores_unreadable_disk(db, monkeypatch):
    def boom(p):
        raise OSError("gone")

    monkeypatch.setattr(system_warnings.shutil, "disk_usage", boom)
    assert system_warnings.storage_full(db, datetime.utcnow()) == []
