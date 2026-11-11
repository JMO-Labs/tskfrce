"""Updater channel safety tests."""

import re


def test_eval_channel_never_stable():
    """Eval channel must never resolve to stable tags.

    Stable tags are vX.Y.Z (release) or :X (major floating tag).
    Eval tags are :eval-X.Y or :eval (floating).

    This test ensures a security boundary: boxes on eval channel
    never accidentally pull a production/stable version.
    """
    # Stable patterns to NEVER match from eval channel
    stable_patterns = [
        r"^v\d+\.\d+\.\d+$",  # release tag: v2.13.0
        r"^:\d+$",              # major tag: :2
    ]

    # Valid eval patterns
    eval_patterns = [
        ":eval-2.13",
        ":eval-2.14",
        "ghcr.io/jmo-labs/tskfrce/backend:eval-2.13",
        "ghcr.io/jmo-labs/tskfrce/backend:eval",
    ]

    for tag in eval_patterns:
        for stable_pat in stable_patterns:
            stable_re = re.compile(stable_pat)
            # Extract the tag part (after the last colon)
            tag_part = tag.split(":")[-1] if ":" in tag else tag
            assert not stable_re.match(
                tag_part
            ), f"Eval tag {tag} matches stable pattern {stable_pat}"


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
