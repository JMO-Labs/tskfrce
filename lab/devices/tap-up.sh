#!/bin/sh
# emulator -net-tap-script-up hook: hand the opened TAP to the droid netns (root work done by droidns).
exec sudo -n /usr/local/sbin/droidns tap attach
