# Build stage: cross-compile to target architectures
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git

# Copy go.mod and go.sum
COPY blocker/go.mod blocker/go.sum* ./

# Download dependencies
RUN go mod download

# Copy source
COPY blocker/ ./

# Build for target platform
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG TARGETVARIANT=
ARG GOARM=7

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH GOARM=$GOARM \
    go build -trimpath \
    -ldflags="-s -w -buildid=" \
    -o blockerd \
    ./cmd/blockerd

# Runtime stage: scratch + static busybox
FROM scratch

COPY --from=builder /build/blockerd /app/blockerd

# Copy static busybox (must be built separately with static flags)
# For now, use a minimal shell from busybox image
COPY --from=busybox:1.36-musl /bin/sh /bin/sh
COPY --from=busybox:1.36-musl /bin/ip /bin/ip
COPY --from=busybox:1.36-musl /bin/busybox /bin/busybox

# Copy udhcpc helper script
COPY blocker/udhcpc.sh /app/udhcpc.sh

# Copy data files (OUI, workaround domains)
COPY blocker/data/ /app/data/

WORKDIR /app

ENTRYPOINT ["/app/blockerd"]
