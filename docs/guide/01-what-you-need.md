# 1. What you need

You need three things. You probably have two already.

## 1. A home box

This is a small computer that stays on all the time. It runs t@sk4ce and pauses the internet for the devices you choose.

Good choices:

- **A Raspberry Pi 3B+, 4 or 5** (best). Small, cheap and uses very little power. 1 GB of memory is enough; 2 GB gives more room. Get a power supply, a network cable, and a memory card (32 GB or more) or, better, a small USB SSD, which lasts longer than a memory card.
- **An old computer that runs Linux** and can stay on all day.

### Which box is big enough?

| Box | Memory | Works? |
|---|---|---|
| Raspberry Pi 4 or 5, or an old laptop | 2 GB or more | Yes, comfortable. |
| Raspberry Pi 3B+ | 1 GB | Yes. A bit slower, but every feature works. |
| Raspberry Pi Zero 2 W | 512 MB | Possible, but tight. Pages open in well under a second when idle and slow down when busy; the first start takes about 20 seconds. |

We measured all of these (see the [performance notes](https://github.com/JMO-Labs/tskfrce/blob/dev/docs/perf/2026-11-profile.md)). The app and its helpers use roughly 230 MB when idle, so even the smallest box has room. There is no separate "lite" version: small boxes run the same app.

Small boxes **download** t@sk4ce ready-made, which is quick. If the download fails, the installer builds it on the box instead. That needs about 4 GB of memory, so on a small box fix the download problem and run the installer again.

**Memory card or SSD?** A memory card (SD card) is cheap but wears out, and t@sk4ce saves changes in a way that is gentle on the card. The trade-off: **if the power is cut suddenly, the last change or two (for example a chore you ticked a second ago) can be lost.** Your older data stays safe. A small USB SSD avoids this worry and lasts longer, so use one if you can.

The box must run **Linux** to pause the internet. A Windows PC or a Mac can show you the app, but it cannot pause anything.

**Plug the box into your router with a network cable.** Wi-Fi works less well for this job.

## 2. An ordinary home router

Any normal router from your internet company works. A few kinds, mostly "mesh" Wi-Fi systems, can stop the box from doing its job. See the [router list](../routers.md). You can also just try it: after setup, the **Test block** button on each device tells you if it works.

## 3. Your kids' devices on your home Wi-Fi

t@sk4ce only works on your **home** Wi-Fi. It cannot control a phone on mobile data or on someone else's Wi-Fi. Read [what it can and cannot do](07-faq.md#can-my-kid-get-around-it) before you start.

## Where to put the box

Put it somewhere your kids can't easily reach, like a shelf in a closet, with the network cable and power plugged in. If someone unplugs it, the internet simply comes back on for everyone.

> **For the curious.** The box redirects the traffic of paused devices to itself and drops it, using ARP/NDP and nftables. It does not replace your router. More in [engineering.md](../engineering.md).

## Time and cost

About 20 minutes. The software is free. You only pay for the box if you don't have one.

Next: [Install](02-install.md).
