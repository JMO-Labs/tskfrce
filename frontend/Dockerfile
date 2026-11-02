# ---- Deps: every package, installed on the build machine's own CPU ----
FROM --platform=$BUILDPLATFORM node:26-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci

# ---- Dev: docker-compose.yml and the lab run the Next dev server from this ----
FROM deps AS dev
RUN apk add --no-cache netcat-openbsd bash
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]

# ---- Build: standalone server is plain JS, so one build serves amd64 and arm64 ----
FROM deps AS build
COPY . .
ENV NODE_ENV=production
RUN npm run build

# ---- Runtime (default target, used by docker-compose.prod.yml and CI images) ----
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
