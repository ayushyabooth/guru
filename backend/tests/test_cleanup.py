"""
The boot cleanup (main._cleanup_stale_content) runs on every restart, and every
deploy is a restart. It keeps any article that carries a user's own data (GUR-246):
on 10/7 the first restart in months purged 11,022 articles, with the saves and
notes on them.

    cd backend && venv/bin/python -m pytest -q tests/test_cleanup.py
"""
import os
import uuid
from datetime import datetime, timedelta

_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import main  # noqa: E402
from app.db import database  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.article import Article  # noqa: E402
from app.models.interaction import UserAnnotation, UserSavedArticle  # noqa: E402
from app.models.qa_models import QAExchange  # noqa: E402
from app.models.user import User  # noqa: E402


def test_the_cleanup_keeps_old_articles_a_user_saved_highlighted_or_asked_about(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", Session)  # the cleanup opens its own session

    db = Session()
    user = User(id=uuid.uuid4(), email="reader@example.com", password_hash="x", is_active=True)
    db.add(user)
    old, new = datetime.utcnow() - timedelta(days=45), datetime.utcnow()
    articles = {name: Article(id=uuid.uuid4(), url=f"https://example.com/{name}", title=name, created_at=when)
                for name, when in (("saved", old), ("noted", old), ("asked", old), ("untouched", old), ("fresh", new))}
    db.add_all(articles.values())
    db.flush()
    db.add_all([
        UserSavedArticle(user_id=user.id, article_id=articles["saved"].id),
        UserAnnotation(user_id=user.id, article_id=articles["noted"].id, highlighted_text="the line",
                       note_text="my note", start_offset=0, end_offset=8),
        QAExchange(user_id=user.id, article_id=articles["asked"].id, question="Why now?",
                   answer="Because.", model_used="haiku"),
    ])
    db.commit()
    db.close()

    main._cleanup_stale_content(max_age_days=30)

    db = Session()
    assert {t for (t,) in db.query(Article.title).all()} == {"saved", "noted", "asked", "fresh"}, \
        "only the old article nobody saved, highlighted, noted or asked about goes"
    assert (db.query(UserSavedArticle).count(), db.query(UserAnnotation).count(), db.query(QAExchange).count()) == (1, 1, 1)
    db.close()
