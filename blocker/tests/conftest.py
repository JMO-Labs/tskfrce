import os

import pytest


def pytest_configure(config):
    # addopts deselects integration; RUN_INTEGRATION=1 opts back in.
    if os.environ.get("RUN_INTEGRATION") == "1":
        config.option.markexpr = ""


@pytest.fixture(autouse=True)
def _no_real_dns(monkeypatch):
    """Portal DNS resolves names upstream; tests stay offline (answers fall back to the box IP)."""
    from blocker import portal

    monkeypatch.setattr(portal, "real_ip", lambda name, **kw: None)
