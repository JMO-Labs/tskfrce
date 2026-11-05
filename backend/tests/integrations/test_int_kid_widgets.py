def test_kid_sees_only_enabled_installs(
    client, kid_headers, kid_widget_install, widget_install_not_enabled, svc
):
    groups = client.get("/api/v1/integration-widgets/kid", headers=kid_headers).json()
    assert [g["install_id"] for g in groups] == [kid_widget_install.id]


def test_kid_widget_request_carries_only_that_kid(
    client, kid_headers, kid_widget_install, svc, kid
):
    from app.integrations import widget_service

    widget_service._cache.clear()
    client.get("/api/v1/integration-widgets/kid", headers=kid_headers)
    assert [k["id"] for k in svc.last_body["grant"]["kids"]] == [kid.id]
    assert svc.last_body["kid_id"] == kid.id


def test_other_linked_kid_is_not_in_the_grant(
    client, kid_headers, kid_widget_install, svc, run_other, kid
):
    from app.integrations import widget_service

    widget_service._cache.clear()
    client.get("/api/v1/integration-widgets/kid", headers=kid_headers)
    assert [k["id"] for k in svc.last_body["grant"]["kids"]] == [kid.id]


def test_parent_cannot_call_kid_feed(client, parent_headers):
    assert client.get("/api/v1/integration-widgets/kid", headers=parent_headers).status_code == 403
