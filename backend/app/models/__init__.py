"""
Database models for t@sk4ce.

This package contains all SQLAlchemy models for the application.
"""

from .badge import BadgeAward, CustomBadge
from .chat import ChatPhoto, MessageReaction, Thread, ThreadMessage, ThreadRead
from .chore_extra import ChorePhoto
from .chore_type import ChoreType, ChoreTypeNote
from .chores import Chore, ChoreAssignment, ChoreRun, ChoreSeen, ChoreStep, RunStepTick
from .device_activity import DeviceEvent, DevicePresence
from .family import FamilySettings, get_family
from .flair import KidFlair
from .happy_hour import HappyHour
from .hours import HourRule, HourRuleTarget, HourRuleTime
from .inbox import Notification
from .integration import (
    IntegrationAction,
    IntegrationChore,
    IntegrationEvent,
    IntegrationInstall,
    IntegrationKid,
)
from .kid_device import KidDevice, KidEnrollToken
from .lock import Device, DeviceGroup, DeviceHintRejection, Override, Vlan
from .notify import NotifyHeld, NotifyPlace
from .password_reset import PasswordReset
from .points import Points, PointsType
from .reward import Redemption, Reward
from .screen_bank import ScreenBank
from .screen_time import ScreenTimeLimit
from .tips import DismissedTip
from .user import PendingInvite, UsedInvite, User

__all__ = [
    "BadgeAward",
    "KidFlair",
    "HappyHour",
    "CustomBadge",
    "ChatPhoto",
    "MessageReaction",
    "Thread",
    "ThreadMessage",
    "ThreadRead",
    "ChorePhoto",
    "Chore",
    "ChoreType",
    "ChoreTypeNote",
    "ChoreStep",
    "ChoreAssignment",
    "ChoreRun",
    "RunStepTick",
    "ChoreSeen",
    "PendingInvite",
    "UsedInvite",
    "User",
    "FamilySettings",
    "get_family",
    "PasswordReset",
    "KidEnrollToken",
    "KidDevice",
    "Points",
    "PointsType",
    "Device",
    "Vlan",
    "DeviceHintRejection",
    "DeviceGroup",
    "HourRule",
    "HourRuleTime",
    "HourRuleTarget",
    "DeviceEvent",
    "DevicePresence",
    "Override",
    "Notification",
    "IntegrationInstall",
    "IntegrationKid",
    "IntegrationChore",
    "IntegrationAction",
    "IntegrationEvent",
    "NotifyPlace",
    "NotifyHeld",
    "Reward",
    "Redemption",
    "ScreenBank",
    "ScreenTimeLimit",
    "DismissedTip",
]
