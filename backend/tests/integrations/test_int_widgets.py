import pytest
from app.integrations.client import ProtocolError
from app.integrations.manifest import WidgetDecl
from app.integrations.permissions import PERMS, Grant
from app.integrations.widgets import sanitize
from tests.integrations.int_helpers import W, button, card, image, text


def _grant(*perms) -> Grant:
    return Grant(1, "Demo", frozenset(perms), frozenset(), frozenset(), frozenset(), False, True)


DECLS = [
    WidgetDecl(id="w1", surface="parent", title="One"),
    WidgetDecl(id="w2", surface="parent", title="Two"),
    WidgetDecl(id="kid_only", surface="kid", title="Kid"),
    WidgetDecl(id="kid_w", surface="kid", title="Kid w"),
]
GRANT = _grant("widgets.parent", "widgets.kid", "chores.complete")
GRANT_NO_DECIDE = GRANT
GRANT_ALL = _grant(*PERMS)


def test_sanitize_keeps_known_blocks_and_drops_ungranted_buttons():
    out, imgs = sanitize(
        [
            W(
                "w1",
                card(
                    text("Hi"), image("https://cdn.example/a.png"), button("b1", "request.decide")
                ),
            )
        ],
        DECLS,
        "parent",
        GRANT_NO_DECIDE,
    )
    kinds = [b["type"] for b in out[0]["root"]["children"]]
    assert kinds == ["text", "image"] and imgs == {"https://cdn.example/a.png"}


def test_granted_button_kept_on_parent():
    out, _ = sanitize([W("w1", card(button("b1", "request.decide")))], DECLS, "parent", GRANT_ALL)
    assert out[0]["root"]["children"][0]["action"] == "request.decide"


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "html", "html": "<b>x</b>"},
        {"type": "text", "text": "x", "onclick": "y"},
        {"type": "image", "url": "http://cdn.example/a.png", "alt": ""},
        {"type": "text", "text": "x", "link": "javascript:alert(1)"},
        {"type": "text", "text": "x", "link": "https://user:pw@evil.example/"},
        {"type": "text", "text": "x", "link": "https://good.example@evil.example/"},
        {"type": "image", "url": "https://u@cdn.example/a.png", "alt": ""},
        {"type": "text", "text": "x" * 201},
        {"type": "list", "items": ["a"] * 11},
        {"type": "progress", "label": "p", "value": 1, "max": 0},
        {"type": "button", "id": "Bad-Id", "label": "x", "action": "chore.complete"},
        {"type": "button", "id": "b", "label": "x", "action": "device.unlock"},
        {"type": "text", "text": "x", "link": "https://ex.example/" + "a" * 2048},
        {"type": "image", "url": "https://cdn.example/" + "a" * 2048, "alt": ""},
        {"type": "progress", "label": "p", "value": 5, "max": 4},
        {"type": "progress", "label": "p", "value": float("nan"), "max": 4},
        {"type": "progress", "label": "p", "value": 1, "max": float("inf")},
        card(button("b", "chore.complete"), card(button("b", "chore.complete"))),
    ],
)
def test_unsafe_blocks_rejected(bad):
    with pytest.raises(ProtocolError):
        sanitize([W("w1", bad)], DECLS, "parent", GRANT)


def test_strings_stay_plain_text():
    out, _ = sanitize([W("w1", text("<b>x</b><script>y</script>"))], DECLS, "parent", GRANT)
    assert out[0]["root"]["text"] == "<b>x</b><script>y</script>"


def test_https_link_kept():
    out, _ = sanitize([W("w1", text("x", link="https://ex.example/p"))], DECLS, "parent", GRANT)
    assert out[0]["root"]["link"] == "https://ex.example/p"


def test_undeclared_or_wrong_surface_dropped():
    out, _ = sanitize([W("kid_only", text("x")), W("w1", text("ok"))], DECLS, "parent", GRANT)
    assert [w["id"] for w in out] == ["w1"]


