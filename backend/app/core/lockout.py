"""Growing lockout for the claim code: FAILS in WINDOW lock a key BASE s, doubling to CAP.

Strikes are forgotten FORGET s after the last fail. ponytail: single-process dict.
"""

import math
import time
from collections import deque
from itertools import islice
from threading import Lock

from fastapi import HTTPException, status

FAILS = 5
WINDOW = 60
BASE = 60
CAP = 3600
FORGET = 86400
SWEEP_ABOVE = 1000  # keys; the first sweep runs past this, then each time the map doubles
MAX_KEYS = 10_000  # hard cap; past it, the keys with the oldest last fail are evicted

_now = time.monotonic
# key -> (recent fail times, strikes, locked_until, last_fail)
_state: dict[str, tuple[deque[float], int, float, float]] = {}
_lock = Lock()
_sweep_at = SWEEP_ABOVE  # sweep once the map grows past this


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
    """Record one failure. Call `check` first and stop on 429: fails while locked count."""
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
        _state.pop(key, None)  # re-insert: dict order stays oldest last_fail first
        _state[key] = (fails, strikes, locked_until, now)
        if len(_state) > _sweep_at:
            _sweep(now)


def _sweep(now: float) -> None:
    """Keep locked keys or recent fails; past MAX_KEYS halve it. Runs when the map doubles."""
    global _sweep_at
    idle = [k for k, v in _state.items() if v[2] <= now and not (v[0] and v[0][-1] > now - WINDOW)]
    for k in idle:
        del _state[k]
    if len(_state) > MAX_KEYS:
        for k in list(islice(_state, len(_state) - MAX_KEYS // 2)):
            del _state[k]
    _sweep_at = min(MAX_KEYS, max(SWEEP_ABOVE, 2 * len(_state)))


def reset() -> None:
    """Forget all keys (tests)."""
    global _sweep_at
    with _lock:
        _state.clear()
        _sweep_at = SWEEP_ABOVE
