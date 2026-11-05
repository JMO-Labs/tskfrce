"""Growing lockout for guessable secrets (claim code).

FAILS failures within WINDOW lock the key for BASE seconds, doubling on each further
lockout up to CAP. A key's strikes are forgotten FORGET seconds after its last failure.
Only failures count. ponytail: single-process dict, like ratelimit.
"""

import math
import time
from collections import deque
from threading import Lock

from fastapi import HTTPException, status

FAILS = 5
WINDOW = 60
BASE = 60
CAP = 3600
FORGET = 86400
SWEEP_ABOVE = 1000  # keys; past this, `fail` drops forgotten keys

_now = time.monotonic
# key -> (recent fail times, strikes, locked_until, last_fail)
_state: dict[str, tuple[deque[float], int, float, float]] = {}
_lock = Lock()


def check(key: str) -> None:
    """Raise 429 while `key` is locked out."""
    with _lock:
        entry = _state.get(key)
        left = entry[2] - _now() if entry else 0
    if left > 0:
        n = math.ceil(left / 60)
        unit = "minute" if n == 1 else "minutes"
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, f"Too many tries. Wait {n} {unit} and try again."
        )


def fail(key: str) -> None:
    """Record one failure; lock the key once it has FAILS within WINDOW."""
    with _lock:
        now = _now()
        fails, strikes, locked_until, last = _state.get(key) or (deque(), 0, 0.0, now)
        if now - last >= FORGET:
            fails, strikes = deque(), 0
        while fails and fails[0] <= now - WINDOW:
            fails.popleft()
        fails.append(now)
        if len(fails) >= FAILS:
            strikes += 1
            locked_until = now + min(BASE * 2 ** (strikes - 1), CAP)
            fails.clear()
        _state[key] = (fails, strikes, locked_until, now)
        if len(_state) > SWEEP_ABOVE:
            _sweep(now)


def _sweep(now: float) -> None:
    """Keys are client IPs; drop ones whose strikes are already forgotten."""
    for k in [k for k, v in _state.items() if now - v[3] >= FORGET]:
        del _state[k]


def reset() -> None:
    """Forget all keys (tests)."""
    with _lock:
        _state.clear()
