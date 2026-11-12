# Remote access

Remote access lets you open t@sk4ce on your phone when you are away from home. It uses Tailscale, a free private network. Nobody else on the internet can open your box.

## Who it is for

Parents who want to approve a chore, or check on a device, from work or while traveling. It is optional.

## Turn it on

This is not a switch in t@sk4ce. You install Tailscale on the box and on your phone. The full steps, with what you should see each time, are in [Remote access (check in from away from home)](https://github.com/JMO-Labs/tskfrce/blob/main/docs/remote-access.md). In short:

1. Make a free Tailscale account.
2. Put Tailscale on the home box and sign in.
3. Put the Tailscale app on your phone and sign in with the same account.
4. With Tailscale on, open `http://` plus the box's Tailscale number, then `:3000`, in your phone's browser. Bookmark it.

## Make the links work from away

Pings and password reset links point to your home address by default. To fix that:

1. Open **Settings → Notifications**.
2. Open the **App address** row.
3. Type your Tailscale address, for example `http://100.101.102.103:3000`. It saves when you leave the field.

Leave it blank to go back to the default. The page says "Used for links in pings and password reset links."

## Turn it off

On the box, run `sudo tailscale down`. Or switch Tailscale off in the phone app. Clear **App address** so links go back to your home address.

## What your kid sees

Nothing changes. Kids use their own page on the home Wi-Fi and do not need Tailscale.

## Limits and gotchas

- Tailscale must be on, on your phone, every time. Without it the address does not open.
- Only people you share your Tailscale account or machine with can reach the box.
- Do not change `BOX_URL` in the `.env` file for this. Kids' devices at home still use that address. Use **App address**.
- Remote access does not change which devices are locked. The box still does that at home.

## FAQ

**Is my box on the public internet?** No. Only devices on your Tailscale network can reach it.

**Does it cost anything?** Tailscale is free for personal use.

**Can another parent use it?** Yes. They need Tailscale on their phone and access to your Tailscale network.

Back to [feature guides](README.md).
