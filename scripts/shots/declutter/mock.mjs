// Busy-family mock API for the declutter audit and screenshot steps. Inbox kinds match the backend (NEEDS_KINDS in bellRules.ts).
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
export const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', exp: Math.floor(Date.now() / 1000) + 36000, type: 'access' })}.sig`
export const user = { user_id: 1, username: 'dad', email: 'd@x.io', full_name: 'Dad', role: 'parent', is_active: true, is_superuser: false }
const iso = (m) => new Date(Date.now() - m * 60000).toISOString()
const fut = (m) => new Date(Date.now() + m * 60000).toISOString()
const dstr = (back) => { const d = new Date(Date.now() - back * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// a QR-looking placeholder (finder squares + seeded noise) so the modal shot shows a realistic code
const qrSvg = () => { let r = 7, c = ''; const f = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#000"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#000"/>`; for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) { r = (r * 73 + 11) % 257; if (r % 2 && !((x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16))) c += `<rect x="${x}" y="${y}" width="1" height="1"/>` } return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 27 27" width="168" height="168"><rect x="-1" y="-1" width="27" height="27" fill="#fff"/>${c}${f(0, 0)}${f(18, 0)}${f(0, 18)}</svg>` }
export const fam = { name: 'Rivera', timezone: 'UTC', reset_time: '06:00', new_devices_blocked: true, points_unlock_early: true, early_bonus_cap: 5, screen_time_price: 20, gifs_enabled: true, gif_rating: 'g', accent: 'neon', giphy_key_set: true, ntfy_upstream_relay: false, chores_lock: true, quick_replies: ['Great job!', 'Please redo', 'Photo please'], hh_default_mult_x10: 20, hh_default_minutes: 60, hh_weekly_surprise: true, hh_auto_boost: true, streak_freeze: true, bedtime_auto: true, bedtime_auto_at: '21:00', recap_weekly: true }
const KIDS = [[3, 'Maya', 'teen', true, 1, 18, 30], [4, 'Leo', 'kid', false, 0, 0, 10], [5, 'Ava', 'little', true, 0, 6, 10]]
export const kids = KIDS.map(([id, n, ag, tm, tl, tc, tg]) => ({ id, full_name: n, avatar: null, username: n.toLowerCase(), has_pin: id !== 5, age_group: ag, celebrate: 'full', trust_mode: tm, trust_level: tl, trust_clean: tc, trust_goal: tg }))
const T = (id, name, glyph) => ({ id, name, glyph })
const types = [T(1, 'Cleaning', 'cleaning_services'), T(2, 'Pets', 'pets'), T(3, 'School', 'school'), T(4, 'Kitchen', 'kitchen'), T(5, 'Laundry', 'local_laundry_service')]
const ch = (id, title, state, ty, extra = {}) => ({ id, title, points: 20, state, day: dstr(0), type: types[ty], mode: 'each', ...extra })
const kidChores = {
  3: [ch(101, 'Clean room', 'done', 0, { approved_via: 'trust', done_at: iso(30), earned_pts: 20 }), ch(102, 'Feed the dog', 'done', 1, { approved_via: 'parent', done_at: iso(200) }), ch(103, 'Make bed', 'needs_you', 0, { done_at: iso(60), spot_check: true }), ch(104, 'Dishes', 'todo', 3, { due_time: '19:00', due_at: fut(240) }), ch(105, 'Homework', 'todo', 2, { subtasks_done: 1, subtasks_total: 3, messages: 2 }), ch(106, 'Fold laundry', 'skipped', 4)],
  4: [ch(201, 'Take out bins', 'needs_you', 0, { done_at: iso(90), photos: 2 }), ch(202, 'Homework', 'needs_you', 2, { done_at: iso(20), attempt: 2, sent_back: true }), ch(203, 'Feed the cat', 'done', 1, { approved_via: 'parent', done_at: iso(300) }), ch(204, 'Set the table', 'todo', 3, { due_time: '18:00', due_at: fut(120) }), ch(205, 'Tidy toys', 'todo', 0)],
  5: [ch(301, 'Brush teeth', 'done', 0, { approved_via: 'trust', done_at: iso(400) }), ch(302, 'Put shoes away', 'todo', 0), ch(303, 'Water plants', 'todo', 0, { due_time: '17:00', due_at: fut(60) }), ch(304, 'Help with dishes', 'needs_you', 3, { done_at: iso(15) })],
}
const tdev = (id, name, online) => ({ id, name, vendor: 'Apple', online })
const needs = [
  { type: 'chore', id: 103, kid_id: 3, kid_name: 'Maya', title: 'Make bed', attempt: 1, submitted_at: iso(60), day: dstr(0), spot_check: true, photos: [], subtasks_total: 0, subtasks_done: 0 },
  { type: 'chore', id: 201, kid_id: 4, kid_name: 'Leo', title: 'Take out bins', attempt: 1, submitted_at: iso(90), day: dstr(0), photos: [], subtasks_total: 0, subtasks_done: 0 },
  { type: 'redo', id: 202, kid_id: 4, kid_name: 'Leo', title: 'Homework', attempt: 2, submitted_at: iso(20), day: dstr(0), photos: [], subtasks_total: 3, subtasks_done: 3 },
  { type: 'chore', id: 304, kid_id: 5, kid_name: 'Ava', title: 'Help with dishes', attempt: 1, submitted_at: iso(15), day: dstr(0), photos: [], subtasks_total: 0, subtasks_done: 0 },
  { type: 'screen_time', id: 501, kid_id: 3, kid_name: 'Maya', title: '30 min screen time', device_name: "Maya's iPad", cost: 60, kid_balance: 240, submitted_at: iso(5) },
  { type: 'reward', id: 502, kid_id: 4, kid_name: 'Leo', title: 'Pick dinner', cost: 150, kid_balance: 190, submitted_at: iso(45) },
  { type: 'goal_full', id: 2, kid_id: 5, kid_name: 'Ava', title: 'Pizza + movie night', cost: 300, submitted_at: iso(30) },
  { type: 'goal_suggested', id: 7, kid_id: 4, kid_name: 'Leo', title: 'Skateboard', cost: null, submitted_at: iso(50) },
  { type: 'note', id: 503, kid_id: 5, kid_name: 'Ava', title: 'Water plants', note: "I can't reach the top shelf", submitted_at: iso(10) },
]
export const today = () => ({ day: dstr(0), pending_approvals: 7, new_devices: [devices[8]], try_trust_kid: 4, waiting_at_reset_days: 0, needs_you: needs,
  kids: [
    { id: 3, name: 'Maya', avatar: null, online_all: true, done: 2, total: 6, needs_you_count: 2, points: 240, earned: 40, next_reward: 60, locks_at: fut(300), last_active: iso(3), chores: kidChores[3], devices: [tdev(11, "Maya's iPad", true), tdev(12, "Maya's iPhone", true)], progress: { level: 7, title: 'Go-getter', xp: 640, floor: 600, next: 800, streak: 16, freezes_held: 1 } },
    { id: 4, name: 'Leo', avatar: null, online_all: false, done: 1, total: 5, needs_you_count: 3, points: 190, earned: 20, next_reward: 150, locks_at: fut(120), last_active: iso(25), chores: kidChores[4], devices: [tdev(13, 'Leo Switch', false), tdev(14, "Leo's Chromebook", true)], progress: { level: 4, title: 'Helper', xp: 310, floor: 300, next: 400, streak: 3, freezes_held: 0 } },
    { id: 5, name: 'Ava', avatar: null, online_all: false, quiet: true, done: 1, total: 4, needs_you_count: 2, points: 60, earned: 10, next_reward: 40, chores: kidChores[5], devices: [tdev(15, 'Kids Fire tablet', false)], progress: { level: 2, title: 'Starter', xp: 120, floor: 100, next: 200, streak: 5, freezes_held: 2 } }] })
const dv = (id, name, owner, extra = {}) => ({ id, name, mac: `aa:bb:cc:00:00:${id}`, vendor: 'Apple', status: owner ? 'assigned' : 'unassigned', owner_ids: owner ? [owner] : [], group_ids: [], online: true, override: null, last_seen: iso(1), seen_now: true, resisting: false, exempt: false, reason: null, chores_done: 2, chores_total: 6, locks_at: fut(300), alerts: 0, ip: `192.168.1.${id}`, hostname: name.replace(/\W/g, '-'), first_seen: iso(90000), model: 'iPad Air', ...extra })
export const devices = [
  dv(11, "Maya's iPad", 3, { group_ids: [1] }), dv(12, "Maya's iPhone", 3, { group_ids: [2], alerts: 2, resisting: true, resisting_since: iso(40) }),
  dv(13, 'Leo Switch', 4, { vendor: 'Nintendo', online: false, seen_now: false, last_seen: iso(200), group_ids: [3], override: { action: 'lock', expires_at: fut(30) } }),
  dv(14, "Leo's Chromebook", 4, { vendor: 'Google', chores_done: 1, chores_total: 5 }), dv(15, 'Kids Fire tablet', 5, { vendor: 'Amazon', online: false, seen_now: false, last_seen: iso(600), group_ids: [1] }),
  dv(16, 'Living room TV', null, { status: 'guest', vendor: 'Samsung', exempt: true, reason: 'Shared TV' }), dv(17, "Dad's laptop", null, { vendor: 'Dell' }),
  dv(18, 'Xbox', null, { status: 'guest', vendor: 'Microsoft', group_ids: [3], owner_ids: [3, 4] }), dv(19, 'Unknown phone', null, { vendor: null, random_mac: true, hint_of_id: 12, hint_reason: 'model', first_seen: iso(30), blocked_since: iso(30) })]
const groups = [{ id: 1, name: 'Tablets', device_ids: [11, 15], icon: 'tablet', owner_ids: [3, 5], chore_lock: true, screen_price: 20 }, { id: 2, name: 'Phones', device_ids: [12], icon: 'smartphone', chore_lock: true, screen_price: 30 }, { id: 3, name: 'Consoles', device_ids: [13, 18], icon: 'sports_esports', chore_lock: true, screen_price: 40 }]
const asg = (id, kidIds, type = 'daily', days = []) => ({ id, chore_id: id, kid_ids: kidIds, mode: 'each', repeat: { type, days }, on_date: null, due_time: id % 3 ? null : '18:00', active: true })
const lib = [['Clean room', 0, [3, 4]], ['Feed the dog', 1, [3]], ['Make bed', 0, [3, 4, 5]], ['Dishes', 3, [3, 4]], ['Homework', 2, [3, 4]], ['Fold laundry', 4, [3]], ['Take out bins', 0, [4], 'weekly', [1, 4]], ['Feed the cat', 1, [4]], ['Set the table', 3, [4, 5]], ['Tidy toys', 0, [4, 5]], ['Brush teeth', 0, [5]], ['Water plants', 0, [5], 'weekly', [2, 6]]]
export const library = lib.map(([title, ty, k, rt, days], i) => ({ id: 400 + i, title, points: [20, 15, 10, 25, 30, 20][i % 6], needs_photo: i % 4 === 1, type_id: ty + 1, always_check: i === 4, steps: i === 4 ? [{ id: 1, title: 'Math sheet', due_time: null, after_previous: false }, { id: 2, title: 'Reading 20 min', due_time: null, after_previous: true }, { id: 3, title: 'Pack bag', due_time: '20:00', after_previous: true }] : [], assignments: [asg(400 + i, k, rt, days)] }))
const ib = (id, kind, title, body, m, x = {}) => ({ id, kind, title, body, created_at: iso(m), read: id > 905, run_id: null, redemption_id: null, device_id: null, thread_id: null, points: null, kid_id: 3, kid_name: 'Maya', glyph: null, pending: false, ...x })
const inbox = { unread: 5, has_more: false, items: [ib(901, 'chore_submitted', 'Maya finished Make bed', 'Spot check', 20, { pending: true, run_id: 103, points: 10 }), ib(902, 'chore_submitted', 'Leo finished Feed fish', '2 photos', 25, { kid_id: 4, kid_name: 'Leo', pending: true, run_id: 104, points: 15 }), ib(903, 'redemption_request', 'Maya wants 30 min screen time', "Maya's iPad · 60 pts", 30, { pending: true, redemption_id: 501 }), ib(904, 'chore_submitted', 'Ava finished Brush teeth', null, 40, { kid_id: 5, kid_name: 'Ava', pending: true, run_id: 105, points: 10 }), ib(905, 'device_bypass', "Maya's iPhone tried a VPN", 'Blocked 2 times', 45, { device_id: 12 }), ib(906, 'boost', 'Happy Hour ×2 started', 'Until 8:45 PM', 50, { kid_id: null, kid_name: null }), ib(907, 'level_up', 'Leo reached Level 4', null, 1500, { kid_id: 4, kid_name: 'Leo' }), ib(908, 'chore_submitted', 'Leo finished Homework', null, 1520, { kid_id: 4, kid_name: 'Leo', points: 30 }), ib(909, 'badge_earned', 'Maya earned Kindness (Copper)', null, 2900), ib(910, 'box_offline', 'Home box went offline', 'Back after 12 min', 4400, { kid_id: null, kid_name: null }), ib(911, 'new_device', 'New device on the Wi-Fi', 'Samsung', 5800, { kid_id: null, kid_name: null, device_id: 19, pending: true })] }
const th = (id, kind, kid, title, unread, text, m, x = {}) => ({ id, kind, task_id: kind === 'chore' ? id : null, kid_id: kid, kid_ids: kid ? [kid] : [3, 4, 5], title, unread, last_message_at: iso(m), last_author: 'Maya', last_text: text, note: false, glyph: kind === 'chore' ? 'cleaning_services' : null, ...x })
const threads = { total: 7, gifs_enabled: true, threads: [th(1, 'family', null, 'Family', 2, 'Pizza tonight?', 4), th(3, 'private', 3, 'Maya', 1, 'can I have more time', 6), th(4, 'private', 4, 'Leo', 0, 'ok', 120), th(5, 'private', 5, 'Ava', 1, "I can't reach the top shelf", 10), th(202, 'chore', 4, 'Homework', 1, 'Redone, check pls', 20, { last_author: 'Leo' }), th(201, 'chore', 4, 'Take out bins', 0, 'photo', 90), th(105, 'chore', 3, 'Homework', 0, 'Need help with math', 300, { note: true })] }
const msg = (id, a, name, body, m) => ({ id, author_id: a, author_name: name, kind: 'user', body, photo_url: null, created_at: iso(m), reactions: [] })
const thread = { id: 1, kind: 'family', title: 'Family', has_more: false, typing: [], members: [{ id: 1, name: 'Dad' }, { id: 3, name: 'Maya' }], messages: [msg(1, 3, 'Maya', 'Can we get pizza tonight?', 30), msg(2, 1, 'Dad', 'If chores are done!', 25), msg(3, 4, 'Leo', 'Bins are out', 20), msg(4, 5, 'Ava', 'Pizza tonight?', 4)] }
const rewards = [{ id: 1, name: 'Pick dinner', price: 150, icon: 'restaurant', visible: true, needs_approval: true }, { id: 2, name: 'Stay up 30 min', price: 100, icon: 'bedtime', visible: true, needs_approval: true }, { id: 3, name: 'Movie night pick', price: 200, icon: 'movie', visible: true, needs_approval: false }, { id: 4, name: '$5 allowance', price: 500, icon: 'payments', visible: true, needs_approval: true }, { id: 5, name: 'Skip a chore', price: 120, icon: 'event_busy', visible: false, needs_approval: true }]
const pend = [{ id: 501, kid_id: 3, kid_name: 'Maya', kind: 'screen_time', name: 'Screen time', icon: null, minutes: 30, device_name: "Maya's iPad", cost: 60, created_at: iso(5), kid_balance: 240, kid_balance_after: 180 }, { id: 502, kid_id: 4, kid_name: 'Leo', kind: 'reward', name: 'Pick dinner', icon: 'restaurant', minutes: null, cost: 150, created_at: iso(45), kid_balance: 190, kid_balance_after: 40 }]
const HR = [['Maya', 'st', '30 min screen time', 60, 30, 0, 1, 'Dad', null], ['Leo', 'rw', 'Pizza night pick', 80, 0, 5, 'auto', null, null], ['Maya', 'rw', 'Movie night', 120, 0, 1440, 1, 'Mom', 'Friday only'], ['Leo', 'st', '30 min screen time', 60, 30, 1500, 0, 'Dad', 'After homework'], ['Ava', 'rw', 'Sticker pack', 30, 0, 3000, 1, 'Dad', null], ['Maya', 'st', '45 min screen time', 90, 45, 4400, 1, 'Mom', null], ['Leo', 'st', '60 min screen time', 120, 60, 5800, 'auto', null, null], ['Ava', 'rw', 'Ice cream trip', 100, 0, 11000, 1, 'Mom', null], ['Maya', 'rw', 'New headphones', 300, 0, 14000, 1, 'Dad', 'Birthday saving'], ['Leo', 'rw', 'Lego set', 250, 0, 17000, 0, 'Mom', 'Save up a bit more'], ['Ava', 'st', '20 min screen time', 40, 20, 19000, 1, 'Dad', null], ['Maya', 'st', '30 min screen time', 60, 30, 20000, 'auto', null, null]]
const histFor = (u) => {
  const kid = u.searchParams.get('kid_id'), kind = u.searchParams.get('kind')
  const rows = HR.map((r, i) => ({ id: 600 + i, kid_id: KIDS.find((x) => x[1] === r[0])[0], kid_name: r[0], kind: r[1] === 'st' ? 'screen_time' : 'reward', name: r[2], minutes: r[4] || null, cost: r[3], status: r[6] === 0 ? 'denied' : 'approved', auto: r[6] === 'auto', decided_by_name: r[7], note: r[8], created_at: iso(r[5] + 5), decided_at: iso(r[5]) }))
    .filter((r) => (!kid || String(r.kid_id) === kid) && (!kind || r.kind === kind))
  const ok = rows.filter((r) => r.status !== 'denied')
  return { totals: { spent: ok.reduce((a, r) => a + r.cost, 0), screen_minutes: ok.reduce((a, r) => a + (r.minutes ?? 0), 0), approved: ok.length, declined: rows.length - ok.length }, rows }
}
const screen = { enabled: true, price: 20, max_minutes_per_day: 120, auto_approve: false, only_in_allowed_hours: true, group_pricing: true, rollover: true, bank_cap: 240, reset_time: '06:00', avg_chore_points: 20, kids: kids.map((k, i) => ({ kid_id: k.id, name: k.full_name, balance: [240, 190, 60][i], bought_today: [30, 0, 15][i], max_minutes: 120, limit: i === 2 ? { max_minutes: 60, min_points: 20 } : null, saved: [45, 0, 10][i] })) }
const hours = { today: 'school_night', rules: [{ id: 1, name: 'School nights', category: 'school_night', kind: 'allowed', days: '0123', start_date: null, end_date: null, everyone: true, kid_ids: [], group_ids: [], times: [{ start: '16:00', end: '20:00' }] }, { id: 2, name: 'Weekends', category: 'weekend', kind: 'allowed', days: '456', start_date: null, end_date: null, everyone: true, kid_ids: [], group_ids: [], times: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '21:00' }] }, { id: 3, name: 'Homework time', category: 'school_night', kind: 'off', days: '0123', start_date: null, end_date: null, everyone: false, kid_ids: [3, 4], group_ids: [3], times: [{ start: '17:00', end: '18:00' }] }, { id: 4, name: 'Winter break', category: 'holiday', kind: 'free', days: '0123456', start_date: '2026-12-20', end_date: '2027-01-04', everyone: true, kid_ids: [], group_ids: [], times: [{ start: '08:00', end: '21:00' }] }] }
const notify = { quiet_start: '22:00', quiet_end: '07:00', quiet_security: true, app_address: 'https://tasks.rivera.home', app_address_default: 'http://192.168.1.2:3000', events: [['chore_done', 'Chore finished', false], ['redemption', 'Reward request', false], ['bypass', 'Bypass attempt', true], ['new_device', 'New device', true], ['chat', 'Chat message', false]].map(([key, label, security]) => ({ key, label, security })) }
const places = [{ id: 1, name: 'Dad phone (ntfy)', url_mask: 'ntfy://…/rivera', enabled: true, events: ['chore_done', 'bypass', 'new_device'], readable: true }, { id: 2, name: 'Family Discord', url_mask: 'discord://…', enabled: false, events: ['redemption'], readable: true }]
const parents = [{ id: 1, username: 'dad', full_name: 'Dad', is_me: true, is_owner: true, last_active_at: iso(1) }, { id: 2, username: 'mom', full_name: 'Mom', is_me: false, is_owner: false, last_active_at: iso(300) }]
const fl = (kind, action, x) => ({ kind, text: 'x', action, ...x })
const recap = { week_start: '2026-10-26', week_end: '2026-11-01', prev: '2026-10-19', next: null, family_line: 'Best week in a month.', all_good: false, kids: [
  { id: 4, name: 'Leo', flags: [fl('catches', 'trust', { count: 2 }), fl('dropping', 'happy_hour', { now: 6, was: 11 })], done: 5, done_trend: [11, 10, 11, 7, 5], on_time_pct: 64, on_time_avg: 88, points_earned: 120, points_spent: 60, screen_minutes_bought: 45, streak: 3, enough_history: true },
  { id: 3, name: 'Maya', flags: [fl('streak_ended', 'kid', { count: 21 })], done: 20, done_trend: [12, 13, 12, 12, 20], on_time_pct: 90, on_time_avg: 84, points_earned: 400, points_spent: 150, screen_minutes_bought: 100, streak: 16, enough_history: true },
  { id: 5, name: 'Ava', flags: [], done: 9, done_trend: [6, 7, 8, 8, 9], on_time_pct: 80, on_time_avg: 75, points_earned: 140, points_spent: 40, screen_minutes_bought: 15, streak: 5, enough_history: true }] }
const selfApproved = [{ id: 21, title: 'Clean room', day: dstr(0), approved_at: iso(30), approved_via: 'trust', points: 20, photos: 0 }, { id: 22, title: 'Dishes', day: dstr(1), approved_at: iso(1500), approved_via: 'bedtime', points: 25, photos: 0 }, { id: 23, title: 'Feed the dog', day: dstr(2), approved_at: iso(3000), approved_via: 'trust', points: 15, photos: 1 }, { id: 24, title: 'Make bed', day: dstr(3), approved_at: iso(4400), approved_via: 'trust', points: 10, photos: 0 }]
const points = [[40, 'chore', 'Clean room'], [-60, 'redeem', 'Screen time 30 min'], [20, 'chore', 'Feed the dog'], [10, 'bonus', 'Happy hour bonus'], [-5, 'deduct', 'Late'], [25, 'chore', 'Dishes']].map(([amount, reason, label], i) => ({ id: 700 + i, amount, reason, label, at: iso(300 * (i + 1)) }))
const badgeOv = [['streak', 'Streak', 'local_fire_department'], ['early', 'Early bird', 'wb_sunny'], ['helper', 'Helper', 'volunteer_activism'], ['saver', 'Saver', 'savings']].map(([key, name, icon]) => ({ key, name, description: `${name} badge`, icon, custom: false, tiers: { '3': 1, '4': 2, '5': 0 } }))
const customOv = [[1, 'Kindness', 'Was extra kind', 'favorite', { '3': 1 }], [2, 'Team player', 'Helped a sibling finish', 'diversity_3', { '4': 2 }], [3, 'Brave try', 'Tried something hard', 'rocket_launch', {}]].map(([id, name, description, icon, tiers]) => ({ key: `custom:${id}`, name, description, icon, custom: true, tiers }))
const recentB = [3, 4, 5, 3].map((k, i) => ({ id: 800 + i, kid_id: k, kid_name: KIDS.find((x) => x[0] === k)[1], key: badgeOv[i].key, name: badgeOv[i].name, icon: badgeOv[i].icon, custom: false, tier: 2, tier_name: 'Silver', note: null, reason: null, by_name: null, earned_at: iso(2000 * (i + 1)) }))
const choreTypes = types.map((t, i) => ({ ...t, builtin: i < 3, notes: [{ id: 1, label: 'Need help', glyph: 'help' }], chore_count: 2 + i }))
const actEv = (id, kind, m, x = {}) => ({ id, kind, at: iso(m), last_at: null, count: 1, reason: null, kid_id: 3, kid_name: 'Maya', by_name: null, other_device_id: null, other_device_name: null, minutes: null, detail: null, reviewed: false, ...x })
const activity = { counts: { bypass: 2, locked_tries: 4, outside_hours: 1, wrong_pins: 0 }, events: [actEv(1, 'bypass', 40, { count: 2, detail: 'VPN app' }), actEv(2, 'locked_try', 90, { count: 4 })], history: [actEv(3, 'locked', 600, { by_name: 'Dad' }), actEv(4, 'unlocked', 500), actEv(5, 'sign_in', 1400)], days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: dstr(d), slots: '000000000000000000oooo0000oooo000000llllllll00oooooooo00'.slice(0, 48), online_minutes: 120 + d * 10 })) }
const happy = { active: [{ id: 1, starts_at: iso(15), ends_at: fut(45), multiplier: 2, mult_x10: 20, source: 'parent', kid_ids: null }], recent: [{ id: 2, starts_at: iso(3000), ends_at: iso(2940), multiplier: 1.5, mult_x10: 15, source: 'auto', kid_ids: [4] }], upcoming: [] }
const runDetail = (id) => ({ id, title: 'Homework', points: 30, state: 'needs_you', due_time: null, kid_ids: [4], steps: [{ id: 1, title: 'Math sheet', done: true, due_time: null, due_at: null, after_previous: false, locked: false }, { id: 2, title: 'Reading', done: true, due_time: null, due_at: null, after_previous: true, locked: false }], due_at: null, type: types[2], sent_back: true, note: null, can_move: true, attempt: 2, photos: [] })

