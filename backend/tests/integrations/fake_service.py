"""FakeService: an httpx.MockTransport that verifies request signatures and replies signed."""

import json

import httpx
from app.integrations.protocol import sign_reply, sign_request, verify
from tests.integrations.int_helpers import streamed


class FakeService:
    def __init__(self, secret, actions=(), request_id_override=None, widgets=()):
        self.secret, self.actions, self.widgets = secret, list(actions), list(widgets)
        self.request_id_override = request_id_override
        self.last_path = self.last_body = None
        self.last_signature_ok = False
        self.failing = False
        self.press_reply: list[dict] = []  # actions answered to a widget.pressed event
        self.calls = 0
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, req):
        self.calls += 1
        h, body = req.headers, req.content
        rid = h["x-tsk-request-id"]
        self.last_path, self.last_body = req.url.path, json.loads(body)
        if self.failing:
            return httpx.Response(500, stream=streamed(b"{}"))
        if self.last_path == "/v1/install" and "secret" in self.last_body:
            self.secret = self.last_body["secret"]  # a real service learns it from install
        want = sign_request(self.secret, int(h["x-tsk-timestamp"]), rid, body)
        self.last_signature_ok = verify(h["x-tsk-signature"], want)
        events = self.last_body.get("events") or [{}]
        pressed = events[0].get("kind") == "widget.pressed"
        out = json.dumps(
            {
                "request_id": self.request_id_override or rid,
                "actions": self.press_reply if pressed else self.actions,
                "widgets": self.widgets,
            }
        ).encode()
        sig = sign_reply(self.secret, rid, out)
        return httpx.Response(200, headers={"X-Tsk-Signature": sig}, stream=streamed(out))

    def fail(self) -> None:
        """Every later call answers 500."""
        self.failing = True
