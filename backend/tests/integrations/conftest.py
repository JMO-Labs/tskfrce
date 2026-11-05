import json
import secrets
from datetime import date

import pytest
from app.core.crypto import seal
from app.models.chores import ChoreRun
from app.models.integration import IntegrationChore, IntegrationInstall, IntegrationKid
from tests.conftest import _make_user
from tests.factories import make_chore
from tests.integrations.int_helpers import DEMO, sign_env


@pytest.fixture
def install(request, db, parent, kid):
    """Active catalog install of DEMO, linked to `kid` and one chore."""
    perms = getattr(request, "param", ["chores.complete"])
    chore, _ = make_chore(db, parent, kids=[kid])
    inst = IntegrationInstall(
        public_id=secrets.token_hex(16),
        source="catalog",
        integration_id="demo",
        name="Demo",
        icon="extension",
        manifest=json.dumps(sign_env(DEMO)),
        permissions=json.dumps(perms),
        secret=seal(secrets.token_urlsafe(32), purpose="integrations"),
        status="active",
        created_by_id=parent.id,
    )
    db.add(inst)
    db.flush()
    db.add_all(
        [
            IntegrationKid(install_id=inst.id, kid_id=kid.id),
            IntegrationChore(install_id=inst.id, chore_id=chore.id),
        ]
    )
    db.commit()
    return inst


@pytest.fixture
def run_today(db, install):
    """Today's todo run of the install's linked chore for `kid`."""
    chore_id = install.chores[0].chore_id
    from app.models.chores import ChoreAssignment

    a = db.query(ChoreAssignment).filter_by(chore_id=chore_id).one()
    run = ChoreRun(assignment=a, day=date.today(), kid_id=install.kids[0].kid_id, status="todo")
    db.add(run)
    db.commit()
    return run


@pytest.fixture
def other_kid(db):
    from app.models.user import UserRole

    return _make_user(db, "sally", UserRole.KID)