// Goals mock. G toggles: party (kid goal party), age (kid age mode), kid (kid id served by /kid/*).
export const G = { party: process.env.PARTY === '1', age: 'kid', kid: 4 }
const gl = (id, name, emoji, o = {}) => ({ id, name, emoji, kind: 'custom', family: false, kid_id: null, kid_name: null, target: 1000, saved: 0, minutes: null, status: 'active', waiting_on: null, mine: 0, siblings: null, created_at: iso(3000), fulfilled_at: null, ...o })
const gSettings = { on: true, suggest: true, withdraw: true, siblings: true, auto: true, auto_pct: 25, max_little: 1, max_kid: 2, max_teen: 3, screen_on: true, screen_price: 200, screen_minutes: 60, jail_on: true, jail_price: 500, screen_ok: true }
const parentGoals = () => ({ settings: gSettings,
  waiting: [gl(2, 'Pizza + movie night', '🍕', { kid_id: 5, kid_name: 'Ava', target: 300, saved: 300, status: 'full', waiting_on: 'Dad' }), gl(7, 'Skateboard', '🛹', { kid_id: 4, kid_name: 'Leo', target: null, status: 'suggested' })],
  family: [gl(3, 'Disney trip', '🏰', { family: true, target: 20000, saved: 6800, siblings: [{ name: 'Maya', amount: 1900 }, { name: 'Leo', amount: 1200 }, { name: 'Ava', amount: 700 }] })],
  kids: [gl(1, 'New bike', '🚲', { kid_id: 3, kid_name: 'Maya', target: 2000, saved: 1240 }), gl(4, 'Game system', '🎮', { kid_id: 4, kid_name: 'Leo', target: 3000, saved: 540 })],
  done: [gl(9, 'Lego set', '🧱', { kid_id: 3, kid_name: 'Maya', target: 800, saved: 800, status: 'fulfilled', fulfilled_at: iso(8000) })] })
