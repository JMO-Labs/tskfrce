"""Box simulator: run the box side of the v1 protocol against a developer's service.

cd backend && python -m app.integrations.simulator --manifest path/to/manifest.json --dev

It drives the real BoxClient (signing, reply checks), then the box's own rules: action parsing,
the per-action grant check and the widget sanitizer. Those models are what the JSON schemas in
docs/integrations/schemas are generated from, so a reply that passes here matches the schemas.
--dev (http, localhost, any port) lives only here; the box itself always uses STRICT.
"""

import argparse
import dataclasses
import json
import logging
import secrets
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from app.integrations import widgets as widgets_mod
from app.integrations.client import BoxClient, InstallCtx, ProtocolError
from app.integrations.manifest import Manifest, load_dev_manifest, load_manifest
from app.integrations.net import DEV, STRICT, OutboundPolicy
from app.integrations.permissions import Denied, Grant, check_action
from app.integrations.protocol import grant_out, parse_action

ALL_STEPS = "install poll events widgets press replay skew forged uninstall".split()
KIDS, CHORES = [(1, "Sam")], [(1, "Practice")]
SKEW = 300

SAMPLE_EVENTS = {  # one per events.* permission, as the box sends them (already trimmed)
    "events.chore_completed": {
        "kind": "chore.completed",
        "chore_id": 1,
        "title": "Practice",
        "points": 5,
    },
    "events.request_created": {
        "kind": "request.created",
        "type": "reward",
        "id": 1,
        "title": "Ice cream",
        "cost": 20,
    },
    "events.reward_redeemed": {"kind": "reward.redeemed", "reward_name": "Ice cream", "cost": 20},
}

HINTS = {
    "bad signature": "sign f'{request_id}.' + the exact reply bytes with the install secret",
    "request_id mismatch": "echo the request's request_id in the reply",
    "schema": "the reply does not match reply.schema.json (request_id, actions <= 20, widgets)",
    "not json": "reply with a JSON object",
    "blocked": "the box only calls public https on port 443; add --dev for a local service",
    "bad widgets": "every widget was dropped, or more than 6 were sent",
}


def _why(e: ProtocolError) -> str:
    msg = str(e)
    return f"{msg} ({HINTS[msg]})" if msg in HINTS else msg


@contextmanager
def _dropped_widgets():
    """Collect the reasons the box's sanitizer logs for each widget it drops."""
    reasons: list[str] = []
    handler = logging.Handler(logging.WARNING)
    handler.emit = lambda r: reasons.append(r.getMessage().split(": ", 1)[-1])
    widgets_mod.log.addHandler(handler)
    try:
        yield reasons
    finally:
        widgets_mod.log.removeHandler(handler)


def _sample(field):
    """A value the box would accept for this settings field."""
    if field.type == "number":
        return 1
    return field.options[0] if field.type == "select" else "sample"


def _buttons(block: dict):
    if block.get("type") == "button":
        yield block
    for child in block.get("children", ()):
        yield from _buttons(child)


