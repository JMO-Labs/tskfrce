#!/bin/sh
# busybox udhcpc event script: apply the lease's address; record the router.
# Deliberately adds NO default route: the box runs on host networking and a
# VLAN default route would hijack the host's own routing.
RUN=/run/blocker
mkdir -p "$RUN"
case "$1" in
  bound|renew)
    ip -4 addr flush dev "$interface" 2>/dev/null
    ip -4 addr add "$ip/${mask:-24}" dev "$interface"
    if [ -n "$router" ]; then
      echo "${router%% *}" > "$RUN/$interface.router"
    fi
    ;;
  deconfig)
    ip -4 addr flush dev "$interface" 2>/dev/null
    rm -f "$RUN/$interface.router"
    ;;
esac
exit 0
