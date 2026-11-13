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
    box_ip: str,
    stop: threading.Event,
    kw: dict,
    run: Callable = run_dns,
    retry: float = RETRY_S,
) -> None:
    """Run the v6 listener until stop, retrying the bind on OSError (no v6, port busy)."""
    warned = False
    while not stop.is_set():
        try:
            run(cfg, box_ip, stop, bind=("::", 53), **kw)
            return
        except OSError as e:
            if not warned:
                log.warning("IPv6 DNS listener unavailable, retrying: %s", e)
                warned = True
            stop.wait(retry)
