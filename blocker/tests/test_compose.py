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


def test_prod_backend_blocker_url_uses_bridge_not_loopback():
    """Backend BLOCKER_URL must use the bridge gateway, never loopback or 0.0.0.0."""
    env = yaml.safe_load(PROD.read_text())["services"]["backend"]["environment"]
    assert "BLOCKER_URL" in env
    blocker_url = env["BLOCKER_URL"]
    # Should derive the bridge gateway from TASK4CE_BRIDGE_GW or default to 172.29.50.1
    assert "127.0.0.1" not in blocker_url and "0.0.0.0" not in blocker_url
    assert "TASK4CE_BRIDGE_GW" in blocker_url or "172.29.50.1" in blocker_url


def test_prod_blocker_bind_includes_loopback_and_bridge():
    """Blocker BLOCKER_BIND must listen on both loopback and the bridge gateway."""
    env = yaml.safe_load(PROD.read_text())["services"]["blocker"]["environment"]
    assert "BLOCKER_BIND" in env
    blocker_bind = env["BLOCKER_BIND"]
    # Should include both 127.0.0.1 and the bridge gateway (via TASK4CE_BRIDGE_GW)
    assert "127.0.0.1" in blocker_bind
    assert "TASK4CE_BRIDGE_GW" in blocker_bind or "172.29.50.1" in blocker_bind


def test_prod_blocker_url_and_bind_match():
    """The backend BLOCKER_URL host must be in the blocker's BLOCKER_BIND list."""
    svcs = yaml.safe_load(PROD.read_text())["services"]
    blocker_url = svcs["backend"]["environment"]["BLOCKER_URL"]
    blocker_bind = svcs["blocker"]["environment"]["BLOCKER_BIND"]
    # Both should use the same variable or value for the bridge IP
    # blocker_bind should contain all hosts that blocker_url might use
    assert "127.0.0.1" in blocker_bind  # Always have loopback
    # Bridge IP should be in both (same var or same value)
    assert ("TASK4CE_BRIDGE_GW" in blocker_url and "TASK4CE_BRIDGE_GW" in blocker_bind) or (
        "172.29.50.1" in blocker_url and "172.29.50.1" in blocker_bind
    )
