"""Homework site lists: starter (read-only), family allow/block, per-kid allow."""

from app.services.homework_domains import STARTER

URL = "/api/v1/homework/sites"


def _add(client, h, domain, kind="allow", kid_id=None):
    return client.post(URL, json={"domain": domain, "kind": kind, "kid_id": kid_id}, headers=h)


def _del(client, h, domain, kind="allow", kid_id=None):
    body = {"domain": domain, "kind": kind, "kid_id": kid_id}
    return client.request("DELETE", URL, json=body, headers=h)


def _sites(client, h):
    return client.get(URL, headers=h).json()


def test_family_allow_from_pasted_url(client, parent_headers):
    r = _add(client, parent_headers, "https://Math.Example.com/u/0/")
    assert r.status_code == 200, r.text
    assert r.json() == {"domain": "math.example.com", "kind": "allow", "kid_id": None}
    s = _sites(client, parent_headers)
    assert s["allow"] == ["math.example.com"]
    assert s["starter"] == list(STARTER)


def test_per_kid_allow_only_under_that_kid(client, parent_headers, kid):
    assert _add(client, parent_headers, "spelling.example", kid_id=kid.id).status_code == 200
    s = _sites(client, parent_headers)
    assert s["kids"] == {str(kid.id): ["spelling.example"]}
    assert s["allow"] == []


def test_block_removes_family_allow(client, parent_headers):
    _add(client, parent_headers, "games.example")
    assert _add(client, parent_headers, "games.example", "block").status_code == 200
    s = _sites(client, parent_headers)
    assert s["allow"] == [] and s["block"] == ["games.example"]


def test_duplicate_is_noop(client, parent_headers):
    _add(client, parent_headers, "math.example.com")
    assert _add(client, parent_headers, "MATH.example.com.").status_code == 200
    assert _sites(client, parent_headers)["allow"] == ["math.example.com"]


def test_block_with_kid_is_400(client, parent_headers, kid):
    r = _add(client, parent_headers, "games.example", "block", kid.id)
    assert r.status_code == 400
    assert r.json()["detail"] == "Blocks apply to the whole family."


def test_junk_is_400(client, parent_headers):
    r = _add(client, parent_headers, "not a site")
    assert r.status_code == 400
    assert r.json()["detail"] == "That doesn't look like a website address."


def test_unknown_kid_is_404(client, parent_headers):
    r = _add(client, parent_headers, "a.example", kid_id=999)
    assert r.status_code == 404
    assert r.json()["detail"] == "We couldn't find that kid."


def test_delete(client, parent_headers, kid):
    _add(client, parent_headers, "a.example")
    _add(client, parent_headers, "b.example", kid_id=kid.id)
    assert _del(client, parent_headers, "https://a.example/").status_code == 204
    assert _del(client, parent_headers, "b.example", kid_id=kid.id).status_code == 204
    s = _sites(client, parent_headers)
    assert s["allow"] == [] and s["kids"] == {}


def test_starter_entry_cannot_be_deleted(client, parent_headers):
    r = _del(client, parent_headers, STARTER[0])
    assert r.status_code == 404
    assert r.json()["detail"] == "That site is on the built-in list."


def test_kid_token_is_403(client, kid_headers):
    assert client.get(URL, headers=kid_headers).status_code == 403
    assert _add(client, kid_headers, "a.example").status_code == 403
