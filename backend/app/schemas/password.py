"""Shared password type: bcrypt only uses the first 72 bytes, so reject longer input."""

from typing import Annotated

from pydantic import AfterValidator, Field

BCRYPT_MAX_BYTES = 72


def _max_bytes(v: str) -> str:
    if len(v.encode()) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes.")
    return v


Password = Annotated[str, Field(min_length=8), AfterValidator(_max_bytes)]
