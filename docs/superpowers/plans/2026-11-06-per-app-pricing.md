# Per-app pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Device groups can have their own screen-time price. A kid buying time picks what it's for, and only those devices unlock.

**Architecture:** There are two new nullable columns, `device_groups.screen_price` and `redemptions.device_group_id`. Price and option logic lives in
`backend/app/services/screen_time.py`. `economy._request` prices the purchase and `_decide` unlocks only the matching devices. The APIs expose the price and
the options. The frontend adds a price field on the group page and a "What for?" picker on the kid's buy card.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest; Next.js/React, TypeScript, jest.

**Spec:** `docs/superpowers/specs/2026-11-06-per-app-pricing-design.md`

## Global Constraints

- Group price: Integer, nullable, 1–1000 (same bounds as the family `price`). Null means the group uses the family price. No 0.
- Cost = `minutes // 15 * price`, fixed when the request is made.
- Families with no group prices see exactly one option, "All my devices", at the family price. Behaviour is otherwise unchanged.
- One daily cap: `screen_time.check` counts all purchases, whatever the group.
- Existing theme tokens and components only. Take light and dark screenshots on phone and desktop for every UI change.
- Files stay under 500 lines. Use semantic commits. Version **2.3.0**.
- Commit trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Rulings (controller, beyond the spec)

- Devices can be in several groups (many-to-many). A group is an option when the kid owns at least one device that is not `exempt` in it
  **and** the group has `chore_lock` on. Groups with `chore_lock` off are "free" and are never options.
- The "All my devices" price is the max of the family price **only if** the kid has a non-exempt device in no chore-locked group, and the
  `screen_price or family price` of each option group. A kid whose only devices sit in a 40-priced group pays 40 for "All".
- Single-option rule: if the options are just one group whose devices are all the kid's non-exempt devices, show only "All my devices".
  Simplest form: if every option has the same price as "All", return only "All".
- Deleted group before approval: `device_group_id` is set to NULL by the FK, so the redemption unlocks all devices at the cost already paid.

## Review Focus

1. **A kid sends a `group_id` that isn't one of their options** (another kid's group, a free group, a missing id). Expect a 400 "Pick one of your options.", with no charge.
2. **A group price changes while a request is pending.** Expect the cost stored on the redemption to be the one charged.
3. **A device is in two groups, priced 40 and 30, and the kid buys the 30 group.** Only the devices in the 30 group unlock, including that shared device. No other devices unlock.
4. **The group is deleted between request and approval.** Expect approval to unlock all of the kid's devices and not crash.
5. **The family has no group prices.** Expect `options` to be `[{"group_id": None, "name": "All my devices", "icon": "devices", "price": 20}]`, and the old request body (no `group_id`) to behave exactly as before.

---

### Task 1: Data and pricing service

**Files:**
- Create: `backend/alembic/versions/v5e6f7a8b9c0_group_screen_price.py` (`down_revision = "u4d5e6f7a8b9"`)
- Modify: `backend/app/models/lock.py` (`DeviceGroup.screen_price = Column(Integer, nullable=True)`)
- Modify: `backend/app/models/reward.py` (`Redemption.device_group_id = Column(Integer, ForeignKey("device_groups.id", ondelete="SET NULL"), nullable=True)`)
- Modify: `backend/app/services/screen_time.py`
- Test: `backend/tests/test_screen_price.py` (new)

**Interfaces:**
- Produces: `screen_time.options(db, fam, kid) -> list[dict]`. Each dict is `{"group_id": int|None, "name": str, "icon": str, "price": int}`. "All my devices" comes first with `group_id: None` and `icon: "devices"`, then the groups ordered by id.
- Produces: `screen_time.price_for(db, fam, kid, group_id: int|None) -> int`. Raises `HTTPException(400, "Pick one of your options.")` when `group_id` is not in `options`.
- Produces: `screen_time.group_devices(kid, group_id: int|None) -> list[Device]`. It returns the kid's devices in that group, or all of the kid's devices when `group_id` is None.

- [ ] **Step 1: Write failing tests** in `test_screen_price.py`, using the fixtures in `tests/test_screen_time.py`:
  - `test_no_group_prices_single_all_option`: family price 20, one grouped device, group price None → `options == [{"group_id": None, "name": "All my devices", "icon": "devices", "price": 20}]`.
  - `test_group_price_adds_option`: a phone in Tablets (None → 20) and a console in Consoles (40) → `[{"group_id": None, "price": 40, ...}, {Tablets, 20}, {Consoles, 40}]`.
  - `test_same_prices_collapse`: only Consoles (40) with every kid device in it → `[{"group_id": None, "name": "All my devices", "icon": "devices", "price": 40}]`.
  - `test_free_group_not_an_option`: Speakers with `chore_lock=False` does not appear in the options, even with a price set.
  - `test_exempt_device_ignored`: a group whose only kid device is `exempt` does not appear in the options.
  - `test_price_for_rejects_foreign_group`: another kid's group id → HTTPException 400 "Pick one of your options."
  - `test_group_devices_shared_device`: a device in both Consoles and Tablets is returned for each group id.
