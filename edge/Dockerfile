FROM caddy:2-alpine
RUN apk add --no-cache curl
COPY --from=goacme/lego:v4.35.2 /lego /usr/local/bin/lego
COPY edge.sh /edge.sh
COPY Caddyfile /etc/caddy/Caddyfile
RUN chmod +x /edge.sh
ENTRYPOINT ["/edge.sh"]
