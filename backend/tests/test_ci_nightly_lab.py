"""Nightly lab + Node 22 rules (#73). Checks the staged wq-workflows/ci-cd.yml until the owner promotes it."""

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
STAGED = ROOT / "wq-workflows" / "ci-cd.yml"
pytestmark = pytest.mark.skipif(not STAGED.exists(), reason="promoted to .github/workflows")


@pytest.fixture(scope="module")
def wf():
    return yaml.safe_load(STAGED.read_text())


def test_lab_runs_on_schedule_against_dev(wf):
    lab = wf["jobs"]["lab"]
    assert "github.event_name == 'schedule'" in lab["if"]
    assert "'dev'" in lab["steps"][0]["with"]["ref"]


def test_nightly_lab_failure_opens_issue(wf):
    steps = wf["jobs"]["lab"]["steps"]
    assert any("schedule" in str(s.get("if", "")) and "failure()" in s["if"] for s in steps)
    assert wf["jobs"]["lab"]["permissions"]["issues"] == "write"


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
