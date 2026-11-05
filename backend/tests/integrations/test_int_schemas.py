import json
from pathlib import Path

import pytest
from app.integrations.events import EVENT_PERM, FIELDS
from app.integrations.permissions import ACTION_PERM, PERMS
from app.integrations.protocol import sign_reply, sign_request
from app.integrations.schemas import export_schemas

REPO = Path(__file__).resolve().parents[3]
DOC = REPO / "docs/integrations/protocol-v1.md"


@pytest.mark.parametrize("name", ["manifest", "reply", "actions", "widgets", "local-push"])
def test_committed_schema_matches_code(name):
    path = REPO / "docs/integrations/schemas" / f"{name}.schema.json"
    assert json.loads(path.read_text()) == export_schemas()[name], (
        "run: cd backend && python -m app.integrations.schemas ../docs/integrations/schemas"
    )


def test_protocol_doc_mentions_whole_vocabulary():
    doc = DOC.read_text()
    fields = {f for fs in FIELDS.values() for f in fs}
    words = [*PERMS, *ACTION_PERM, *EVENT_PERM, *fields]
    for word in [*words, "widget.pressed", "X-Tsk-Signature", "X-Tsk-Request-Id"]:
        assert word in doc, word
    for perm in PERMS.values():
        assert perm.text in doc, perm.text


def test_signing_examples_in_doc_are_correct():
    doc = DOC.read_text()
    rid = "0" * 32
    assert sign_request("example-secret", 1700000000, rid, b'{"protocol":"v1"}') in doc
    reply = b'{"request_id":"%s","actions":[]}' % rid.encode()
    assert sign_reply("example-secret", rid, reply) in doc
    assert reply.decode() in doc


def test_doc_stays_under_500_lines():
    assert len(DOC.read_text().splitlines()) < 500
