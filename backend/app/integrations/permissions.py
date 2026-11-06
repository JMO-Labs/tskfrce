"""Permission vocabulary and the per-action grant check (DB-free)."""

from dataclasses import dataclass
from typing import Literal

from app.integrations.protocol import Action

FIXED_LINE = "Its own settings, and nothing else unless listed below."


@dataclass(frozen=True)
class Perm:
    text: str
    high_risk: bool = False


PERMS: dict[str, Perm] = {
    "kid.name": Perm("Your linked kids' first names"),
    "events.chore_completed": Perm("When linked chores are done"),
    "events.request_created": Perm("When linked kids ask for a reward or check off a linked chore"),
    "events.reward_redeemed": Perm("When linked kids get a reward (name and cost)"),
    "chores.complete": Perm("Mark linked chores done (it sees their names)"),
    "rewards.manage": Perm("Add, change and remove its own rewards"),
    "messages.parents": Perm("Send you messages"),
    "requests.decide": Perm("Approve or deny reward requests and chore check-offs", True),
    "widgets.parent": Perm("Show cards on your screens"),
    "widgets.kid": Perm("Show cards on your kids' screens", True),
}

ACTION_PERM = {
    "chore.complete": "chores.complete",
    "reward.upsert": "rewards.manage",
    "reward.remove": "rewards.manage",
    "message.parents": "messages.parents",
    "request.decide": "requests.decide",
}

Origin = Literal["service", "parent_button", "kid_button", "local"]
KID_BUTTON_ACTIONS = frozenset({"chore.complete", "message.parents"})


@dataclass(frozen=True)
class Grant:
    install_id: int
    name: str
    permissions: frozenset[str]
    kid_ids: frozenset[int]
    chore_ids: frozenset[int]
    kid_widget_ids: frozenset[int]
    trusted: bool
    active: bool


class Denied(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def check_action(
    grant: Grant, action: Action, origin: Origin = "service", actor_kid_id: int | None = None
) -> bool:
    """Raise Denied, or return True when the action must wait for parent approval."""
    if not grant.active:
        raise Denied("integration is paused")
    if ACTION_PERM[action.type] not in grant.permissions:
        raise Denied("not allowed")
    is_chore = action.type == "chore.complete"
    if is_chore and action.kid_id not in grant.kid_ids:
        raise Denied("kid not linked")
    if is_chore and action.chore_id not in grant.chore_ids:
        raise Denied("chore not linked")
    if origin == "kid_button":
        if action.type not in KID_BUTTON_ACTIONS:
            raise Denied("kids can only ask")
        if is_chore and action.kid_id != actor_kid_id:
            raise Denied("kid not linked")
    return is_chore and (not grant.trusted or origin == "kid_button")
