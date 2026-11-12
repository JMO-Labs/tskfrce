"""Nightly lab + Node 22 rules (#73) in the promoted .github/workflows/ci-cd.yml."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci-cd.yml"


@pytest.fixture(scope="module")
def wf():
    return yaml.safe_load(WORKFLOW.read_text())


def test_lab_runs_on_schedule_against_dev(wf):
    lab = wf["jobs"]["lab"]
    assert "github.event_name == 'schedule'" in lab["if"]
    assert "'dev'" in lab["steps"][0]["with"]["ref"]


def test_nightly_lab_failure_opens_issue(wf):
    # gh is not on the homelab ARC image: alert from a GitHub-hosted job instead
    alert = wf["jobs"]["lab-nightly-alert"]
    assert alert["needs"] in ("lab", ["lab"])
    assert alert["runs-on"] == "ubuntu-latest"
    assert "failure()" in alert["if"] and "schedule" in alert["if"]
    assert alert["permissions"] == {"issues": "write"}
    assert any(
        "gh issue" in s.get("run", "") and "GH_REPO" in s.get("env", {}) for s in alert["steps"]
    )
    lab = wf["jobs"]["lab"]
    assert lab["permissions"] == {"contents": "read"}
    assert not any("gh issue" in s.get("run", "") for s in lab["steps"])


def test_artifacts_still_uploaded(wf):
    steps = wf["jobs"]["lab"]["steps"]
    assert any(s.get("with", {}).get("name") == "e2e-artifacts" for s in steps)


def test_all_setup_node_use_22(wf):
    versions = [
        str(s["with"]["node-version"])
        for j in wf["jobs"].values()
        for s in j.get("steps", [])
        if "setup-node" in s.get("uses", "")
    ]
    assert versions and set(versions) == {"22"}
