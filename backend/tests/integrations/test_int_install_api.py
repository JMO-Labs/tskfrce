"""Install / uninstall / settings API: catalog listing, install checks, PATCH, DELETE, log."""

import json

import pytest
from app.integrations import store
from app.integrations.manifest import load_manifest
from app.models.chores import Chore
from app.models.integration import IntegrationAction, IntegrationInstall, IntegrationKid
from app.models.reward import Reward
from tests.factories import make_chore
from tests.integrations.int_helpers import DEMO, db_install, install_body

URL = "/api/v1/integrations"


def _post(client, headers, body):
    return client.post(URL, headers=headers, json=body)


# --- catalog ---------------------------------------------------------------------------------


def test_catalog_lists_verified_and_hides_revoked(client, parent_headers, synced_catalog):
    items = {i["id"]: i for i in client.get(f"{URL}/catalog", headers=parent_headers).json()}
    assert set(items) == {"demo", "kidcards"}
    demo = items["demo"]
    assert demo["domain"] == "svc.example" and demo["installed"] is False
    assert demo["permissions"][0] == {
        "id": "chores.complete",
        "text": "Mark linked chores done (it sees their names)",
        "high_risk": False,
    }
    assert [s["key"] for s in demo["settings"]] == ["username", "api_key", "level", "mode"]
    assert items["kidcards"]["widgets"][0]["surface"] == "kid"


def test_catalog_without_cache_503(client, parent_headers, monkeypatch, tmp_path):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    r = client.get(f"{URL}/catalog", headers=parent_headers)
    assert r.status_code == 503
    assert r.json()["detail"] == "We couldn't load the list yet. Try again in a minute."


# --- install ---------------------------------------------------------------------------------


def test_install_happy_path(client, parent_headers, synced_catalog, svc, kid):
    r = _post(client, parent_headers, install_body(kid))
    assert r.status_code == 201 and svc.last_path == "/v1/install"
    row = db_install(r.json()["id"])
    assert row.trusted is False and row.secret and svc.last_body["settings"]["username"] == "sam"
    assert "api_key" not in (row.settings or "")  # secret field never stored
    assert (row.integration_id, row.name) == ("demo", "Demo")
    assert load_manifest(json.loads(row.manifest)).id == "demo"
    d = client.get(f"{URL}/{row.id}", headers=parent_headers).json()
    assert d["developer"] == DEMO["developer"] and d["domain"] == "svc.example"
    assert d["settings"] == {"username": "sam", "mode": "easy"}


def test_install_sends_secret_once_and_seals_box_generated_secret(
    client, parent_headers, synced_catalog, svc, kid
):
    r = _post(client, parent_headers, install_body(kid))
    row = db_install(r.json()["id"])
    sent = svc.last_body
    assert sent["settings"]["api_key"] == "k-123" and svc.last_signature_ok
    secret = store.secret_of(row)  # sealed with purpose "integrations"
    assert sent["secret"] == secret and len(secret) >= 43
    assert secret not in row.secret and "k-123" not in json.dumps(
        {c.name: getattr(row, c.name) for c in row.__table__.columns}, default=str
    )
    assert sent["install_id"] == row.public_id and row.status == "active"
    assert row.next_poll_at is None  # DEMO has no poll_seconds


def test_client_for_reads_pinned_manifest(client, parent_headers, synced_catalog, svc, kid, db):
    row = db_install(_post(client, parent_headers, install_body(kid)).json()["id"])
    c = store.client_for(db, row)
    assert c.ctx.base_url == "https://svc.example" and c.ctx.public_id == row.public_id
    assert c.ctx.grant_out["kids"] == [{"id": kid.id}]


