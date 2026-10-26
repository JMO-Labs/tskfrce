# Evaluation kit

Owner guide for the t@sk4ce evaluation boxes: anonymous usage stats (Umami) and parent feedback (Supabase).

## 1. What this is

- This exists on the `eval` branch only. It is never merged to `main`.
- With no `EVAL_*` settings, every part of it is a silent no-op: no network, no `eval.db`.
- What a box tells the family (shown in the app, Settings → Usage stats):
  - This t@sk4ce box is a test version, lent to you by the person who set it up. It sends them anonymous usage counts so they can make it better.
  - What's sent: which screens are opened, setup steps finished, daily counts of chores and locks, error types, and each kid's age range.
  - Never sent: names, usernames, chat or note text, device names, network addresses or your location.
  - Feedback is only sent when you press Send.
- Stats go to Umami under a random household ID, shown in Settings → Usage stats. A fixed documentation IP (`192.0.2.1`) is sent instead of the real one, so there is no location.
- Feedback is insert-only: a box can add rows and screenshots but can never read, change or delete anything.

## 2. Umami on Unraid behind a Cloudflare Tunnel

Note: verified against the Umami docs (docs.umami.is, via context7): `POST /api/send` accepts `payload.id` (distinct ID), `payload.ip` and `payload.timestamp` (unix seconds); `CLIENT_IP_HEADER`, `DISABLE_BOT_CHECK` and `DISABLE_TELEMETRY` are runtime variables. The docs track the current release, not a per-tag snapshot. `SKIP_LOCATION_HEADERS` was checked in the v3.4.1 source (`getLocation` skips provider headers such as `cf-ipcountry` when it is set).

1. Pinned version (from `gh release list -R umami-software/umami --exclude-pre-releases --limit 3` on 2026-10-26: newest stable is `v3.4.1`, 2026-10-23). Image, no `latest`:

   ```
   ghcr.io/umami-software/umami:3.4.1
   ```

   Since v3 the registry tags are plain (`3.4.1`); the `postgresql-` prefix stopped at `postgresql-3.0`, and v3 images are PostgreSQL.
2. Create the Unraid container with these variables:

   ```
   DATABASE_URL=postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require&schema=umami
   APP_SECRET=<output of: openssl rand -hex 32>
   CLIENT_IP_HEADER=x-eval-client-ip
   DISABLE_BOT_CHECK=1
   DISABLE_TELEMETRY=1
   SKIP_LOCATION_HEADERS=1
   ```

   Supabase's direct host `db.<ref>.supabase.co` is IPv6-only unless the IPv4 add-on is on. If Unraid has no IPv6, use the **session pooler** host (also port 5432). The pooler's user is `postgres.<project-ref>`, not `postgres`. Copy the exact connection string from the Supabase dashboard (Connect button).
3. Add a `cloudflared` container with your tunnel token. Public hostname `umami.<domain>` points to `http://<umami-container>:3000`. Put the Umami and `cloudflared` containers on the same custom Docker network in Unraid; the default bridge has no name resolution, so `<umami-container>` would not resolve.
4. Optional: put Cloudflare Access on the dashboard paths. `/api/send` must stay open to the boxes.
5. First login: change the default `admin` / `umami` password, add a website named "t@sk4ce eval", and copy its website ID.

## 3. Supabase feedback storage

Open the project's SQL editor and run this as is:

```sql
create table public.feedback (
  id uuid primary key,
  household uuid not null,
  type text not null check (type in ('feature','bug','other')),
  stars smallint check (stars between 1 and 5),
  text text not null check (char_length(text) between 1 and 2000),
  route text not null,
  app_version text not null,
  errors text[] not null default '{}',
  created_at timestamptz not null,
  screenshot_paths text[] not null default '{}'
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon;
create policy "eval boxes insert feedback" on public.feedback
  for insert to anon with check (true);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-shots', 'feedback-shots', false, 3145728,
        array['image/png','image/jpeg','image/webp']);
create policy "eval boxes upload shots" on storage.objects
  for insert to anon with check (bucket_id = 'feedback-shots');
```

- There is no select, update or delete policy for `anon`, so a box can't read or change anything.
- You read feedback in the Supabase dashboard (Table editor, Storage) or with the secret key.
- Use the project's **publishable (anon) key** for `EVAL_SUPABASE_ANON_KEY`. Never put the secret key on a box.

## 4. Provision a box

1. The box must run the `eval` branch checkout. Add four lines to the box's `.env`, next to `docker-compose.prod.yml`:

   ```
   EVAL_UMAMI_URL=https://umami.<domain>
   EVAL_UMAMI_WEBSITE_ID=<website ID from Umami>
   EVAL_SUPABASE_URL=https://<ref>.supabase.co
   EVAL_SUPABASE_ANON_KEY=<publishable key>
   ```

2. Start it: `docker compose -f docker-compose.prod.yml up -d --build`. On a box with 2 GB RAM or less (or 4 cores), the Next.js build can run out of memory: build on a bigger machine or add RAM/swap, and confirm the frontend image actually built (`docker compose images`).
3. Check:
   - `docker compose logs backend | grep -i eval` shows no warnings.
   - Within a minute Umami shows a `box_boot` event.
   - The household ID is in Settings → Usage stats.

## 5. Check privacy after the first event

In Umami, open the session for the new event:

- Required gate: country and city must be empty, and no IP is shown. If either shows a value, do not give the box to a family; fix the location headers first (see the Umami variable `SKIP_LOCATION_HEADERS=1`, or strip `cf-ipcountry`, `cf-ipcity` and `cf-region-code` with a Cloudflare Transform Rule).
- Event data keys are only the allowed ones: `household`, `app_version`, `source`, `age_group` (kid events) and the counters for that event. No free text.

## 6. Wipe a box between families

1. Flush first. Confirm the outbox is empty:

   ```
   docker compose exec backend python -c "import sqlite3; print(sqlite3.connect('/app/data/eval.db').execute('select count(*) from outbox').fetchone())"
   ```

   It must print `(0,)`. If not, wait a few minutes and run it again (the box must be online).
2. Wipe: `docker compose -f docker-compose.prod.yml down -v`

This deletes the `task4ce_data` volume (`DATA_DIR`), including `eval.db`, the household ID and any queued feedback. Skipping step 1 loses unsent feedback for good.

## 7. Turning it off

Remove the `EVAL_*` lines from `.env` and restart. Everything becomes a silent no-op.

## Known follow-up

After v3 Plan D lands, revisit `rule_off`: today `hours` = an allowed time window deleted, `chore_lock` = a device switched to guest, and `rule_deleted` = a chore deleted or archived. Map them to the real hour-rule and chore-lock switches.