const kidGoals = () => ({ on: true, suggest: true, withdraw: true, auto: true, auto_pct: 25, auto_goal_id: 1, can_add: true, free: 300, builtins: [{ kind: 'screen', name: '60 min extra screen time', target: 200, minutes: 60 }],
  goals: [gl(1, 'New bike', '🚲', { kid_id: G.kid, kid_name: 'Me', target: 2000, saved: 1240, mine: 1240 }), gl(2, 'Pizza + movie night', '🍕', { kid_id: G.kid, kid_name: 'Me', target: 300, saved: 300, status: 'full', waiting_on: 'Mom', mine: 300 }), gl(3, 'Disney trip', '🏰', { family: true, target: 20000, saved: 6800, mine: 1900, siblings: null })],
  done: [], party: G.party ? [{ goal_id: 2, name: 'Pizza + movie night', by: 'Mom' }] : [] })
const kidToday = () => ({ locked: false, chores: kidChores[G.kid] ?? [], points_balance: 300, points_held: 0, timezone: 'UTC', age_group: G.age, locks_at: null, celebrate: 'full', happy_hour: null, trust: null,
  progress: { level: 7, title: 'Rising star', xp: 340, floor: 300, next: 500, streak: 4, freezes_held: 1, frozen: [] } })
const kidRewards = () => ({ balance: 300, screen_time_price: 20, screen_time_enabled: true, rewards: rewards.filter((r) => r.visible).map(({ id, name, price, icon, needs_approval }) => ({ id, name, price, icon, needs_approval })), pending: [],
  screen: { options: [{ group_id: null, scope: 'all', name: 'All devices', icon: 'devices', price: 20 }], enabled: true, price: 20, auto: false, only_in_hours: false, max_today: 120, saved: 0, bought_today: 0, left_today: 120, min_points: null, in_hours: true } })

