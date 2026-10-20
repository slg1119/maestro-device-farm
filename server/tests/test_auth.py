import pytest

from farm.auth import TokenExistsError, create_token, hash_token, list_tokens, revoke_token, verify_token


def test_create_and_verify(db):
    with db.session() as s:
        token = create_token(s, "ci")
    assert token.startswith("farm_") and len(token) > 30
    with db.session() as s:
        row = verify_token(s, token)
        assert row is not None and row.name == "ci"
        assert row.token_hash == hash_token(token)
        assert row.last_used_at is not None
        assert verify_token(s, "farm_wrong") is None


def test_duplicate_name_rejected(db):
    with db.session() as s:
        create_token(s, "ci")
    with pytest.raises(TokenExistsError), db.session() as s:
        create_token(s, "ci")


def test_list_and_revoke(db):
    with db.session() as s:
        token = create_token(s, "ci")
        create_token(s, "dashboard")
    with db.session() as s:
        assert [t.name for t in list_tokens(s)] == ["ci", "dashboard"]
        assert revoke_token(s, "ci") is True
        assert revoke_token(s, "ci") is False
    with db.session() as s:
        assert verify_token(s, token) is None
