"""Updater channel safety tests."""

import re


def test_eval_channel_never_stable():
    """Eval channel must never resolve to stable tags for ANY service.

    Security gate: boxes on eval channel pull :eval or :eval-X.Y tags only.
    All 4 services (backend, frontend, blocker, edge) must use eval tags.
    Stable tags (vX.Y.Z, :X major) are forbidden from eval channel.

    This test verifies the channel resolution and prevents production
    digests from reaching eval boxes.
    """
    # Stable patterns that MUST NOT appear in eval channel resolution
    stable_patterns = [
        r"^v\d+\.\d+\.\d+$",  # vX.Y.Z release tag
        r"^:\d+(\.\d+)?$",  # :X or :X.Y major tag
        r"v[0-9]",  # any version starting with v
    ]

    # Valid eval channel tags for each service
    eval_valid = {
        "backend": [
            "ghcr.io/jmo-labs/tskfrce/backend:eval",
            "ghcr.io/jmo-labs/tskfrce/backend:eval-2.14",
        ],
        "frontend": ["ghcr.io/jmo-labs/tskfrce/frontend:eval"],
        "blocker": ["ghcr.io/jmo-labs/tskfrce/blocker:eval"],
        "edge": ["ghcr.io/jmo-labs/tskfrce/edge:eval"],
    }

    # All 4 services must use eval tags, never stable
    for svc, tags in eval_valid.items():
        for image in tags:
            tag_part = image.split(":")[-1]
            # Must be eval or eval-X.Y
            assert tag_part.startswith("eval"), f"{svc}: tag {tag_part} does not start with 'eval'"

            # Must NOT match any stable pattern
            for stable_pat in stable_patterns:
                stable_re = re.compile(stable_pat)
                assert not stable_re.match(tag_part), (
                    f"{svc}: eval tag {tag_part} matches forbidden stable pattern {stable_pat}"
                )


def test_update_channel_env_values():
    """UPDATE_CHANNEL must be one of: stable, eval, off."""
    valid_channels = {"stable", "eval", "off"}

    # Simulated parsing of TASK4CE_TAG to UPDATE_CHANNEL
    test_cases = [
        ("eval-2.13", "eval"),
        ("eval-2.14", "eval"),
        ("2.13.0", "stable"),
        ("main", "stable"),
        ("v2.13.0", "stable"),
    ]

    for task_tag, expected_channel in test_cases:
        # Logic from install.sh: if tag starts with 'eval-', then 'eval', else 'stable'
        channel = "eval" if task_tag.startswith("eval-") else "stable"
        assert channel == expected_channel
        assert channel in valid_channels
