"""JSON Schemas for the v1 integration protocol, generated from the real models (DB-free).

python -m app.integrations.schemas <out_dir>
"""

import json
import sys
from pathlib import Path

from pydantic import TypeAdapter

from app.integrations.manifest import Manifest
from app.integrations.protocol import Action, PushIn, Reply
from app.integrations.widgets import Widget


def export_schemas() -> dict[str, dict]:
    return {
        "manifest": Manifest.model_json_schema(),
        "reply": Reply.model_json_schema(),
        "actions": TypeAdapter(Action).json_schema(),
        "widgets": TypeAdapter(list[Widget]).json_schema(),
        "local-push": PushIn.model_json_schema(),
    }


def write_schemas(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, schema in export_schemas().items():
        text = json.dumps(schema, indent=2, sort_keys=True) + "\n"
        (out / f"{name}.schema.json").write_text(text)


if __name__ == "__main__":
    write_schemas(Path(sys.argv[1]))
