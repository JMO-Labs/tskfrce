"""IPv6 DNS listener for the block portal.

The firewall redirects blocked devices' v6 DNS to [::]:53 on the arrival interface. One
service-wide listener (V6ONLY, so it never touches the v4 :53 binds, including the setup
hotspot's 10.42.0.1) that retries the bind until the service stops.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from blocker.portal import run_dns

log = logging.getLogger(__name__)
RETRY_S = 5.0


def serve(
    cfg,
    box: Callable[[], str],
    stop: threading.Event,
    kw: dict,
    run: Callable | None = None,
    retry: float = RETRY_S,
    bind: tuple[str, int] = ("::", 53),
) -> None:
    """Run the v6 listener until stop, retrying the bind on OSError (no v6, port busy).

    box() gives the fallback A answer; never start with an empty one (an empty A record
    fails to encode and the client times out instead of reaching the portal), so wait.
    """
    run = run or run_dns
    warned = False
    while not stop.is_set():
        box_ip = box()
        if not box_ip:
            stop.wait(retry)
            continue
        try:
            run(cfg, box_ip, stop, bind=bind, **kw)
            return
        except OSError as e:
            if not warned:
                log.warning("IPv6 DNS listener unavailable, retrying: %s", e)
                warned = True
            stop.wait(retry)
