FROM python:3.15-slim

# nftables: firewall rules. busybox: udhcpc for VLAN sites. libpcap: packet capture/injection for scapy. conntrack: cut connections.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nftables iproute2 busybox libpcap0.8 libpcap-dev conntrack \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
COPY . /opt/blocker
COPY --chmod=755 udhcpc.sh /app/udhcpc.sh
RUN pip install --no-cache-dir "scapy>=2.6"

# Runs as root ON PURPOSE: ARP/NDP spoofing and nftables need NET_RAW and
# NET_ADMIN, which an unprivileged user cannot hold. Compose runs it with host
# networking and ONLY those two capabilities (not privileged).
CMD ["python3", "-m", "blocker"]
