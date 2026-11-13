#!/usr/bin/env bash
# Start the kidphone emulator with Wi-Fi and mobile data on separate paths:
#   Wi-Fi (wlan0)   -> TAP moved into the droid netns -> real Wi-Fi card -> t@sk4ce box sees it
#   cellular (eth0) -> emulator's user-mode NAT in the root ns -> host uplink (never via the box)
# Hidden/undocumented flags, found the hard way:
#   -wifi-tap needs netsim Wi-Fi off (-feature -WiFiPacketStream), else netsim ignores the TAP;
#   -net-tap would replace the CELLULAR side instead.
# Emulator runs as the user, so it needs the kvm group (sg picks it up without re-login).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SDK=/home/user/Android/Sdk
sudo -n /usr/local/sbin/droidns tap down
sudo -n /usr/local/sbin/droidns tap prep
exec sg kvm -c "ANDROID_HOME=$SDK $SDK/emulator/emulator -avd kidphone -no-window -no-audio \
  -no-boot-anim -no-snapshot -gpu guest -feature -Vulkan,-WiFiPacketStream \
  -wifi-tap droidtap -wifi-tap-script-up $HERE/tap-up.sh"