def test_install_links_only_picked_kids_and_chores(
    client, parent_headers, synced_catalog, svc, kid, other_kid, parent, db
):
    chore, _ = make_chore(db, parent, kids=[kid])
    make_chore(db, parent, kids=[kid])  # not picked
    body = install_body(kid, chore_ids=[chore.id])
    row = db_install(_post(client, parent_headers, body).json()["id"])
    assert [k.kid_id for k in row.kids] == [kid.id]
    assert [c.chore_id for c in row.chores] == [chore.id]
    assert svc.last_body["grant"]["chores"] == [{"id": chore.id, "title": chore.title}]
    assert json.loads(row.permissions) == ["chores.complete"]


def test_install_with_poll_and_kid_widgets(client, parent_headers, synced_catalog, svc, kid):
    body = install_body(
        kid,
        integration_id="kidcards",
        settings={},
        kid_widget_ids=[kid.id],
        accepted_permissions=["widgets.kid", "chores.complete"],
    )
    r = _post(client, parent_headers, body)
    assert r.status_code == 201 and r.json()["kid_ids"] == [kid.id]
    row = db_install(r.json()["id"])
    assert row.next_poll_at is not None and row.kids[0].kid_widgets is True


@pytest.mark.parametrize("iid", ["nope", "gone"])
def test_unknown_or_revoked_404(client, parent_headers, synced_catalog, svc, kid, iid, db):
    r = _post(client, parent_headers, install_body(kid, integration_id=iid))
    assert r.status_code == 404 and r.json()["detail"] == "That integration isn't available."
    assert svc.last_path is None and db.query(IntegrationInstall).count() == 0


def test_already_connected_409(client, parent_headers, synced_catalog, svc, kid):
    assert _post(client, parent_headers, install_body(kid)).status_code == 201
    r = _post(client, parent_headers, install_body(kid))
    assert r.status_code == 409 and r.json()["detail"] == "That's already connected."


def test_permission_mismatch_409(client, parent_headers, synced_catalog, kid):
    body = install_body(kid, accepted_permissions=["chores.complete", "kid.name"])
    r = _post(client, parent_headers, body)
    assert r.status_code == 409
    assert r.json()["detail"] == "The permissions changed. Look them over again."


@pytest.mark.parametrize(
    "settings,detail",
    [
        ({"api_key": "k", "mode": "easy"}, "Username is required"),
        ({"username": "", "api_key": "k", "mode": "easy"}, "Username is required"),
        ({"username": "s", "api_key": "k", "mode": "easy", "level": "x"}, "Level must be a number"),
        ({"username": "s", "api_key": "k", "mode": "mid"}, "Mode isn't one of the choices"),
    ],
)
def test_settings_checked(client, parent_headers, synced_catalog, svc, kid, settings, detail):
    r = _post(client, parent_headers, install_body(kid, settings=settings))
    assert r.status_code == 422 and r.json()["detail"] == detail and svc.last_path is None


def test_settings_strings_capped(client, parent_headers, synced_catalog, svc, kid):
    s = {"username": "x" * 201, "api_key": "k", "mode": "easy"}
    assert _post(client, parent_headers, install_body(kid, settings=s)).status_code == 422


def test_number_setting_stored(client, parent_headers, synced_catalog, svc, kid):
    s = {"username": "s", "api_key": "k", "mode": "hard", "level": "7"}
    row = db_install(_post(client, parent_headers, install_body(kid, settings=s)).json()["id"])
    assert json.loads(row.settings)["level"] == 7 and svc.last_body["settings"]["level"] == 7


def test_grants_must_be_family_kids_and_real_chores(
    client, parent_headers, synced_catalog, svc, kid, parent, db
):
    for over in (
        {"kid_ids": [parent.id]},  # not a kid
        {"kid_ids": [9999]},
        {"kid_ids": []},
        {"chore_ids": [9999]},
        {"kid_widget_ids": [kid.id]},  # demo lacks widgets.kid
    ):
        assert _post(client, parent_headers, install_body(kid, **over)).status_code == 422, over
    assert svc.last_path is None


