import ast
from dataclasses import replace
from pathlib import Path

import app.integrations
import pytest
from app.integrations.permissions import ACTION_PERM, PERMS, Denied, Grant, check_action
from app.integrations.protocol import ACTION_MODELS, parse_action
from int_helpers import cc, msg, rd, ru

G = Grant(
    1, "Demo", frozenset({"chores.complete"}), frozenset({5}), frozenset({9}),
    frozenset(), trusted=False, active=True,
)  # fmt: skip


def imported_modules(tree):
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            yield from (a.name for a in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module:
            yield n.module


def test_untrusted_completion_needs_approval():
    assert check_action(G, parse_action(cc("k", 5, 9))) is True


def test_trusted_completion_applies():
    assert check_action(replace(G, trusted=True), parse_action(cc("k", 5, 9))) is False


def test_kid_button_never_auto_applies():
    assert check_action(replace(G, trusted=True), parse_action(cc("k", 5, 9)), "kid_button", 5)


@pytest.mark.parametrize(
    "raw",
    [ru("k", ref="r"), {"type": "reward.remove", "idempotency_key": "k", "ref": "r"},
     rd("k", "reward", 1, True)],
)  # fmt: skip
def test_kid_button_can_only_ask(raw):
    g = replace(G, permissions=frozenset(PERMS))
    with pytest.raises(Denied, match="kids can only ask"):
        check_action(g, parse_action(raw), "kid_button", 5)


def test_kid_button_other_kid():
    g = replace(G, kid_ids=frozenset({5, 6}))
    with pytest.raises(Denied, match="kid not linked"):
        check_action(g, parse_action(cc("k", 6, 9)), "kid_button", 5)


def test_paused():
    with pytest.raises(Denied, match="integration is paused"):
        check_action(replace(G, active=False), parse_action(cc("k", 5, 9)))


@pytest.mark.parametrize("kid,chore,reason", [(6, 9, "kid not linked"), (5, 8, "chore not linked")])
def test_scope(kid, chore, reason):
    with pytest.raises(Denied, match=reason):
        check_action(G, parse_action(cc("k", kid, chore)))


def test_missing_permission():
    with pytest.raises(Denied, match="not allowed"):
        check_action(G, parse_action(msg("k")))


def test_bad_action_and_extra_fields():
    with pytest.raises(ValueError, match="bad action"):
        parse_action({**cc("k", 5, 9), "extra": 1})
    with pytest.raises(ValueError, match="bad action"):
        parse_action(cc("bad key!", 5, 9))


@pytest.mark.parametrize(
    "t",
    ["device.unlock", "hours.set", "lock.off", "homework.start",
     "blocker.allow", "screen_time.grant", "override.add"],
)  # fmt: skip
def test_anti_goal_actions_do_not_exist(t):
    with pytest.raises(ValueError, match="unknown action"):
        parse_action({"type": t, "idempotency_key": "k"})


def test_integrations_never_import_lock_or_homework():
    banned = ("app.lock", "app.models.lock", "app.models.hours", "app.models.screen_time",
              "app.services.screen_time", "app.api.devices", "app.api.hours")  # fmt: skip
    for path in Path(app.integrations.__file__).parent.glob("*.py"):
        for mod in imported_modules(ast.parse(path.read_text())):
            assert not mod.startswith(banned) and "homework" not in mod, (path.name, mod)


def test_every_action_maps_to_a_permission():
    assert set(ACTION_PERM) == {a.model_fields["type"].default for a in ACTION_MODELS}
    assert set(ACTION_PERM.values()) <= set(PERMS)


def test_high_risk_flags():
    assert {k for k, p in PERMS.items() if p.high_risk} == {"requests.decide", "widgets.kid"}


@pytest.mark.parametrize("raw", [{"type": []}, {"type": {}}, {}, None, [], "x", 5])
def test_untrusted_shapes_raise_value_error(raw):
    with pytest.raises(ValueError, match="unknown action"):
        parse_action(raw)
