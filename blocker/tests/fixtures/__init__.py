"""Golden fixture definitions for contract suite.

Contains PCAP frames and expected parsing results for both Python and Go tests.
"""

from .fixture_schema import create_default_fixtures, load_fixtures

__all__ = ["create_default_fixtures", "load_fixtures"]
