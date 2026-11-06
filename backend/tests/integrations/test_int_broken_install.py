"""One broken install (rotated manifest key, lost secret) must not break the widget feeds."""

import json
import secrets
import time

import pytest
from app.core.crypto import seal
from app.integrations import widget_service
from app.models.integration import IntegrationInstall, IntegrationKid
from tests.integrations.int_helpers import DEMO, W, button, card, other_signer, press_url, text

FEED, KID_FEED = "/api/v1/integration-widgets", "/api/v1/integration-widgets/kid"
PERMS = ["widgets.parent", "widgets.kid"]


def _broken(db, parent, kid, name, manifest, secret):
    inst = IntegrationInstall(
        public_id=secrets.token_hex(16),
        source="catalog",
        integration_id="demo",
        name=name,
        icon="extension",
        manifest=json.dumps(manifest),
        permissions=json.dumps(PERMS),
        secret=secret,
        status="active",
        created_by_id=parent.id,
    )
    db.add(inst)
    db.flush()
    db.add(IntegrationKid(install_id=inst.id, kid_id=kid.id, kid_widgets=True))
    db.commit()
    return inst


@pytest.fixture
def broken(db, parent, kid, kid_widget_install):
    """Two installs that raise outside the protocol: a manifest signed by a key the box no
    longer trusts, and a secret that won't unseal."""
    m = {
        **DEMO,
        "permissions": PERMS,
        "widgets": [
            {"id": "w1", "surface": "parent", "title": "Card"},
            {"id": "kid_w", "surface": "kid", "title": "Kid card"},
        ],
    }
    from tests.integrations.int_helpers import sign_env

    good_secret = seal(secrets.token_urlsafe(32), purpose="integrations")
    rotated = _broken(db, parent, kid, "Rotated", other_signer().sign(m), good_secret)
    unsealable = _broken(db, parent, kid, "Lost", sign_env(m), "not-a-sealed-secret")
    widget_service._cache.clear()
    return rotated, unsealable


def _names(r):
    assert r.status_code == 200
    return [g["name"] for g in r.json()]


def test_parent_feed_survives_broken_installs(client, parent_headers, svc, broken):
    svc.widgets = [W("w1", card(text("hi")))]
    assert _names(client.get(FEED, headers=parent_headers)) == ["Demo"]


def test_kid_feed_survives_broken_installs(client, kid_headers, svc, broken):
    svc.widgets = [W("kid_w", card(text("hi")))]
    assert _names(client.get(KID_FEED, headers=kid_headers)) == ["Demo"]


def test_broken_installs_count_failures(client, db, parent_headers, svc, broken):
    svc.widgets = [W("w1", card(text("hi")))]
    client.get(FEED, headers=parent_headers)
    for inst in broken:
        db.refresh(inst)
        assert inst.failures == 1


@pytest.mark.parametrize("which", [0, 1])
def test_press_on_broken_install_is_clean(client, parent_headers, broken, which):
    inst = broken[which]
    w = W("w1", card(button("done", "chore.complete")))
    with widget_service._lock:  # shown before it broke
        widget_service._cache[(inst.id, "parent", None)] = (time.time() + 60, [w], set())
    r = client.post(
        press_url(inst), headers=parent_headers, json={"widget_id": "w1", "button_id": "done"}
    )
    assert r.status_code == 502