- [ ] **Step 2:** Run `cd backend && ../hwvenv/bin/python -m pytest tests/test_screen_price.py -q` and expect FAIL.
- [ ] **Step 3:** Add the columns and the migration. The migration adds both columns. Use `batch_alter_table` for SQLite, following `u4d5e6f7a8b9_bypass_kinds.py`.
- [ ] **Step 4:** Implement the three functions in `screen_time.py`. Keep the file under 200 lines.
- [ ] **Step 5:** Run the tests and expect PASS. Run `alembic heads` and expect exactly one head, `v5e6f7a8b9c0`. Run `ruff check . && ruff format --check .`.
- [ ] **Step 6:** Commit `feat(screen-time): per-group screen price and options`.

### Task 2: Charge and unlock by group

**Files:**
- Modify: `backend/app/services/economy.py` (`request`, `_request`, `_decide`, `_what`)
- Modify: `backend/app/api/rewards.py` (`redemption_name`)
- Test: `backend/tests/test_screen_price.py`, append

**Interfaces:**
- Consumes: the Task 1 functions.
- Produces: `economy.request(db, kid, kind, reward_id, minutes, device_id=None, group_id=None)`. The same `group_id` kwarg is added to `_request`.
- Produces: `redemption_name` returns `"30 min on Consoles"` when `device_group_id` is set and the group exists. Otherwise it returns `"30 min of screen time"` (unchanged).

- [ ] **Step 1: Failing tests:**
  - `test_request_group_cost`: Consoles at 40, 30 min → `red.cost == 80` and `red.device_group_id == consoles.id`.
  - `test_request_all_uses_max`: 30 min, no group → cost `80` in the Tablets 20 / Consoles 40 setup.
  - `test_price_change_after_request_keeps_cost`: request, then set Consoles to 100, then approve → the Points debit is `-80`.
  - `test_decide_unlocks_only_group`: approving a Consoles request creates bonus `Override`s only for the console device ids.
  - `test_decide_deleted_group_unlocks_all`: request Consoles, delete the group, approve → overrides for all of the kid's devices, and the debit equals the stored cost.
  - `test_redemption_name_group`: `redemption_name(db, red) == "30 min on Consoles"`.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement the change. In `_request`, replace `minutes // 15 * fam.screen_time_price` with `minutes // 15 * screen_time.price_for(...)`. Note the existing local import, which avoids an import cycle. Store `device_group_id`. Set it to None for non-screen kinds. In `_decide`, loop over `screen_time.group_devices(kid, redemption.device_group_id)`.
- [ ] **Step 4:** Run `tests/test_screen_price.py tests/test_economy.py tests/test_economy_race.py tests/test_redemptions.py tests/test_screen_time.py` and expect all to PASS.
- [ ] **Step 5:** Commit `feat(economy): charge and unlock screen time by device group`.

### Task 3: APIs

**Files:**
- Modify: `backend/app/api/devices.py` (`GroupIn.screen_price: int | None = Field(None, ge=1, le=1000)`, `_group_out` adds `"screen_price"`, create and patch set it)
- Modify: `backend/app/api/kid_rewards.py` (`RedeemIn.group_id: int | None = None`, passed to `economy.request`; GET `/rewards` adds `screen["options"] = screen_time.options(db, fam, kid)`)
- Test: `backend/tests/test_kid_api.py` and the devices group tests (find them with `grep -ln "/groups" tests/`), append

**Interfaces:**
- Produces: GET `/api/v1/kid/rewards` → `screen.options: [{group_id, name, icon, price}]`.
- Produces: POST `/api/v1/kid/redeem` accepts `group_id`.
- Produces: group JSON has `screen_price: number | null`. PATCH with `"screen_price": null` clears it. **Omitting** the key leaves it unchanged. Use `body.model_fields_set` to tell the two apart.

- [ ] **Step 1: Failing tests:**
  - `test_group_screen_price_roundtrip`: PATCH 40 → GET shows 40; PATCH null → null; PATCH without the key → unchanged.
  - `test_group_screen_price_bounds`: 0 → 422; 1001 → 422.
  - `test_kid_rewards_options`: the response has `screen.options[0]["group_id"] is None`.
  - `test_kid_redeem_group`: POST `{kind: "screen_time", minutes: 30, group_id: consoles}` → 200 and cost 80.
  - `test_kid_redeem_foreign_group`: → 400 and the balance is unchanged.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run the full backend suite: `cd backend && ../hwvenv/bin/python -m pytest -q -x` (about 7 minutes) and expect all to PASS. Run ruff clean.
- [ ] **Step 5:** Commit `feat(api): group screen price and kid screen options`.

