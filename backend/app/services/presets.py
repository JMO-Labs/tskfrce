"""Setup presets: style x age plan table. Plain data plus three small functions."""

STYLES = ("relaxed", "balanced", "strict")
AGES = ("little", "kid", "teen")

# Kid-age baseline per style.
BASE = {
    "relaxed": {
        "chores": 2,
        "screen": 180,
        "bedtime": "21:00",
        "lock": False,
        "trust": True,
        "photo": False,
    },
    "balanced": {
        "chores": 3,
        "screen": 120,
        "bedtime": "20:30",
        "lock": True,
        "trust": False,
        "photo": False,
    },
    "strict": {
        "chores": 4,
        "screen": 60,
        "bedtime": "20:00",
        "lock": True,
        "trust": False,
        "photo": True,
    },
}

# Age adjustments (bedtime in minutes).
OFFSET = {
    "little": {"chores": -1, "screen": -30, "bedtime": -60},
    "kid": {"chores": 0, "screen": 0, "bedtime": 0},
    "teen": {"chores": 0, "screen": 30, "bedtime": 60},
}

WEEKEND_EXTRA = 90

PICKS = {
    "little": ["Make bed", "Feed the pet", "Tidy room", "Water plants"],
    "kid": ["Make bed", "Feed the pet", "Tidy room", "Homework"],
    "teen": ["Unload dishwasher", "Take out trash", "Homework", "Tidy room", "Practice instrument"],
}

# title -> (chore type name, points, weekdays Mon=0 or None for every day).
# Keep in sync with frontend/src/v2/setup/starterChores.ts (a test checks this).
STARTERS = {
    "Make bed": ("Personal", 10, None),
    "Unload dishwasher": ("Kitchen", 20, None),
    "Homework": ("Schoolwork", 30, [0, 1, 2, 3, 4]),
    "Feed the pet": ("Pets", 10, None),
    "Tidy room": ("Cleaning", 25, None),
    "Take out trash": ("Kitchen", 15, None),
    "Water plants": ("Outdoor", 10, None),
    "Practice instrument": ("Practice", 15, None),
}

FAMILY = {
    "relaxed": {"banked": True, "goals": True, "penalties": False},
    "balanced": {"banked": True, "goals": True, "penalties": False},
    "strict": {"banked": False, "goals": True, "penalties": True},
}


def _hhmm(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def kid_plan(age: str, style: str) -> dict:
    base, off = BASE[style], OFFSET[age]
    h, m = base["bedtime"].split(":")
    bed = int(h) * 60 + int(m) + off["bedtime"]
    return {
        "chores": PICKS[age][: max(1, base["chores"] + off["chores"])],
        "screen": max(30, base["screen"] + off["screen"]),
        "bedtime": _hhmm(bed),
        "weekend": _hhmm(bed + WEEKEND_EXTRA),
        "lock": base["lock"],
        "trust": base["trust"],
        "photo": base["photo"],
    }


def family_plan(style: str) -> dict:
    return dict(FAMILY[style])


def catalog() -> dict:
    return {
        "plans": {a: {s: kid_plan(a, s) for s in STYLES} for a in AGES},
        "family": {s: family_plan(s) for s in STYLES},
    }
