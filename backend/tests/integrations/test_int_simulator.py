import ast
import json
from pathlib import Path

import pytest
from app.integrations import client, simulator
from app.integrations.manifest import Manifest, load_dev_manifest
from app.integrations.net import DEV, STRICT
from app.integrations.simulator import ALL_STEPS, main, run_simulation
from pydantic import ValidationError
from tests.integrations.fake_service import FakeService
from tests.integrations.int_helpers import DEMO, DEMO_DEV_MANIFEST, W, button, card, cc

REPO = Path(__file__).resolve().parents[3]
EXAMPLE = REPO / "examples/integration-hello"


def example_manifest(url: str) -> Manifest:
    return load_dev_manifest(EXAMPLE / "manifest.json").model_copy(update={"base_url": url})


def test_example_passes_simulator(example_server, capsys):
    assert run_simulation(example_manifest(example_server.url), DEV, ALL_STEPS) is True
    out = capsys.readouterr().out
    assert "FAIL" not in out and "PASS replay" in out
    for step in set(ALL_STEPS) - {"events"}:
        assert f"PASS {step}" in out, step
    assert "SKIP events" in out  # the example subscribes to no events


def test_example_actions_are_always_done(example_server, capsys):
    run_simulation(example_manifest(example_server.url), DEV, ["install", "poll", "press"])
    out = capsys.readouterr().out
    assert "PASS poll: 1 action" in out and "PASS press done: 1 action" in out


def test_wrong_secret_service_fails(capsys):
    svc = FakeService(secret="other", learns_secret=False)
    assert run_simulation(DEMO_DEV_MANIFEST, DEV, ["install"], transport=svc.transport) is False
    assert "FAIL install: bad signature" in capsys.readouterr().out


def test_strict_policy_refuses_localhost(example_server, capsys):
    assert run_simulation(example_manifest(example_server.url), STRICT, ["install"]) is False
    assert "FAIL install: blocked" in capsys.readouterr().out


def test_service_that_skips_replay_check_fails(lenient_server, capsys):
    assert run_simulation(lenient_server.manifest, DEV, ["install", "poll", "replay"]) is False
    assert "FAIL replay" in capsys.readouterr().out


WIDGET_MANIFEST = Manifest.model_validate(
    {
        **DEMO,
        "base_url": DEMO_DEV_MANIFEST.base_url,
        "poll_seconds": 60,
        "permissions": ["chores.complete", "widgets.parent"],
        "widgets": [{"id": "w1", "surface": "parent", "title": "Card"}],
    },
    context={"dev": True},
)


@pytest.mark.parametrize(
    "svc, steps, expected",
    [
        (FakeService("s", request_id_override="stale"), ["install"], "FAIL install: request_id"),
        (FakeService("s", actions=[cc("k", 1, 99)]), ["poll"], "FAIL poll: action 0: chore not"),
        (FakeService("s", actions=[{"type": "unlock"}]), ["poll"], "FAIL poll: action 0: unknown"),
        (FakeService("s", widgets=[W("w1", {"type": "x"})]), ["widgets"], "FAIL widgets parent"),
        (FakeService("s", widgets=[W("nope", card())]), ["widgets"], "not declared"),
        (FakeService("s"), ["replay"], "FAIL replay"),
        (FakeService("s"), ["skew"], "FAIL skew"),
        (FakeService("s"), ["forged"], "FAIL forged"),
    ],
)
def test_broken_service_is_reported(svc, steps, expected, capsys):
    assert run_simulation(WIDGET_MANIFEST, DEV, steps, transport=svc.transport) is False
    assert expected in capsys.readouterr().out


class _PastOnlySkew(FakeService):
    """Refuses old timestamps but accepts ones from the future: half a skew check."""

    def _handle(self, req):
        import time

        import httpx

        if int(req.headers["x-tsk-timestamp"]) < time.time() - 300:
            return httpx.Response(401)
        return super()._handle(req)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        import httpx

        self.transport = httpx.MockTransport(self._handle)


def test_skew_checks_future_timestamps_too(capsys):
    svc = _PastOnlySkew("s")
    assert run_simulation(WIDGET_MANIFEST, DEV, ["skew"], transport=svc.transport) is False
    assert "FAIL skew future" in capsys.readouterr().out


def test_one_sample_event_per_events_permission(capsys):
    perms = ["events.chore_completed", "events.reward_redeemed"]
    m = WIDGET_MANIFEST.model_copy(update={"permissions": perms, "widgets": []})
    svc = FakeService("s")
    assert run_simulation(m, DEV, ["events"], transport=svc.transport) is True
    out = capsys.readouterr().out
    assert "PASS events chore.completed" in out and "PASS events reward.redeemed" in out
    assert svc.last_body["events"][0]["kind"] == "reward.redeemed"


