"""Age groups: bands (little 5-8, kid 9-12, teen 13+) and when a kid is due to move up."""

from datetime import date, datetime, timedelta

from app.models.user import User

ORDER = ("little", "kid", "teen")
STARTS = {"kid": 9, "teen": 13}  # age at which each group begins
WINDOW_DAYS = 30
INFER_YEARS = 4  # little/kid without a birth date: this long in the group


def next_group(group: str) -> str | None:
    i = ORDER.index(group)
    return ORDER[i + 1] if i + 1 < len(ORDER) else None


def band_for(born_year: int, born_month: int, on: date) -> str:
    """Group for a kid on `on`; the birthday is taken as the 1st of the birth month."""
    age = on.year - born_year - (1 if on.month < born_month else 0)
    return "teen" if age >= STARTS["teen"] else "kid" if age >= STARTS["kid"] else "little"


def age_up_target(kid: User, now: datetime) -> str | None:
    """The group to suggest moving to, or None. Teens never age up."""
    nxt = next_group(kid.age_group)
    if nxt is None:
        return None
    if kid.birth_year is not None and kid.birth_month is not None:
        soon = band_for(kid.birth_year, kid.birth_month, (now + timedelta(days=WINDOW_DAYS)).date())
        return nxt if ORDER.index(soon) > ORDER.index(kid.age_group) else None
    since = kid.age_group_set_at or kid.created_at
    if since is not None and now - since > timedelta(days=365 * INFER_YEARS):
        return nxt
    return None
