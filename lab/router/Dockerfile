FROM alpine:3.24
# iptables: scripts/lab.sh reuses this image to open the lab bridges on br_netfilter hosts
RUN apk add --no-cache iproute2 iptables ip6tables
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
