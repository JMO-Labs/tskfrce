# Integrations (parent view)

An integration connects another app to your family. It can check off a chore, answer a request, send you a message, or show a card on your kid's screen. You decide what each one is allowed to do.

## Who it is for

Parents who use other apps at home, such as Home Assistant, and want them to work with chores. Skip this if you do not.

## Where it lives

**Settings → Integrations**. It says "Connect other apps to your family." The page has three lists:

- **Connected**: what you already added, with a chip: **Active**, **Paused** or **Turned off**.
- **Add**: apps you can connect. Each has an **Add** button. When there is nothing new it says "Nothing to add yet."
- **Home network keys**: for Home Assistant or a script on your home network. See below.

## Add an app, step by step

1. Open **Settings → Integrations** and tap **Add** next to the app.
2. If the app has settings, fill them in under **Set up (app name)** and tap **Next**.
3. **Who is this for?** Tick the kids. If it can check off chores, tick **Which chores can it check off?**. If it can show cards, switch on **Show cards on (kid)'s screens**. Tap **Next**.
4. Read **(app) will be able to:**. It lists what it can do, who made it, and where data goes (**Data goes to:**). Items marked **High risk** need extra thought.
5. Tap **Allow & connect**. Nothing is sent until this last step. **Cancel** or **Back** is safe at any point.

## Home network keys

1. Tap **Create key**.
2. Give it a **Name** (for example Home Assistant), tick what **This key can** do, pick **Which kids is it for?** and, if offered, **Which chores can it check off?**.
3. Tap **Create key**. You see **Your new key**. **Copy this now. You won't see it again.** Examples for curl and Home Assistant are shown.

Keys only work from inside your home. Through the public address they are refused.

## Look after one

Tap a row in **Connected** to open it.

- **It can** lists what it is allowed to do.
- **Trust automatically**: off (the default) means its chore check-offs wait in **Needs you**. On means they count right away without your OK, and finished chores can unlock devices.
- **Cards on kid screens**: a **Show cards on (kid)'s screens** switch for each kid.
- **Activity** lists what it did, with a status: **Applied**, **Waiting for you** or **Rejected**.
- If it says **Paused**, tap **Try again** once it is working again.
- **Remove** takes the app away. For a key the button says **Revoke key**.

## What your kid sees

- Cards from an app you allowed appear on their page.
- A chore the app checks off follows the same rules as any chore. If you did not turn on **Trust automatically**, the kid waits for your OK.

## Limits and gotchas

- An app only gets what is on its list. Anything else is refused.
- If an app stops answering, t@sk4ce pauses it. A line says **Paused:** and why. If t@sk4ce turns one off itself, it says "t@sk4ce turned this one off."
- Turn on **Trust automatically** only for apps you trust. They can unlock devices by finishing chores.

## FAQ

**Can an app see my kids' chat?** Only if its list says so. Read **It can** before you tap **Allow & connect**.

**I lost my key.** Revoke it and create a new one.

**Where do app check-offs show?** In **Needs you** as **Chore done**, unless the app is trusted.

Developers: see the [integration protocol](https://github.com/JMO-Labs/tskfrce/blob/main/docs/integrations/protocol-v1.md).

Back to [feature guides](README.md).
