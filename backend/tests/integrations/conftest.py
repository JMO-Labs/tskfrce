import base64
import json
import secrets

import httpx
import pytest
from app.core.crypto import seal
from app.models.chores import ChoreRun
from app.models.integration import IntegrationChore, IntegrationInstall, IntegrationKid
from tests.conftest import _make_user
from tests.factories import make_chore
from tests.integrations.fake_service import FakeService
from tests.integrations.int_helpers import (
    DEMO,
    DEMO_FULL,
    GONE,
    KIDCARDS,
    TEST_KEY,
    Signer,
    sign_env,
    streamed,
)


@pytest.fixture(autouse=True)
def keypair(monkeypatch):
    """Pin TEST_KEY's public key as the registry key; returns a signer."""
    from app.integrations import trust
    from cryptography.hazmat.primitives import serialization as ser

    raw = TEST_KEY.public_key().public_bytes(ser.Encoding.Raw, ser.PublicFormat.Raw)
    monkeypatch.setattr(trust, "REGISTRY_PUBKEY", base64.b64encode(raw).decode())
    return Signer(TEST_KEY)


@pytest.fixture
def install(request, db, parent, kid):
    """Active catalog install of DEMO, linked to `kid` and one chore."""
    perms = getattr(request, "param", ["chores.complete"])
    chore, _ = make_chore(db, parent, kids=[kid])
    inst = IntegrationInstall(
        public_id=secrets.token_hex(16),
        source="catalog",
        integration_id="demo",
        name="Demo",
        icon="extension",
        manifest=json.dumps(sign_env(DEMO)),
        permissions=json.dumps(perms),
        secret=seal(secrets.token_urlsafe(32), purpose="integrations"),
        status="active",
        created_by_id=parent.id,
    )
    db.add(inst)
    db.flush()
    db.add_all(
        [
            IntegrationKid(install_id=inst.id, kid_id=kid.id),
            IntegrationChore(install_id=inst.id, chore_id=chore.id),
        ]
    )
    db.commit()
    return inst


@pytest.fixture
def run_today(db, install):
    """Today's todo run of the install's linked chore for `kid`."""
    chore_id = install.chores[0].chore_id
    from app.models.chores import ChoreAssignment
    from app.services.chores import today

    a = db.query(ChoreAssignment).filter_by(chore_id=chore_id).one()
    run = ChoreRun(assignment=a, day=today(db), kid_id=install.kids[0].kid_id, status="todo")
    db.add(run)
    db.commit()
    run.chore_id = chore_id  # unmapped convenience attribute for tests
    return run


@pytest.fixture
def other_kid(db):
    from app.models.user import UserRole

    return _make_user(db, "sally", UserRole.KID)


@pytest.fixture
def other_kid_headers(db, other_kid):
    from tests.conftest import _headers

    return _headers(db, other_kid)


@pytest.fixture(autouse=True)
def resolve_to(monkeypatch):
    """Stub net's resolver: resolve_to(*ips) sets the answers; IP literals resolve to
    themselves, as with real getaddrinfo. Only net._getaddrinfo is patched (no real DNS)."""
    import ipaddress

    from app.integrations import net

    answers = ["93.184.216.34"]

    def fake(host, port):
        try:
            ips = [str(ipaddress.ip_address(host))]
        except ValueError:
            ips = answers
        return [(None, None, None, "", (ip, port)) for ip in ips]

    monkeypatch.setattr(net, "_getaddrinfo", fake)

    def set_answers(*ips):
        answers[:] = ips

    return set_answers


class _Seen:
    """Recording MockTransport: keeps the last request's url, headers and extensions."""

    def __init__(self):
        self.url = self.headers = self.extensions = None
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, req):
        self.url, self.headers, self.extensions = req.url, req.headers, req.extensions
        return httpx.Response(
            200, headers={"content-type": "application/json"}, stream=streamed(b"{}")
        )


@pytest.fixture
def seen():
    return _Seen()


