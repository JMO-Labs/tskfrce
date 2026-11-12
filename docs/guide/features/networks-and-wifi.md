# Networks and Wi-Fi

The box can block devices on every network it is plugged into, and you can change its Wi-Fi from the app.

## Who it's for

Parents whose home has more than one network (for example the main Wi-Fi plus a guest or IoT network), or who move the box to new Wi-Fi.

## Block on every network

Leave `LAN_IFACE` empty in the `.env` file. The installer does this by default. The box then finds and blocks devices on every network it is attached to, and the block page shows on each. Set `LAN_IFACE` only if you want to limit the box to one network.

## Change the Wi-Fi

1. Open **Settings → Wi-Fi**.
2. Pick the network and type the password.

If the box can't reach any network, it shows a `/wifi-setup` page you can open from a phone joined to the box. Pick your Wi-Fi there.

## What a blocked phone sees

It stays joined and shows "Connected". `http://` sites show the block page, `https://` sites just close. See [the home box notes](../../blocker.md).

## If it doesn't work

- The box can't block mobile data. Lock it on the phone: [Troubleshooting](../06-troubleshooting.md#if-a-blocked-phone-still-gets-online).
- UniFi **Proxy ARP** or client isolation can stop the box: [routers](../../routers.md).