def test_press_reply_must_match_button_action(capsys):
    svc = FakeService("s", widgets=[W("w1", card(button("go", "chore.complete")))])
    svc.press_reply = [{"type": "message.parents", "idempotency_key": "k", "title": "hi"}]
    assert run_simulation(WIDGET_MANIFEST, DEV, ["press"], transport=svc.transport) is False
    assert "not this button's action" in capsys.readouterr().out


def test_simulator_uses_box_client():
    assert simulator.BoxClient is client.BoxClient


def test_dev_manifest_rejected_by_box():
    with pytest.raises(ValidationError):
        Manifest.model_validate(json.loads((EXAMPLE / "manifest.json").read_text()))


def test_example_never_in_production_catalog():
    catalog = (REPO / "registry/src/catalog.ts").read_text()
    assert "hello-example" not in catalog and "integration-hello" not in catalog


def _dev_leaks(name: str, source: str) -> list[str]:
    """Import-graph and constructor checks for one module: who imports the simulator, imports
    net.DEV, or builds its own OutboundPolicy. Only net.py and simulator.py may do the last two."""
    out = []
    own = name in ("net.py", "simulator.py")
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            out += [a.name for a in node.names if a.name == "app.integrations.simulator"]
        elif isinstance(node, ast.ImportFrom):
            names = {a.name for a in node.names}
            if node.module == "app.integrations.simulator" or (
                node.module == "app.integrations" and "simulator" in names
            ):
                out.append("imports simulator")
            if node.module == "app.integrations.net" and names & {"DEV", "*"} and not own:
                out.append("imports DEV")
        elif isinstance(node, ast.Call) and not own:
            f = node.func
            if (isinstance(f, ast.Name) and f.id == "OutboundPolicy") or (
                isinstance(f, ast.Attribute) and f.attr in ("OutboundPolicy", "DEV")
            ):
                out.append("builds OutboundPolicy")
        elif isinstance(node, ast.Attribute) and node.attr == "DEV" and not own:
            out.append("uses net.DEV")
    return out


def test_dev_guard_catches_leaks():
    assert _dev_leaks("x.py", "from app.integrations import simulator") == ["imports simulator"]
    assert _dev_leaks("x.py", "import app.integrations.simulator")
    assert _dev_leaks("x.py", "from app.integrations.net import DEV") == ["imports DEV"]
    assert _dev_leaks("x.py", "from app.integrations import net\nnet.DEV") == ["uses net.DEV"]
    assert _dev_leaks("x.py", "OutboundPolicy(False, False, True)") == ["builds OutboundPolicy"]
    assert _dev_leaks("x.py", "net.OutboundPolicy(allow_private=True)")
    assert _dev_leaks("net.py", "OutboundPolicy(False, False, True)") == []


def test_dev_policy_used_only_by_simulator():
    """No backend module imports the simulator, reaches net.DEV, or builds a permissive policy."""
    app = REPO / "backend/app"
    leaks = {
        str(p.relative_to(app)): bad
        for p in app.rglob("*.py")
        if p.name != "simulator.py" and (bad := _dev_leaks(p.name, p.read_text()))
    }
    assert leaks == {}


def test_cli_without_dev_needs_signed_manifest(capsys):
    assert main(["--manifest", str(EXAMPLE / "manifest.json")]) == 1
    assert "signed" in capsys.readouterr().out


def test_cli_dev_runs_against_example(example_server, tmp_path, capsys):
    raw = json.loads((EXAMPLE / "manifest.json").read_text())
    path = tmp_path / "m.json"
    path.write_text(json.dumps({**raw, "base_url": example_server.url}))
    assert main(["--manifest", str(path), "--dev", "--steps", "poll,widgets"]) == 0
    out = capsys.readouterr().out
    assert "PASS install" in out and "PASS widgets parent" in out and "uninstall" not in out


def test_doc_and_readme_show_the_commands():
    doc = (REPO / "docs/integrations/protocol-v1.md").read_text()
    readme = (EXAMPLE / "README.md").read_text()
    sim = "python -m app.integrations.simulator --manifest ../examples/integration-hello/manifest.json --dev"
    for text in (doc, readme):
        assert sim in text and "python examples/integration-hello/server.py --port 8787" in text
    for step in ALL_STEPS:
        assert f"| `{step}` |" in doc, step