def test_invalid_widget_dropped_and_logged(caplog):
    out, _ = sanitize([W("w1", {"type": "html"}), W("w2", text("ok"))], DECLS, "parent", GRANT)
    assert [w["root"]["text"] for w in out] == ["ok"]
    assert "dropped widget" in caplog.text


def test_empty_input_is_fine():
    assert sanitize([], DECLS, "parent", GRANT) == ([], set())


def test_depth_and_size_caps():
    with pytest.raises(ProtocolError):
        sanitize([W("w1", card(card(card(card(text("deep"))))))], DECLS, "parent", GRANT)
    with pytest.raises(ProtocolError):
        sanitize([W("w1", card(card(card(text("deep")))))], DECLS, "parent", GRANT)
    sanitize([W("w1", card(card(text("ok"))))], DECLS, "parent", GRANT)
    many = card(*[card(*[text("t")] * 10) for _ in range(4)])  # 45 blocks
    with pytest.raises(ProtocolError):
        sanitize([W("w1", many)], DECLS, "parent", GRANT)
    with pytest.raises(ProtocolError):
        sanitize([W("w1", text("x"))] * 7, DECLS, "parent", GRANT)


def test_kid_surface_never_has_decide_buttons():
    out, _ = sanitize(
        [
            W(
                "kid_w",
                card(
                    button("b", "request.decide"),
                    button("r", "reward.upsert"),
                    button("c", "chore.complete"),
                    button("m", "message.parents"),
                ),
            )
        ],
        DECLS,
        "kid",
        GRANT_ALL,
    )
    assert [b["action"] for b in out[0]["root"]["children"]] == [
        "chore.complete",
        "message.parents",
    ]


def test_widget_that_is_only_a_dropped_button_is_dropped():
    with pytest.raises(ProtocolError):
        sanitize([W("kid_w", button("b", "request.decide"))], DECLS, "kid", GRANT_ALL)


URL = "/api/v1/integration-widgets?surface=parent"


def test_delete_forgets_widgets(client, parent_headers, widget_install, svc):
    svc.widgets = [W("w1", text("hi"))]
    assert client.get(URL, headers=parent_headers).json() != []
    client.delete(f"/api/v1/integrations/{widget_install.id}", headers=parent_headers)
    assert client.get(URL, headers=parent_headers).json() == []


def test_patch_forgets_widgets(client, parent_headers, widget_install, svc):
    from app.integrations import widget_service

    svc.widgets = [W("w1", text("hi"))]
    client.get(URL, headers=parent_headers)
    assert widget_service._cache
    client.patch(
        f"/api/v1/integrations/{widget_install.id}", json={"trusted": True}, headers=parent_headers
    )
    assert not widget_service._cache


def test_retire_forgets_widgets(db, widget_install):
    from app.integrations import store, widget_service

    widget_service._cache[(widget_install.id, "parent", None)] = (1e18, [], set())
    store.retire(db, widget_install, "revoked")
    assert not widget_service._cache


def test_parent_endpoint_frames_with_name_and_proxies_images(
    client, parent_headers, widget_install, svc
):
    from app.integrations import widget_service

    svc.widgets = [W("w1", image("https://cdn.example/a.png"))]
    [g] = client.get(URL, headers=parent_headers).json()
    assert (g["install_id"], g["name"], g["icon"]) == (widget_install.id, "Demo", "extension")
    assert g["widgets"][0]["root"]["url"].startswith(
        f"/integration-widgets/{widget_install.id}/image?u=https%3A"
    )
    assert widget_service.image_allowed(widget_install.id, "https://cdn.example/a.png")
    assert not widget_service.image_allowed(widget_install.id, "https://cdn.example/b.png")


def test_button_lookup(client, parent_headers, widget_install, svc):
    from app.integrations import widget_service

    svc.widgets = [W("w1", card(text("x"), button("b1", "chore.complete")))]
    client.get(URL, headers=parent_headers)
    b = widget_service.button(widget_install.id, "parent", None, "w1", "b1")
    assert b["action"] == "chore.complete"
    assert widget_service.button(widget_install.id, "parent", None, "w1", "nope") is None
    assert widget_service.button(widget_install.id, "kid", 1, "w1", "b1") is None