def test_kid_widgets_must_be_linked_kids(
    client, parent_headers, synced_catalog, svc, kid, other_kid
):
    body = install_body(
        kid,
        integration_id="kidcards",
        settings={},
        kid_widget_ids=[other_kid.id],
        accepted_permissions=["chores.complete", "widgets.kid"],
    )
    assert _post(client, parent_headers, body).status_code == 422


def test_service_down_leaves_nothing(client, parent_headers, synced_catalog, svc, kid, db):
    svc.fail()
    r = _post(client, parent_headers, install_body(kid))
    assert (
        r.status_code == 502 and r.json()["detail"] == "Demo didn't answer. Nothing was connected."
    )
    assert db.query(IntegrationInstall).count() == 0 and db.query(IntegrationKid).count() == 0


def test_install_reply_actions_ignored(client, parent_headers, synced_catalog, svc, kid, db):
    svc.actions = [{"type": "message.parents", "idempotency_key": "m", "title": "hi"}]
    assert _post(client, parent_headers, install_body(kid)).status_code == 201
    assert db.query(IntegrationAction).count() == 0


# --- auth ------------------------------------------------------------------------------------


def test_kid_cannot_install(client, kid_headers, synced_catalog, kid):
    assert _post(client, kid_headers, install_body(kid)).status_code == 403


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/catalog"),
        ("get", ""),
        ("get", "/{id}"),
        ("patch", "/{id}"),
        ("delete", "/{id}"),
        ("get", "/{id}/log"),
    ],
)
def test_every_route_parent_only(client, kid_headers, install, svc, method, path):
    url = URL + path.format(id=install.id)
    kw = {"json": {"trusted": True}} if method == "patch" else {}
    assert getattr(client, method)(url, headers=kid_headers, **kw).status_code == 403
    assert svc.last_path is None


# --- list / detail ---------------------------------------------------------------------------


def test_list_and_detail(client, parent_headers, install, kid, db):
    items = client.get(URL, headers=parent_headers).json()
    assert [i["id"] for i in items] == [install.id]
    assert items[0]["kid_ids"] == [kid.id] and items[0]["source"] == "catalog"
    d = client.get(f"{URL}/{install.id}", headers=parent_headers).json()
    chore = db.get(Chore, install.chores[0].chore_id)
    assert d["kids"] == [{"id": kid.id, "name": "Timmy", "kid_widgets": False}]
    assert d["chores"] == [{"id": chore.id, "title": chore.title}]
    assert d["permissions"][0]["id"] == "chores.complete" and d["settings"] == {}


def test_detail_of_local_install_has_no_domain(client, parent_headers, install, db):
    install.source, install.manifest, install.integration_id = "local", None, None
    db.commit()
    d = client.get(f"{URL}/{install.id}", headers=parent_headers).json()
    assert d["domain"] is None and d["developer"] is None


def test_removed_hidden_from_list(client, parent_headers, install, db):
    install.status = "removed"
    db.commit()
    assert client.get(URL, headers=parent_headers).json() == []
    assert client.get(f"{URL}/{install.id}", headers=parent_headers).status_code == 404


# --- patch -----------------------------------------------------------------------------------


def test_trust_toggle_and_resume(client, parent_headers, db, install):
    install.status, install.failures, install.paused_reason = "paused", 5, "It stopped answering."
    db.commit()
    r = client.patch(
        f"{URL}/{install.id}", headers=parent_headers, json={"trusted": True, "resume": True}
    )
    assert r.json()["trusted"] is True and r.json()["status"] == "active"
    db.refresh(install)
    assert install.failures == 0 and install.paused_reason is None


def test_resume_revoked_409(client, parent_headers, db, install):
    install.status, install.secret = "revoked", None
    db.commit()
    r = client.patch(f"{URL}/{install.id}", headers=parent_headers, json={"resume": True})
    assert r.status_code == 409 and r.json()["detail"] == "t@sk4ce turned this one off."


