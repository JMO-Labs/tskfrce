"""LOCAL_PUSH_CIDRS / LOCAL_PUSH_EXCLUDE_CIDRS are validated when Settings loads."""

import pytest
from app.core.config import Settings
from pydantic import ValidationError


@pytest.mark.parametrize("name", ["LOCAL_PUSH_CIDRS", "LOCAL_PUSH_EXCLUDE_CIDRS"])
@pytest.mark.parametrize("bad", ["192.168.1.0/33", "not-a-cidr", "10.0.0.0/8,,fd00::/99"])
def test_bad_cidr_fails_at_startup(monkeypatch, name, bad):
    monkeypatch.setenv(name, bad)
    with pytest.raises(ValidationError, match=name):
        Settings()


def test_good_cidrs_load(monkeypatch):
    monkeypatch.setenv("LOCAL_PUSH_CIDRS", " 192.168.7.0/24 , fd00::/8 ")
    monkeypatch.setenv("LOCAL_PUSH_EXCLUDE_CIDRS", "127.0.0.0/8")
    s = Settings()
    assert s.LOCAL_PUSH_CIDRS.replace(" ", "") == "192.168.7.0/24,fd00::/8"


def test_empty_include_is_refused(monkeypatch):
    monkeypatch.setenv("LOCAL_PUSH_CIDRS", " ")
    with pytest.raises(ValidationError, match="LOCAL_PUSH_CIDRS"):
        Settings()
