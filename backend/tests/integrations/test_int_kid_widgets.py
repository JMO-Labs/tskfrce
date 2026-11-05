def test_kid_sees_only_enabled_installs(
    client, kid_headers, kid_widget_install, widget_install_not_enabled, svc
):
    groups = client.get("/api/v1/integration-widgets/kid", headers=kid_headers).json()
    assert [g["install_id"] for g in groups] == [kid_widget_install.id]


def test_kid_widget_request_carries_only_that_kid(
    client, kid_headers, kid_widget_install, svc, kid
):
    client.get("/api/v1/integration-widgets/kid", headers=kid_headers)
    assert [k["id"] for k in svc.last_body["grant"]["kids"]] == [kid.id]
    assert svc.last_body["kid_id"] == kid.id


def test_other_linked_kid_is_not_in_the_grant(
    client, kid_headers, kid_widget_install, svc, run_other, kid
):
    client.get("/api/v1/integration-widgets/kid", headers=kid_headers)
    assert [k["id"] for k in svc.last_body["grant"]["kids"]] == [kid.id]


def test_parent_cannot_call_kid_feed(client, parent_headers):
    assert client.get("/api/v1/integration-widgets/kid", headers=parent_headers).status_code == 403


def _opt_in(db, install, kid):
    from app.models.integration import IntegrationKid

    db.query(IntegrationKid).filter_by(install_id=install.id, kid_id=kid.id).update(
        {"kid_widgets": True}
    )
    db.commit()


def test_siblings_get_separate_cards_and_images(
    client, db, kid_widget_install, svc, run_other, kid_headers, other_kid_headers, other_kid
):
    from tests.integrations.int_helpers import W, card, image, img_path

    _opt_in(db, kid_widget_install, other_kid)
    from app.integrations import widget_service

    widget_service._cache.clear()  # the fixture cached kid_w for the first kid only
    a, b = "https://cdn.example/a.png", "https://cdn.example/b.png"
    svc.widgets = [W("kid_w", card(image(a)))]
    ga = client.get("/api/v1/integration-widgets/kid", headers=kid_headers).json()
    svc.widgets = [W("kid_w", card(image(b)))]
    gb = client.get("/api/v1/integration-widgets/kid", headers=other_kid_headers).json()
    assert "a.png" in str(ga) and "b.png" not in str(ga)
    assert "b.png" in str(gb) and "a.png" not in str(gb)
    # each kid can open only their own image
    assert client.get(img_path(kid_widget_install, b), headers=kid_headers).status_code == 404
    assert client.get(img_path(kid_widget_install, a), headers=other_kid_headers).status_code == 404


def test_paused_install_is_not_in_kid_feed(client, db, kid_headers, kid_widget_install):
    kid_widget_install.status = "paused"
    db.commit()
    assert client.get("/api/v1/integration-widgets/kid", headers=kid_headers).json() == []


def test_revoked_widgets_kid_is_not_in_kid_feed(client, db, kid_headers, kid_widget_install):
    kid_widget_install.permissions = '["chores.complete", "widgets.parent"]'
    db.commit()
    assert client.get("/api/v1/integration-widgets/kid", headers=kid_headers).json() == []