### Task 4: Parent UI

**Files:**
- Modify: `frontend/src/v2/types.ts` (group type `screen_price: number | null`)
- Modify: `frontend/src/v2/manage/GroupDetail.tsx` (number field)
- Modify: `frontend/src/v2/manage/ScreenTimePane.tsx` (one helper line)
- Test: the existing `GroupDetail` and `ScreenTimePane` test files (find them with `grep -rl "GroupDetail\|ScreenTimePane" src --include=*.test.tsx`)

**Copy (exact):**
- Field label: "Screen time price". Placeholder: `Family price (${familyPrice})`. Helper: "Points per 15 minutes. Leave empty to use the family price."
- ScreenTimePane line under the price: "Groups can have their own price." with the link text "Set group prices", which goes to the devices/groups page route used elsewhere in `manage/`.

- [ ] **Step 1: Failing jest tests:**
  - GroupDetail: the field renders with the placeholder "Family price (20)". Typing 40 and saving sends `screen_price: 40`. Clearing it sends `screen_price: null`.
  - ScreenTimePane: the text "Groups can have their own price." is shown.
- [ ] **Step 2:** Run `cd frontend && npx jest <files>` and expect FAIL.
- [ ] **Step 3:** Implement the changes. Use the existing number-input pattern from `ScreenTimePane.tsx` (the family price field) for the input, validation 1–1000, and error display.
- [ ] **Step 4:** Run jest, `npx tsc --noEmit` and `npx eslint src/v2/manage` and expect all clean.
- [ ] **Step 5:** Take screenshots of GroupDetail and ScreenTimePane in light and dark, on phone (390×844) and desktop (1440×900). Use the screenshot method from the earlier feature branches: `scripts/` or the Playwright helper in `frontend/`. Save them to the workspace for the visual gate.
- [ ] **Step 6:** Commit `feat(ui): group screen time price`.

### Task 5: Kid "What for?" picker

**Files:**
- Modify: `frontend/src/v2/rewardTypes.ts` (`KidScreen.options: ScreenOption[]`, `ScreenOption {group_id: number|null; name: string; icon: string; price: number}`)
- Modify: `frontend/src/v2/kid/RewardsSection.tsx`
- Modify: `frontend/src/v2/hooks/useKidRewards.ts` (the redeem payload accepts `group_id`)
- Test: the existing RewardsSection test file

**Behaviour:**
- With `options.length > 1`, show a "What for?" chip group above the minutes picker. Each chip shows an `Icon`, the name, and `{price} pts / 15 min`. Use a `role="radiogroup"` with `role="radio"` chips. The default selection is the first option (All).
- `cost = mins / 15 * selected.price`. Redeem sends `group_id: selected.group_id`.
- With one option, show no chips. Behaviour and markup stay as today, except that the price comes from `options[0].price`.

- [ ] **Step 1: Failing tests:**
  - With 3 options, the chips are rendered. Clicking "Consoles" with 30 min selected shows a cost of 80, and the redeem payload is `{kind: "screen_time", minutes: 30, group_id: <id>}`.
  - With 1 option, there is no radiogroup.
- [ ] **Step 2:** Run jest and expect FAIL.
- [ ] **Step 3:** Implement the picker. If the file goes over 200 lines, move the chips into `kid/ScreenFor.tsx`.
- [ ] **Step 4:** Run jest, tsc and eslint and expect all clean.
- [ ] **Step 5:** Take screenshots of the kid rewards page in light and dark, phone and desktop, with 3 options.
- [ ] **Step 6:** Commit `feat(kid): pick what screen time is for`.

### Task 6: Docs, site, version

**Files:**
- Modify: `docs/guide/04-everyday-use.md` (new section "Screen time prices for groups")
- Modify: `docs/guide/06-troubleshooting.md` (entry: "Why can't I price YouTube differently from homework on the same tablet?" The answer: the box sees devices, not apps, so put the device in a group or use a separate device.)
- Modify: `docs/guide/05-for-kids.md` (one line on picking what the time is for)
- Modify: `docs/blocker.md` (one line pointing to that troubleshooting entry, in "What it can't see")
- Modify: `site/index.html` feature list (one line: "Price screen time per device group: consoles can cost more, speakers can stay free.")
- Modify: `backend/app/__init__.py`, `backend/tests/test_health.py`, `frontend/package.json`, `frontend/package-lock.json` (2.2.0 → 2.3.0)
- Add: guide screenshots in `docs/guide/img/` (group price, kid picker), reused from Tasks 4 and 5.
- Modify: the spec's "As built" section.

- [ ] **Step 1:** Write the docs and bump the version.
- [ ] **Step 2:** Run `python scripts/build_site.py && node site/check.mjs` and expect it to pass. Run `pytest tests/test_health.py` and expect PASS.
- [ ] **Step 3:** Commit `docs: per-group screen time pricing; 2.3.0`.