def test_kid_toggle_requires_permission(client, parent_headers, install, kid):
    r = client.patch(
        f"{URL}/{install.id}", headers=parent_headers, json={"kid_widget_ids": [kid.id]}
    )
    assert r.status_code == 422  # install lacks widgets.kid


@pytest.mark.parametrize("install", [["chores.complete", "widgets.kid"]], indirect=True)
def test_kid_toggle_within_grant(client, parent_headers, install, kid, other_kid, db):
    u = f"{URL}/{install.id}"
    assert client.patch(u, headers=parent_headers, json={"kid_widget_ids": [kid.id]}).is_success
    db.refresh(install.kids[0])
    assert install.kids[0].kid_widgets is True
    r = client.patch(u, headers=parent_headers, json={"kid_widget_ids": [other_kid.id]})
    assert r.status_code == 422  # not a linked kid
    assert client.patch(u, headers=parent_headers, json={"kid_widget_ids": []}).is_success
    db.refresh(install.kids[0])
    assert install.kids[0].kid_widgets is False


# --- delete / log ----------------------------------------------------------------------------


def test_uninstall_calls_service_signed(client, parent_headers, db, install, svc):
    svc.secret = store.secret_of(install)
    assert client.delete(f"{URL}/{install.id}", headers=parent_headers).status_code == 204
    assert svc.last_path == "/v1/uninstall" and svc.last_signature_ok
    db.refresh(install)
    assert install.removed_at is not None


def test_uninstall_keeps_log_and_drops_secret_and_rewards(client, parent_headers, db, install, svc):
    db.add(Reward(name="Owned", price=5, integration_install_id=install.id, integration_ref="r1"))
    db.add(
        IntegrationAction(
            install_id=install.id, kind="chore.complete", idempotency_key="a", result="applied"
        )
    )
    db.commit()
    assert client.delete(f"{URL}/{install.id}", headers=parent_headers).status_code == 204
    db.refresh(install)
    assert install.secret is None and install.status == "removed"
    assert db.query(Reward).filter_by(integration_ref="r1").one().active is False
    log = client.get(f"{URL}/{install.id}/log", headers=parent_headers)
    assert log.status_code == 200 and log.json()[0]["kind"] == "chore.complete"


def test_uninstall_when_service_down_still_removes(client, parent_headers, install, svc, db):
    svc.fail()
    assert client.delete(f"{URL}/{install.id}", headers=parent_headers).status_code == 204
    db.refresh(install)
    assert install.status == "removed"


def test_remove_after_revoke_skips_uninstall(client, parent_headers, db, install, svc):
    install.status, install.secret = "revoked", None
    db.commit()
    assert client.delete(f"{URL}/{install.id}", headers=parent_headers).status_code == 204
    assert svc.last_path is None  # no uninstall call without a secret


def test_reinstall_after_remove(client, parent_headers, synced_catalog, svc, kid):
    first = _post(client, parent_headers, install_body(kid)).json()["id"]
    assert client.delete(f"{URL}/{first}", headers=parent_headers).status_code == 204
    assert _post(client, parent_headers, install_body(kid)).status_code == 201


def test_log_newest_first_with_names(client, parent_headers, install, kid, db):
    chore_id = install.chores[0].chore_id
    for i in range(3):
        db.add(
            IntegrationAction(
                install_id=install.id,
                kind="chore.complete",
                idempotency_key=f"k{i}",
                result="rejected",
                reason=f"r{i}",
                kid_id=kid.id,
                chore_id=chore_id,
            )
        )
    db.commit()
    rows = client.get(f"{URL}/{install.id}/log?limit=2", headers=parent_headers).json()
    assert [r["reason"] for r in rows] == ["r2", "r1"]
    assert rows[0]["kid_name"] == "Timmy" and rows[0]["chore_title"]
    assert (
        client.get(f"{URL}/{install.id}/log?limit=201", headers=parent_headers).status_code == 422
    )
