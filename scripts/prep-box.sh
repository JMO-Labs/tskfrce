#!/bin/sh
# t@sk4ce one-paste box prep for a fresh Ubuntu/Debian box (x86_64 or arm64, incl. Raspberry Pi).
#   curl -fsSL https://raw.githubusercontent.com/JMO-Labs/tskfrce/main/scripts/prep-box.sh | sh
# Run as your normal user (not root); it asks for your password once for sudo.
# Updates the OS, adds tools, swap (small RAM), SSH, auto security updates, Docker,
# then runs install.sh. Safe to run again.
#
#   TASK4CE_REF   branch/tag to install (default main; beta boxes: TASK4CE_REF=eval)
#   SWAP_GB       swap size when RAM <= 4 GB (default 4)

set -eu

REF="${TASK4CE_REF:-main}"
SWAP_GB="${SWAP_GB:-4}"
APT="sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nSomething went wrong: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" != "0" ] || die "Run this as your normal user, not root (it uses sudo itself)."
have apt-get || die "This script needs Ubuntu or Debian (apt)."
case "$(uname -m)" in x86_64 | amd64 | aarch64 | arm64) ;; *) die "Unsupported CPU: $(uname -m). Use 64-bit OS." ;; esac
# Passwordless sudo first: sudo-rs (Ubuntu 26.04+) -v prompts even under NOPASSWD (MAAS/cloud users).
# shellcheck disable=SC2024 # tty redirect feeds the password prompt under curl|sh
sudo -n true 2>/dev/null || sudo -v </dev/tty || die "sudo is needed."

say "Updating the system (can take a while)"
$APT update -q
$APT -yq -o Dpkg::Options::=--force-confold full-upgrade
$APT install -yq curl git ca-certificates openssl iproute2 nftables \
  openssh-server unattended-upgrades

say "Turning on SSH and automatic security updates"
sudo systemctl enable --now ssh
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' |
  sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null

# ponytail: on-box Next.js build OOMs at <=2 GB RAM; swap is the cheap fix.
ram_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
if [ "$ram_kb" -le $((4 * 1024 * 1024)) ] && [ "$swap_kb" -lt $((SWAP_GB * 1024 * 1024 / 2)) ] && [ ! -e /swapfile ]; then
  say "Low RAM ($((ram_kb / 1024)) MB): adding ${SWAP_GB} GB swap at /swapfile"
  sudo fallocate -l "${SWAP_GB}G" /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024))
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if ! have docker; then
  say "Installing Docker"
  # get.docker.com can lag new Ubuntu releases; fall back to Ubuntu's own packages.
  curl -fsSL https://get.docker.com | sudo sh ||
    $APT install -yq docker.io docker-compose-v2 ||
    die "Docker did not install."
fi
sudo systemctl enable --now docker
sudo docker compose version >/dev/null 2>&1 || die "Docker compose plugin is missing."
# Security: docker group = root-equivalent. Fine on a single-purpose home box.
sudo usermod -aG docker "$(id -un)"

say "Installing t@sk4ce ($REF)"
curl -fsSL "https://raw.githubusercontent.com/JMO-Labs/tskfrce/$REF/install.sh" |
  TASK4CE_REF="$REF" TASK4CE_YES=1 sh

say "Done. Log out and back in once so 'docker' works without sudo."
say "Tip: reserve this box's IP in your router (UniFi: Client > Settings > Fixed IP): $(hostname -I | cut -d' ' -f1)"
