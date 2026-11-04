"""Minimal pytest configuration for homework mode tests."""

import os
import tempfile

# Set test environment before any app imports
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="task4ce-test-"))
os.environ.setdefault("LOCK_LOOP_ENABLED", "false")

import pytest