def test_cached_for_60s(client, parent_headers, widget_install, svc):
    for _ in range(3):
        client.get(URL, headers=parent_headers)
    assert svc.calls == 1


def test_cache_expires_after_ttl(db, widget_install, svc):
    from app.integrations import widget_service

    svc.widgets = [W("w1", text("hi"))]
    widget_service.get(db, widget_install, "parent", None, 1000.0)
    widget_service.get(db, widget_install, "parent", None, 1000.0 + widget_service.TTL - 1)
    assert svc.calls == 1
    widget_service.get(db, widget_install, "parent", None, 1000.0 + widget_service.TTL)
    assert svc.calls == 2


def test_service_down_shows_nothing_not_500(client, parent_headers, widget_install, svc):
    svc.fail()
    assert client.get(URL, headers=parent_headers).json() == []


def test_junk_widgets_show_nothing_and_count_as_failure(
    client, parent_headers, widget_install, svc
):
    from tests.integrations.int_helpers import db_install

    svc.widgets = [W("w1", {"type": "html", "html": "<b>x</b>"})]
    assert client.get(URL, headers=parent_headers).json() == []
    assert db_install(widget_install.id).failures == 1


def test_install_without_widget_perm_is_skipped(client, parent_headers, install, svc):
    svc.widgets = [W("w1", text("hi"))]
    assert client.get(URL, headers=parent_headers).json() == []
    assert svc.calls == 0


def test_kids_cannot_read_parent_widgets(client, kid_headers):
    assert client.get(URL, headers=kid_headers).status_code in (401, 403)


def test_progress_at_max_is_fine():
    p = {"type": "progress", "label": "p", "value": 4, "max": 4}
    assert sanitize([W("w1", p)], DECLS, "parent", GRANT)[0][0]["root"]["value"] == 4


def test_first_widget_per_id_wins():
    out, _ = sanitize(
        [W("w1", text("first")), W("w1", text("second")), W("w2", text("other"))],
        DECLS,
        "parent",
        GRANT,
    )
    assert [(w["id"], w["root"]["text"]) for w in out] == [("w1", "first"), ("w2", "other")]


def test_pause_forgets_widgets(db, widget_install):
    from app.integrations import health, widget_service

    widget_service._cache[(widget_install.id, "parent", None)] = (1e18, [], {"https://x.example/a"})
    for _ in range(health.FAIL_LIMIT - 1):
        health.fail(db, widget_install, "bad reply")
    assert widget_service.image_allowed(widget_install.id, "https://x.example/a")
    health.fail(db, widget_install, "bad reply")
    assert widget_install.status == "paused" and not widget_service._cache


def test_cache_is_thread_safe(monkeypatch):
    """Readers and forget() run while another thread fills the cache."""
    import sys
    import threading
    import time
    from types import SimpleNamespace

    from app.integrations import widget_service

    monkeypatch.setattr(widget_service, "_fetch", lambda db, i, s, k: ([], {"u"}))
    for n in range(2000):  # long iterations make a mid-loop insert likely
        widget_service._cache[(n, "parent", None)] = (1e18, [], {"u"})
    old = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    stop, errors = threading.Event(), []

    def fill():
        n = 0
        try:
            while not stop.is_set():
                n += 1
                widget_service.get(None, SimpleNamespace(id=9999), "kid", n, time.time())
        except Exception as e:  # pragma: no cover - only on a race
            errors.append(e)

    t = threading.Thread(target=fill)
    t.start()
    try:
        for _ in range(100):
            widget_service.image_allowed(7, "nope")
            widget_service.forget(-1)
    except RuntimeError as e:  # dictionary changed size during iteration
        errors.append(e)
    finally:
        stop.set()
        t.join()
        sys.setswitchinterval(old)
    assert not errors