class _Run:
    def __init__(self, manifest: Manifest, policy: OutboundPolicy, transport, out):
        self.m, self.out, self.ok = manifest, out, True
        perms = list(manifest.permissions)
        one = frozenset({1})  # kid 1 and chore 1, linked, with kid widgets on
        self.grant = Grant(0, manifest.name, frozenset(perms), one, one, one, True, True)
        ctx = InstallCtx(
            uuid.uuid4().hex,
            manifest.base_url,
            secrets.token_urlsafe(32),
            grant_out(perms, KIDS, CHORES),
        )
        self.client = BoxClient(ctx, policy, transport)
        self.found: list[tuple[str, str, dict]] = []  # (surface, widget id, button)

    def report(self, step: str, err: str | None = None, note: str = "") -> None:
        if err:
            self.ok = False
            self.out(f"FAIL {step}: {err}")
        else:
            self.out(f"PASS {step}" + (f": {note}" if note else ""))

    def check_actions(self, step: str, actions: list, origin="service", button=None) -> None:
        """Each action as the box applies it: parse, then the grant check."""
        bad = False
        for i, raw in enumerate(actions):
            try:
                if button and (not isinstance(raw, dict) or raw.get("type") != button["action"]):
                    raise Denied("not this button's action")
                kid = 1 if origin == "kid_button" else None
                check_action(self.grant, parse_action(raw), origin, kid)
            except (ValueError, Denied) as e:
                bad = True
                self.report(step, f"action {i}: {getattr(e, 'reason', e)}")
        if not bad:
            self.report(step, note=f"{len(actions)} action(s)")

    def install(self) -> None:
        self.client.install({f.key: _sample(f) for f in self.m.settings})
        self.report("install")

    def poll(self) -> None:
        if self.m.poll_seconds is None:
            return self.out("SKIP poll: the manifest sets no poll_seconds")
        self.check_actions("poll", self.client.poll().actions)

    def events(self) -> None:
        subscribed = [p for p in self.m.permissions if p in SAMPLE_EVENTS]
        if not subscribed:
            return self.out("SKIP events: no events.* permission")
        at = time.strftime("%Y-%m-%dT%H:%M:%S.000000", time.gmtime())
        for p in subscribed:
            ev = {"at": at, "kid_id": 1, **SAMPLE_EVENTS[p]}
            if "kid.name" in self.m.permissions:
                ev["first_name"] = KIDS[0][1]
            self.check_actions(f"events {ev['kind']}", self.client.events([ev]).actions)

    def widgets(self) -> None:
        if not self.m.widgets:
            return self.out("SKIP widgets: the manifest declares none")
        for surface in sorted({w.surface for w in self.m.widgets}):
            step = f"widgets {surface}"
            reply = self.client.widgets(surface, 1 if surface == "kid" else None)
            with _dropped_widgets() as dropped:
                try:
                    clean, _ = widgets_mod.sanitize(
                        reply.widgets, self.m.widgets, surface, self.grant
                    )
                except ProtocolError as e:
                    clean = []
                    dropped.append(_why(e))
            for reason in dropped:
                self.report(step, reason)
            if not dropped:
                self.report(step, note=f"{len(clean)} widget(s)")
            self.found += [(surface, w["id"], b) for w in clean for b in _buttons(w["root"])]

    def press(self) -> None:
        if not self.found:
            return self.out("SKIP press: no button to press")
        surface, wid, b = self.found[0]
        ev = {
            "kind": "widget.pressed",
            "widget_id": wid,
            "button_id": b["id"],
            "by": surface,
            "kid_id": 1,
        }
        reply = self.client.events([ev])
        self.check_actions(f"press {b['id']}", reply.actions, f"{surface}_button", b)

    def refused(self, step: str, client: BoxClient, call, rule: str) -> None:
        """PASS only if the service answered 4xx: it must refuse without doing any work."""
        try:
            call(client)
        except ProtocolError as e:
            if str(e).startswith("status 4"):
                return self.report(step, note=f"refused with {e}")
            return self.report(step, f"{_why(e)}; {rule}")
        self.report(step, f"the service accepted it; {rule}")

    def replay(self) -> None:
        self.refused(
            "replay",
            self.client,
            lambda c: c.raw_post(*c.last_request),
            "reject a reused X-Tsk-Request-Id with 401",
        )

    def skew(self) -> None:
        old = BoxClient(
            self.client.ctx,
            self.client.policy,
            self.client.transport,
            now=lambda: time.time() - SKEW - 60,
        )
        self.refused(
            "skew",
            old,
            BoxClient.poll,
            f"reject an X-Tsk-Timestamp over {SKEW} s from your clock with 401",
        )

    def forged(self) -> None:
        ctx = dataclasses.replace(self.client.ctx, secret=secrets.token_urlsafe(32))
        forger = BoxClient(ctx, self.client.policy, self.client.transport)
        self.refused(
            "forged",
            forger,
            BoxClient.poll,
            "reject a bad X-Tsk-Signature with 401 (compare in constant time)",
        )

    def uninstall(self) -> None:
        self.client.uninstall()
        self.report("uninstall")


def run_simulation(
    manifest: Manifest, policy: OutboundPolicy, steps: list[str], transport=None, out=print
) -> bool:
    """Run steps in ALL_STEPS order (install always runs first, and press needs widgets) as the
    box would, with a fake grant. Prints PASS/FAIL/SKIP lines; True iff nothing failed."""
    unknown = set(steps) - set(ALL_STEPS)
    if unknown:
        out(f"FAIL steps: unknown {sorted(unknown)}; choose from {','.join(ALL_STEPS)}")
        return False
    wanted = {"install", *steps, *(["widgets"] if "press" in steps else [])}
    run = _Run(manifest, policy, transport, out)
    for step in [s for s in ALL_STEPS if s in wanted]:
        try:
            getattr(run, step)()
        except ProtocolError as e:
            run.report(step, _why(e))
            if step == "install":  # without an install the service cannot verify anything
                return False
    return run.ok


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.integrations.simulator", description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--dev", action="store_true", help="allow http, localhost and any port")
    p.add_argument("--steps", default=",".join(ALL_STEPS), help="comma list, default all")
    a = p.parse_args(argv)
    try:
        if a.dev:
            manifest = load_dev_manifest(a.manifest)
        else:
            manifest = load_manifest(json.loads(a.manifest.read_text()))
    except Exception as e:  # noqa: BLE001 - any bad manifest is one actionable message
        need = "a valid manifest" if a.dev else "a signed registry envelope (or use --dev)"
        print(f"FAIL manifest: {a.manifest} is not {need}: {e}")
        return 1
    ok = run_simulation(manifest, DEV if a.dev else STRICT, a.steps.split(","))
    print("All checks passed." if ok else "Some checks failed.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
