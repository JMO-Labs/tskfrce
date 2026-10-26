import uuid

import pytest
from app.core.config import settings
from app.eval import store
from app.eval.config import eval_settings


@pytest.fixture
def eval_on(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    for k, v in {
        "EVAL_UMAMI_URL": "http://umami.test",
        "EVAL_UMAMI_WEBSITE_ID": str(uuid.uuid4()),
        "EVAL_SUPABASE_URL": "http://supa.test",
        "EVAL_SUPABASE_ANON_KEY": "anon-key",
    }.items():
        monkeypatch.setattr(eval_settings, k, v)
    store._reset()
    yield tmp_path
    store._reset()