export const S = { setup: { needed: false }, step: null }
// Fake a state per path: FAKE="mode=regex;mode=regex" with mode = hang (never answers: the loading state), err (400 with a message), net (the box is unreachable), empty (an empty list or a family with nothing in it). First matching rule wins.
const FAKE = (process.env.FAKE || '').split(';').filter(Boolean).map((x) => { const [m, ...re] = x.split('='); return [m, new RegExp(re.join('='))] })
const EMPTY_OBJ = (p) => (p === '/today' ? { ...today(), kids: [], needs_you: [], pending_approvals: 0, new_devices: [], try_trust_kid: null }
  : /^\/devices\/\d+\/activity$/.test(p) ? { counts: { bypass: 0, locked_tries: 0, outside_hours: 0, wrong_pins: 0 }, events: [], history: [], days: [] }
  : p === '/notifications' ? { unread: 0, has_more: false, items: [] } : null)
export function route(r, misses) {
  const u = new URL(r.request().url()), p = u.pathname.replace('/api/proxy', '').replace(/\/$/, '') || '/'
  const j = (json) => r.fulfill({ json })
  const fake = r.request().method() === 'GET' ? FAKE.find(([, re]) => re.test(p)) : undefined
  if (fake) {
    if (fake[0] === 'hang') return new Promise(() => {})
    if (fake[0] === 'net') return r.abort('failed')
    if (fake[0] === 'err') return r.fulfill({ status: 400, json: { detail: "Couldn't load this right now." } })
    if (fake[0] === 'empty') return j(EMPTY_OBJ(p) ?? [])
  }
  if (r.request().method() !== 'GET' && p !== '/auth/login') return j({})
  const M = {
    '/auth/login': { ...user, access_token: jwt, refresh_token: jwt, expires_in: 36000 }, '/auth/me': user, '/setup': S.setup, '/setup/step': { step: S.step },
    '/me/tips': { dismissed: [] }, '/kids': kids, '/family': fam, '/today': today(), '/devices': devices, '/groups': groups, '/chores': library, '/chore-types': choreTypes,
    '/notifications': inbox, '/chat/threads': threads, '/rewards': rewards, '/redemptions': pend, '/screen-time': screen, '/hours': hours, '/notify/settings': notify, '/notify/places': places,
    '/parents': parents, '/users/invites': [{ jti: 'abc', username: 'grandma', expires_in: 172800 }], '/happy-hour': happy, '/badges/overview': [...badgeOv, ...customOv], '/badges/recent': recentB, '/custom-badges': customOv.map((o) => ({ id: Number(o.key.slice(7)), name: o.name, icon: o.icon, description: o.description })),
    '/blocker': { online: true, last_seen: iso(0) }, '/leaderboard': { week_start: dstr(5), rows: kids.map((k, i) => ({ kid_id: k.id, name: k.full_name, avatar: null, score: 300 - i * 80, level: 7 - i * 2, title: 'x', rank: i + 1 })) },
    '/profiles': [], '/integrations': [], '/integrations/catalog': [], '/integration-widgets': [], '/integration-local/permissions': [], '/integration-local/keys': [],
  }
  if (p === '/goals') return j(parentGoals())
  if (p === '/goals/settings') return j(gSettings)
  if (p === '/kid/goals') return j(kidGoals())
  if (p === '/kid/today') return j(kidToday())
  if (p === '/kid/rewards') return j(kidRewards())
  if (p === '/kid/whoami') return j({ device: null, kids: kids.map((k) => ({ id: k.id, full_name: k.full_name, avatar: null, has_pin: k.has_pin })) })
  if (p === '/kid/celebrations') return j([])
  if (p in M) return j(M[p])
  if (p.startsWith('/recap')) return j(recap)
  if (p.startsWith('/redemptions/history')) return j(histFor(u))
  if (/^\/kids\/\d+\/self-approved$/.test(p)) return j(selfApproved)
  if (/^\/kids\/\d+\/points$/.test(p)) return j(points)
  if (/^\/kids\/\d+\/phones$/.test(p)) return j([])
  if (/^\/kids\/\d+\/push$/.test(p)) return j({ enabled: true, upstream: false, server: 'https://ntfy.sh', topic: 'rivera-maya', link: 'ntfy://x', qr_svg: qrSvg() })
  if (/^\/devices\/\d+\/activity$/.test(p)) return j(activity)
  if (/^\/devices\/\d+\/network$/.test(p) || p === '/network') return j({ listen_only: false, trunk_detected: true, vlans: [{ vid: 1, name: 'Main', subnet: '192.168.1.0/24', device_count: 8, covered: true, last_seen: iso(0) }] })
  if (/^\/chores\/\d+$/.test(p)) return j(runDetail(+p.split('/')[2]))
  if (/^\/chat\/threads\/(family|private|chore)\//.test(p)) return j(thread)
  if (/^\/screen-time\/limits/.test(p)) return j([])
  misses.add(p)
  return j([])
}
