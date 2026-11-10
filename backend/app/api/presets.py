"""Parent API: setup presets (catalog, preview, apply)."""

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_parent
from app.models.family import get_family
from app.models.user import User
from app.services import preset_state, presets

router = APIRouter(
    prefix="/api/v1/presets", tags=["presets"], dependencies=[Depends(require_parent)]
)

Style = Literal["relaxed", "balanced", "strict"]
Key = Literal["chores", "screen", "bedtime", "lock", "trust", "photo", "banked"]


class PresetBody(BaseModel):
    style: Style | None = None
    kids: dict[int, Style | None] = {}
    skip: list[Key] = []


@router.get("")
def catalog(db: Session = Depends(get_db)):
    return {
        "style": get_family(db).preset_style,
        "kids": [
            {
                "id": k.id,
                "name": k.full_name or k.username,
                "age_group": k.age_group,
                "style": k.preset_style,
            }
            for k in preset_state.kids(db)
        ],
        **presets.catalog(),
    }


@router.post("/preview")
def preview(
    body: PresetBody, db: Session = Depends(get_db), parent: User = Depends(require_parent)
):
    return preset_state.run(db, parent, body.model_dump(), False)


@router.post("/apply")
def apply(body: PresetBody, db: Session = Depends(get_db), parent: User = Depends(require_parent)):
    return preset_state.run(db, parent, body.model_dump(), True)
