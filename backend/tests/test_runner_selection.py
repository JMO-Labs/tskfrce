"""Same-repo PRs run on homelab runners; fork PRs stay GitHub-hosted (tskfrce#54)."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
EXPR = "${{ github.event.pull_request.head.repo.fork && 'ubuntu-latest' || 'homelab' }}"
# Proposed files live in wq-workflows/ until the owner promotes them to .github/workflows/.
FILES = ["wq-ci.yml", "dependabot-automerge.yml"]


@pytest.mark.parametrize("name", FILES)
def test_runs_on_is_fork_safe(name):
    wf = yaml.safe_load((ROOT / "wq-workflows" / name).read_text())
    runners = [j["runs-on"] for j in wf["jobs"].values() if "runs-on" in j]
    assert runners and all(r == EXPR for r in runners)
