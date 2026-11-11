"""A kid with the chores lock off never keeps a device waiting on chores."""

from tests.test_e2e_lock import MAC, _kid_with_chore, blocked


def test_kid_lock_off_frees_device(client, db):
    ph, kid, dev, *_ = _kid_with_chore(client)
    assert blocked(client) == [MAC]
    r = client.patch(f"/api/v1/kids/{kid['id']}", json={"chores_lock": False}, headers=ph)
    assert r.status_code == 200 and r.json()["chores_lock"] is False
    assert blocked(client) == []
    client.patch(f"/api/v1/kids/{kid['id']}", json={"chores_lock": True}, headers=ph)
    assert blocked(client) == [MAC]
