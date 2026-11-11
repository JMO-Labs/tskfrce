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


def test_lab_gated_to_queue_tags_and_dispatch(wf):
    # #98: the heavy network lab gates merges in the merge queue, release tags and manual runs only
    cond = " ".join(str(wf["jobs"]["lab"].get("if", "")).split())
    assert "github.event_name == 'merge_group'" in cond
    assert "github.event_name == 'workflow_dispatch'" in cond
    assert "startsWith(github.ref, 'refs/tags/v')" in cond
    assert "merge_group" in wf[True]  # `on:` parses as True in YAML 1.1


@pytest.mark.parametrize("job", CHEAP_JOBS)
def test_cheap_jobs_not_gated(wf, job):
    # Never gated on event/ref; the only allowed `if` is the `changes` path filter (docs-only PRs skip them).
    cond = str(wf["jobs"][job].get("if", ""))
    assert "github." not in cond
    assert not cond or "needs.changes.outputs." in cond


def test_only_image_build_needs_lab_and_survives_a_skip(wf):
    # build-and-push waits for the lab, but a skipped lab (main push after the queue) must not skip it
    for name, job in wf["jobs"].items():
        needs = job.get("needs", [])
        needs = [needs] if isinstance(needs, str) else needs
        if "lab" in needs:
            assert name == "build-and-push"
            assert "!failure()" in str(job["if"]) and "!cancelled()" in str(job["if"])


def test_concurrency_unchanged(wf):
    assert wf["concurrency"]["group"] == "ci-${{ github.event.pull_request.number || github.ref }}"
    assert wf["concurrency"]["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"
    assert wf["jobs"]["lab"]["concurrency"]["group"] == "lab-${{ github.repository }}"


def test_build_and_push_still_main_or_tag_push_only(wf):
    assert "github.event_name == 'push'" in wf["jobs"]["build-and-push"]["if"]
