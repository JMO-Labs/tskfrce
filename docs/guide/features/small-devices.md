# Small devices and Postgres

t@sk4ce runs well on a small, cheap box such as a Raspberry Pi. This page explains what that means, the memory card trade-off, and the optional switch to a Postgres database.

## What it does

- **Same app on every box.** There is no separate "lite" version. A small box runs exactly what a big one runs, and every feature works.
- **Ready-made download.** Small boxes download t@sk4ce already built, so nothing heavy happens on the box. Only if the download fails does the installer try to build it on the box, and that needs about 4 GB of memory.
- **Gentle on memory cards.** t@sk4ce saves changes in a way that spares an SD card from constant writing.
- **Optional Postgres.** By default your data lives in one file (SQLite). If you already run a Postgres server, you can move to it with one command.

## Who it's for

- Anyone using a Raspberry Pi or an old laptop. See [what you need](../01-what-you-need.md) for the table of boxes we measured.
- Postgres is only for people who already run a Postgres server and want their data there. Most families should skip it.

## How fast is it?

We measured four "tiers" (a tier is a pretend small box with a fixed amount of memory and processor). Every one passes its own targets:

| Box | Pages answer within | Total memory budget |
|---|---|---|
| Raspberry Pi 4 (2 GB) or old laptop (4 GB) | 300 ms | 600 MB |
| Raspberry Pi 3 (1 GB) | 600 ms | 450 MB |
| Raspberry Pi Zero 2 W (512 MB) | 1000 ms | 320 MB |

At rest the whole app uses roughly 230 MB. The full numbers are in the [performance notes](https://github.com/JMO-Labs/tskfrce/blob/dev/docs/perf/2026-11-profile.md).

## Memory card or SSD?

A memory card is cheap but wears out. To be kind to it, t@sk4ce does not force every single change onto the card at once.

The trade-off: **if the power is cut suddenly, the newest change (for example a chore you ticked a second ago) can be lost.** Your older data stays safe and the file is not damaged. A small USB SSD avoids this worry, so use one if you can.

## Turn it on or off

- **Small-box behaviour** is always on. There is nothing to switch.
- **Postgres** is off by default. It turns on when the `DATABASE_URL` line in your `.env` file holds a Postgres address, and off when that line is empty or missing.

## Step by step: move to Postgres

You need a Postgres server you can reach from the box, with an empty database and a user for t@sk4ce.

1. Log in to the box and open the folder where you installed t@sk4ce (the one that holds the `.env` file).
2. Run the move, with your own address (it must start with `postgres://` or `postgresql://`):

   ```
   bash scripts/db-migrate.sh postgresql://user:pass@host:5432/dbname
   ```

3. The script stops t@sk4ce, copies your data, saves a copy of your `.env` as `.env.bak-<date and time>`, writes `DATABASE_URL` into `.env`, and starts t@sk4ce again.
4. When it says **Moved to Postgres**, open t@sk4ce and check that your kids and chores are there.

If anything goes wrong, the script says **Migration failed**, leaves your old data alone and starts t@sk4ce as before. You can run it again after fixing the problem.

## Go back to SQLite

1. Open `.env` and remove the `DATABASE_URL=` line (or leave it empty).
2. Restart: `docker compose -f docker-compose.prod.yml up -d`.

The old SQLite file is kept after a move, but it only holds data up to the moment you moved. Changes made while on Postgres are not copied back.

## Pin an older version

The installer can keep your box on a numbered release instead of the newest one:

```
curl -fsSL https://jmo-labs.github.io/tskfrce/install.sh | TASK4CE_REF=v2.13.0 sh
```

The installer writes `TASK4CE_TAG=2.13.0` into `.env`, so a reboot keeps those images. Running the plain install line again moves the box back to the newest version. More in [install](../02-install.md).

## Limits and gotchas

- Run `db-migrate.sh` from the install folder. Without a `.env` there, it stops with an error.
- t@sk4ce does not set up a Postgres server for you. You bring your own.
- The move is one way for data: SQLite is not updated while you use Postgres.
- The first start after a boot takes 10 to 20 seconds on small boxes.
- On a very small box, do not build on the box. If the download fails, fix the internet and run the installer again.

## FAQ

**Do I need Postgres?** No. SQLite is the default and is plenty for a family.

**Will a Pi Zero 2 W work?** It passed our tests, but it is the slowest box we measured. A Pi 3 or newer is more comfortable.

**Is my data safe on a memory card?** Yes, apart from the newest change if the power is cut. Back up regularly, or use an SSD.

**Can I undo the move?** Yes, see "Go back to SQLite" above, remembering the data caveat.

Back to [feature guides](README.md).