class _Registry:
    """MockTransport registry: serve(env) answers with that envelope; fail() answers 503."""

    def __init__(self):
        self.env: dict | None = None
        self.path: str | None = None
        self.transport = httpx.MockTransport(self._handle)

    def serve(self, env: dict) -> None:
        self.env = env

    def fail(self) -> None:
        self.env = None

    def _handle(self, req):
        self.path = req.url.path
        if self.env is None:
            return httpx.Response(503, stream=streamed(b"{}"))
        body = json.dumps(self.env).encode()
        return httpx.Response(
            200, headers={"content-type": "application/json"}, stream=streamed(body)
        )


@pytest.fixture
def registry():
    return _Registry()


@pytest.fixture
def synced_catalog(monkeypatch, tmp_path, keypair):
    """A verified catalog cache in a temp DATA_DIR: DEMO_FULL, KIDCARDS, and GONE (revoked)."""
    from app.core.config import settings
    from app.integrations.catalog import _write

    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    _write(keypair.catalog([DEMO_FULL, KIDCARDS, GONE], revoked=["gone"]))


@pytest.fixture
def svc(monkeypatch):
    """FakeService behind every BoxClient (store._transport). It learns the secret on install;
    set .secret to talk to a fixture-made install."""
    from app.integrations import store

    s = FakeService(secret="unknown")
    monkeypatch.setattr(store, "_transport", s.transport)
    return s


@pytest.fixture
def reward_redemption(db, kid):
    """A pending reward redemption of a 20-point "Ice cream" for `kid` (who can afford it)."""
    from app.models.points import Points, PointsType
    from app.models.reward import Redemption, Reward

    rw = Reward(name="Ice cream", price=20)
    db.add(rw)
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=100, description="t"))
    db.flush()
    red = Redemption(kid_id=kid.id, kind="reward", reward_id=rw.id, cost=20)
    db.add(red)
    db.commit()
    return red


@pytest.fixture
def run_submitted(db, run_today):
    """Today's linked run for `kid`, checked off and waiting on a parent."""
    from datetime import datetime

    run_today.status = "submitted"
    run_today.submitted_at = datetime.utcnow()
    run_today.submitted_by_id = run_today.kid_id
    db.commit()
    return run_today


@pytest.fixture
def screen_time_redemption(db, kid):
    """A pending 15-minute screen-time request for `kid`, who owns a device and can afford it."""
    from app.models.lock import Device
    from app.models.points import Points, PointsType
    from app.models.reward import Redemption

    d = Device(mac="aa:bb:cc:dd:ee:19", name="Phone", status="assigned")
    d.owners.append(kid)
    db.add(d)
    db.add(Points(user_id=kid.id, points_type=PointsType.BONUS, amount=100, description="t"))
    db.flush()
    red = Redemption(kid_id=kid.id, kind="screen_time", minutes=15, cost=20)
    db.add(red)
    db.commit()
    return red


@pytest.fixture
def other_kid_redemption(db, other_kid):
    """A pending reward redemption for `other_kid`, who is not linked to `install`."""
    from app.models.points import Points, PointsType
    from app.models.reward import Redemption, Reward

    rw = Reward(name="Movie", price=10)
    db.add(rw)
    db.add(Points(user_id=other_kid.id, points_type=PointsType.BONUS, amount=50, description="t"))
    db.flush()
    red = Redemption(kid_id=other_kid.id, kind="reward", reward_id=rw.id, cost=10)
    db.add(red)
    db.commit()
    return red


@pytest.fixture(autouse=True)
def clear_widget_caches():
    """The widget cache is a module global keyed by install id; empty it after each test."""
    yield
    from app.integrations import widget_service

    widget_service._cache.clear()


@pytest.fixture
def widget_install(db, install, svc):
    """`install` with widgets.parent and a DEMO manifest declaring parent widget w1.
    svc shares its secret."""
    from app.integrations.store import secret_of

    m = {
        **DEMO,
        "permissions": ["chores.complete", "widgets.parent"],
        "widgets": [{"id": "w1", "surface": "parent", "title": "Demo card"}],
    }
    install.manifest = json.dumps(sign_env(m))
    install.permissions = json.dumps(["widgets.parent", "chores.complete"])
    db.commit()
    svc.secret = secret_of(install)
    return install
