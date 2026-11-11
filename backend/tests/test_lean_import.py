"""Small boxes: heavy optional libraries load on first use, not at app start."""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def test_app_start_skips_heavy_optional_libraries(tmp_path):
    code = (
        "import sys, app.main; print(' '.join(m for m in ('apprise', 'segno') if m in sys.modules))"
    )
    out = (
        subprocess.run(
            [sys.executable, "-c", code],
            cwd=BACKEND,
            env={**os.environ, "DATA_DIR": str(tmp_path)},
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .splitlines()
    )
    assert out[-1:] in ([], [""])
