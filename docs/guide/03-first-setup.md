# 3. First-time setup

"Open t@sk4ce" means: in a web browser on your phone or computer, type the address from the install step (like `http://192.168.1.50:3000`) into the address bar. Not working? See [Troubleshooting](06-troubleshooting.md).

The first time you open t@sk4ce, a short wizard asks a few questions. It has eight steps: **You**, **Family**, **Kids**, **Kids' phones**, **Chores**, **Devices**, **Hours** and **Optional extras**. The last one is optional. It takes about 7 minutes, and you can change every answer later.

If you stop partway, just open t@sk4ce again and log in. It picks up where you left off.

![Step 1 of the setup wizard, with all the steps listed on the left](img/setup-account.jpg)

## Step 1. You

The page says "Make your parent account". Type your name, a username and a password (at least 8 characters), then type the password again. This is your parent login. Write the password down somewhere safe.

Tap **Next**.

You should see: step 2, "Your family".

## Step 2. Family

Type your family name. Kids see it on their screens. Check the time zone. The app guesses it from your device, so it is usually right.

![Step 2: family name and time zone](img/setup-family.jpg)

Tap **Next**. This makes your account and logs you in.

You should see: step 3, "Add your kids".

## Step 3. Kids

For each kid: type their name, tap the avatar button to pick an avatar from a small pop-over, and optionally set a 4-digit PIN. A PIN lets a kid prove it's them on a shared device. Tap **Add kid**. Add everyone, then tap **Next**.

You should see: each kid on one line at the top, marked "Added", with the form below ready for the next kid.

Every kid starts with the **Kid (9–12)** look. You can switch a kid to **Little (5–8)** or **Teen (13+)** later, in **Kids & chores**. See [For kids](05-for-kids.md).

## Step 4. Kids' phones

This step puts t@sk4ce on your kids' own phones. Each kid on the list has a **Show code** button. Tap it and a square code appears. On the kid's phone, open the camera and point it at the code. The phone opens a welcome page. The code **works once, for 24 hours**. If it runs out, or you want a fresh one, tap **New code**.

![Kids' phones: a code for each kid (example; the code shown can't be scanned)](img/setup-phones.jpg)

No kids yet? The step says "Add a kid first, or tap Next to go on." You can also do it later from the kid's page. See [For kids](05-for-kids.md).

You should see: the phone shows "You're in" and the kid's name.

## Step 5. Chores

Tap the starter chores you like, such as **Make bed**, **Homework** or **Feed the pet**. Each one becomes a daily chore for every kid you added, with points (Homework is for school days only). They are only a start. You can change them later.

You should see: a tick on each chore you picked, and "4 picked" (or however many) next to **Next**.

## Step 6. Devices

The page asks "Whose devices are these?" Devices show up here once the home box sees them on your Wi-Fi. This can take a minute or two. Ask each kid to unlock their phone, tablet or console and open a web page.

The page shows a short list: **Need an owner** and **Done**. Open **Need an owner**. For each device, tap **Owner** and pick the kid. A shared device can have more than one owner. Pick **Guest (never blocked)** for devices that should never be blocked, like a visitor's phone or the family TV, or **Not sure yet** to decide later.

![Choosing who owns each device](img/setup-devices.jpg)

You should see: the kid's name on each device, and **Need an owner** getting shorter. Devices you skip wait under **Who's this?** on the **Devices** page, and you can finish there later.

Not seeing a device? iPhones and iPads use a "Private Wi-Fi Address". Turn it off for your home Wi-Fi in the device's Wi-Fi settings. If nothing shows up after a few minutes, skip this step and see [Troubleshooting](06-troubleshooting.md).

## Step 7. Hours

The page asks "When can devices be online?" It starts you with two schedules for everyone:

- **School nights** (Sunday to Thursday): 7 am to 8 pm.
- **Weekends** (Friday and Saturday): 8 am to 10 pm.

There is no separate school-hours block, so devices are not cut off during the school day. Change the bedtimes if you like. Tap the pencil on a row to change it, or **Add hours** for more.

![Step 7: the starting schedule on a timeline](img/setup-hours.jpg)

**Lock until today's chores are done** is on. That means devices stay paused, even inside these hours, until the day's chores are approved. Turn it off if you only want the schedule. Chores from step 5 start at the next daily reset after you finish, so nobody is paused while you finish setting up.

You should see: the hours as bars on the timeline.

Tap **Next**.

## Step 8. Optional extras

![Step 8: optional extras, all off](img/setup-extras.jpg)

Two ways to tap less. Both are off. You can **Skip** this step or switch on only what you want. Each one is explained in [Everyday use](04-everyday-use.md#less-tapping).

- **Trust mode**: one switch for each kid. Chores approve themselves as that kid earns it, with random spot checks.
- **Bedtime auto-approve**: at 9:00 PM, chores still waiting approve themselves.

Tap **Finish**.

You should see: "You're all set", with how many kids, chores, devices and schedules you made. Hours start now. If you picked chores for your kids, they start at the next daily reset (6:00 AM unless you changed it), and so does the chore lock if it is on. A tip links to [Remote access](../remote-access.md) if you want to check in away from home. Tap **Go to Today**.

### Add t@sk4ce to your home screen

You can put t@sk4ce on your own phone like an app. This works once your box has its secure address (the `https` one from [Install](02-install.md)).

- **iPhone:** open it in Safari, tap the Share button at the bottom of the screen, then tap **Add to Home Screen**, then **Add**.
- **Android:** open it in Chrome, tap the menu (three dots), then tap **Add to Home screen** or **Install app**.

![Today for one kid: their chores and requests](img/today-kid.jpg)

Today shows a card for each kid. Tap a kid to see their day, and tap **All** to go back. A **Needs you** bar appears when something is waiting.

## Test that pausing works

Do this once. It takes two minutes.

1. Tap **Devices**. On a phone it is in the bar at the bottom. On a computer it is in the bar on the left.
2. Tap a kid's device to open it.
3. Tap **Test block**.

You should see: a message such as "Success — the device lost internet access while blocked."

If you see something else, read the message. It tells you what to try. The other messages are explained in [the home box notes](../blocker.md) and in [Troubleshooting](06-troubleshooting.md).

Make sure the device is awake and online before you press the button. Open a video on it if the test says it didn't see the device use the internet.

## Show your kids

Open the kid's device. Use its browser to go to the same address with `/kid` on the end (for example `http://192.168.1.50:3000/kid`) and bookmark it. Then show them [the kids' page](05-for-kids.md).

Next: [Everyday use](04-everyday-use.md).
