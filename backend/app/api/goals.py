"""Parent API: goals."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/goals", tags=["goals"])
