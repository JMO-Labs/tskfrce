import json
import re
from pathlib import Path

import pytest
from app.integrations.events import EVENT_PERM, FIELDS
from app.integrations.permissions import ACTION_PERM, PERMS
from app.integrations.protocol import ACTION_MODELS, KEY_PATTERN, sign_reply, sign_request
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
    fields = {f for fs in FIELDS.values() for f in fs} - {"id", "type"}  # too common to prove much
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


def test_action_type_is_required_in_schema():
    defs = export_schemas()["actions"]["$defs"]
    assert set(defs) == {m.__name__ for m in ACTION_MODELS}
    for name, d in defs.items():
        assert "type" in d["required"], name


def test_home_assistant_key_template_renders_a_valid_key():
    doc = DOC.read_text()
    tpl = re.search(r'"idempotency_key":"([^"]+)"', doc).group(1)
    assert "urlencode" not in tpl
    slug = re.sub(r"[^a-z0-9]+", "_", "Front door opened".lower())  # what HA's slugify gives
    key = tpl.replace("{{ now().timestamp() | int }}", "1700000000").replace(
        "{{ title | slugify }}", slug
    )
    assert re.fullmatch(KEY_PATTERN, key), key
