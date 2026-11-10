"""Guards the CI trigger and gating rules in .github/workflows/ci-cd.yml."""

from pathlib import Path

import pytest
import yaml

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci-cd.yml"
CHEAP_JOBS = ["lint", "test", "frontend-test", "standalone", "installer", "security-scan"]


@pytest.fixture(scope="module")
def wf():
    return yaml.safe_load(WORKFLOW.read_text())


@pytest.fixture(scope="module")
def on(wf):
    return wf.get("on", wf.get(True))  # PyYAML reads `on:` as True


def test_pr_triggers_cover_main_dev_feat(on):
    assert set(on["pull_request"]["branches"]) == {"main", "dev", "feat/**"}


def test_push_triggers_main_dev_no_develop(on):
    assert on["push"]["branches"] == ["main", "dev"]
    assert "develop" not in on["push"]["branches"]
    assert on["push"]["tags"] == ["v*"]


def test_lab_gated_to_main_and_tags(wf):
    cond = " ".join(str(wf["jobs"]["lab"].get("if", "")).split())
    assert "github.base_ref == 'main'" in cond
    assert "github.ref == 'refs/heads/main'" in cond
    assert "startsWith(github.ref, 'refs/tags/')" in cond


@pytest.mark.parametrize("job", CHEAP_JOBS)
def test_cheap_jobs_not_gated(wf, job):
    assert "if" not in wf["jobs"][job]


def test_nothing_needs_lab(wf):
    for name, job in wf["jobs"].items():
        needs = job.get("needs", [])
        needs = [needs] if isinstance(needs, str) else needs
        assert "lab" not in needs, name


def test_concurrency_unchanged(wf):
    assert wf["concurrency"]["group"] == "ci-${{ github.event.pull_request.number || github.ref }}"
    assert wf["concurrency"]["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"
    assert wf["jobs"]["lab"]["concurrency"]["group"] == "lab-${{ github.repository }}"


def test_build_and_push_still_main_or_tag_push_only(wf):
    assert "github.event_name == 'push'" in wf["jobs"]["build-and-push"]["if"]
