import pytest
from app.models.integration import IntegrationAction, IntegrationInstall
from sqlalchemy.exc import IntegrityError


def test_status_check(db):
    db.add(
        IntegrationInstall(
            public_id="a" * 32,
            source="catalog",
            name="X",
            icon="extension",
            permissions="[]",
            status="bogus",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_idempotency_key_unique_per_install(db, install):
    db.add_all(
        [
            IntegrationAction(
                install_id=install.id,
                kind="chore.complete",
                idempotency_key="k1",
                result="applied",
            )
            for _ in range(2)
        ]
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_fixtures(db, install, run_today, other_kid, kid):
    assert [k.kid_id for k in install.kids] == [kid.id]
    assert run_today.status == "todo" and run_today.kid_id == kid.id
    assert other_kid.id != kid.id
