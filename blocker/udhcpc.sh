#!/bin/sh
# busybox udhcpc event script: apply the lease's address; record the router.
# Deliberately adds NO default route: the box runs on host networking and a
# VLAN default route would hijack the host's own routing.
# The lease is untrusted (any device on the VLAN can answer DHCP), so it is only
# applied when it is a private address with a /16-/30 prefix that overlaps no
# route the host already has on another interface.
# shellcheck disable=SC2154 # interface, ip, mask, router come from udhcpc
RUN=/run/blocker
mkdir -p "$RUN"

lease_ok() {
  case "$mask" in 1[6-9] | 2[0-9] | 30) ;; *) return 1 ;; esac
  case "$ip" in 10.* | 192.168.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) ;; *) return 1 ;; esac
  # Overlap either way with a non-default route on another interface: routes inside
  # the leased net (root) or containing it (match).
  ! { ip -4 route show root "$ip/$mask"; ip -4 route show match "$ip/$mask"; } |
    grep -v '^default' | grep -qv " dev $interface "
}

case "$1" in
  bound | renew)
    if ! lease_ok; then
      echo "udhcpc.sh: refusing lease $ip/$mask on $interface" >&2
      ip -4 addr flush dev "$interface" 2>/dev/null
      rm -f "$RUN/$interface.router"
      exit 0
    fi
    ip -4 addr flush dev "$interface" 2>/dev/null
    ip -4 addr add "$ip/$mask" dev "$interface"
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
