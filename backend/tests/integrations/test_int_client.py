import pytest
from app.integrations.client import BoxClient, InstallCtx, ProtocolError
from app.integrations.net import DEV
from app.integrations.protocol import grant_out as grant_out_for
from tests.integrations.fake_service import FakeService
from tests.integrations.int_helpers import cc

KID = (1, "Sam")


def ctx(secret):
    return InstallCtx("pid", "http://127.0.0.1:8787", secret, grant_out_for([], [KID], []))


def client(svc, secret="s"):
    return BoxClient(ctx(secret), policy=DEV, transport=svc.transport)


def test_poll_round_trip(resolve_to):
    resolve_to("127.0.0.1")
    svc = FakeService(secret="s", actions=[cc("a", 1, 2)])
    r = client(svc).poll()
    assert r.actions[0]["kid_id"] == 1 and svc.last_path == "/v1/poll"
    assert svc.last_signature_ok
    assert svc.last_body["protocol"] == "v1" and svc.last_body["install_id"] == "pid"


def test_reply_signed_with_wrong_secret_rejected(resolve_to):
    resolve_to("127.0.0.1")
    with pytest.raises(ProtocolError, match="signature"):
        client(FakeService(secret="other")).poll()


def test_reply_for_other_request_rejected(resolve_to):
    resolve_to("127.0.0.1")
    with pytest.raises(ProtocolError, match="request_id"):
        client(FakeService(secret="s", request_id_override="stale")).poll()


def test_too_many_actions_is_protocol_error(resolve_to):
    resolve_to("127.0.0.1")
    with pytest.raises(ProtocolError):
        client(FakeService(secret="s", actions=[cc(f"k{i}", 1, 2) for i in range(21)])).poll()


def test_endpoints_and_bad_shapes(resolve_to):
    resolve_to("127.0.0.1")
    svc = FakeService(secret="s", widgets=[{"id": "w"}])
    c = client(svc)
    assert c.widgets("home", 1).widgets == [{"id": "w"}]
    assert svc.last_body["surface"] == "home" and svc.last_body["kid_id"] == 1
    c.install({"a": 1})
    assert svc.last_body["settings"] == {"a": 1}
    c.events([{"x": 1}])
    c.uninstall()
    assert svc.last_path == "/v1/uninstall"
    with pytest.raises(ProtocolError, match="schema"):
        client(FakeService(secret="s", actions=["notadict"])).poll()


def test_names_and_chore_titles_only_with_permission():
    assert "first_name" not in grant_out_for([], [KID], [])["kids"][0]
    assert grant_out_for(["kid.name"], [KID], [])["kids"][0]["first_name"] == "Sam"
    assert grant_out_for([], [KID], [(2, "Dishes")])["chores"] == []
    assert grant_out_for(["chores.complete"], [KID], [(2, "Dishes")])["chores"] == [
        {"id": 2, "title": "Dishes"}
    ]
