from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml", reason="PyYAML not installed; cannot parse docker-compose.yml")

COMPOSE = Path(__file__).resolve().parents[2] / "docker-compose.yml"
PROD = COMPOSE.with_name("docker-compose.prod.yml")


def _blocker():
    return yaml.safe_load(COMPOSE.read_text())["services"]["blocker"]


def test_blocker_service_has_host_net_and_minimal_caps():
    svc = _blocker()
    assert svc["network_mode"] == "host"
    assert sorted(svc["cap_add"]) == ["NET_ADMIN", "NET_RAW"]
    assert not svc.get("privileged", False)


def test_blocker_has_no_data_volume_and_gets_token_from_env():
    svc = _blocker()
    assert not any("task4ce_data" in str(v) for v in svc.get("volumes", []))
    assert "INTERNAL_TOKEN" in svc["environment"]


def test_prod_compose_has_ntfy():
    svcs = yaml.safe_load(PROD.read_text())["services"]
    ntfy = svcs["ntfy"]
    assert any(str(p).endswith(":80") for p in ntfy["ports"])
    assert "task4ce" in ntfy["networks"]
    env = svcs["backend"]["environment"]
    assert "NTFY_URL" in env and "NTFY_CONF_FILE" in env
    assert "ntfy_conf:/etc/ntfy:ro" in ntfy["volumes"]
    assert "NTFY_UPSTREAM_BASE_URL" not in ntfy["environment"]


def test_backend_image_owns_ntfy_conf_volume():
    # Docker copies image dir ownership into a fresh named volume; without this appuser can't write.
    df = (COMPOSE.parent / "backend" / "Dockerfile").read_text()
    assert "chown appuser:appuser /app/data /ntfy-conf" in df


def test_ntfy_base_url_matches_backend_public_url():
    svcs = yaml.safe_load(PROD.read_text())["services"]
    assert (
        svcs["ntfy"]["environment"]["NTFY_BASE_URL"]
        == svcs["backend"]["environment"]["NTFY_PUBLIC_URL"]
    )
    assert "${NTFY_PUBLIC_URL" in svcs["ntfy"]["environment"]["NTFY_BASE_URL"]


def test_ntfy_starts_after_backend():
    assert "backend" in yaml.safe_load(PROD.read_text())["services"]["ntfy"]["depends_on"]


def test_prod_edge_is_opt_in_host_net():
    edge = yaml.safe_load(PROD.read_text())["services"]["edge"]
    assert edge["profiles"] == ["edge"]
    assert edge["network_mode"] == "host"
    assert "edge_data:/data" in edge["volumes"]
    assert "cap_add" not in edge
    assert not edge.get("privileged", False)
    # `:?` would break every box without BOX_ID, even with the profile off
    for v in edge["environment"].values():
        assert ":?" not in str(v)


def test_prod_frontend_and_edge_receive_edge_token_only():
    svcs = yaml.safe_load(PROD.read_text())["services"]
    for name in ("frontend", "edge"):
        env = svcs[name]["environment"]
        assert "EDGE_TOKEN" in env
        assert "INTERNAL_TOKEN" not in env


def test_prod_backend_passes_claim_code():
    env = yaml.safe_load(PROD.read_text())["services"]["backend"]["environment"]
    assert "CLAIM_CODE" in env and "NTFY_UPSTREAM_TOKEN" in env
    assert env["NTFY_UPSTREAM_URL"] == "${NTFY_UPSTREAM_URL-https://ntfy.sh}"


def test_no_service_has_ntfy_upstream():
    for name, svc in yaml.safe_load(PROD.read_text())["services"].items():
        assert "NTFY_UPSTREAM" not in (svc.get("environment") or {}), name
