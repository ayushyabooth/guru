"""
Performance tests for catchup feed API to ensure fast response times
"""
import pytest
import time
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.db.database import get_db, SessionLocal
from app.models.user import User
from app.models.storyboard import Storyboard
from app.services.clustering_service import get_or_build_storyboards_for_filter


@pytest.fixture
def db():
    """Create a test database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def test_user(db: Session):
    """Create a test user with profile"""
    from app.models.user import UserProfile
    
    user = User(
        email="perf.test@example.com",
        password_hash="hashed_password"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    profile = UserProfile(
        user_id=user.id,
        core_industry="Consumer",
        specializations=["Food & Beverage"],
        additional_interest_industries=["Technology"],
        total_weekly_capacity_band="medium",
        catchup_daily_goal_minutes=15,
        catchup_daily_max_minutes=30,
        divein_weekly_goal_minutes=60,
        recap_weekly_goal_minutes=20
    )
    db.add(profile)
    db.commit()
    
    return user


def test_catchup_feed_cached_performance(test_user, db):
    """Test that cached catchup feed responds in under 500ms"""
    # Pre-warm cache
    storyboards = get_or_build_storyboards_for_filter(test_user, "core", db)
    assert len(storyboards) > 0, "Should have storyboards in cache"
    
    # Test cached response time
    client = TestClient(app)
    
    # Create auth token
    from app.utils.auth import create_access_token
    token = create_access_token({"sub": str(test_user.id)})
    
    start_time = time.time()
    response = client.get(
        "/api/v1/catchup-feed?filter=core&limit=5&offset=0",
        headers={"Authorization": f"Bearer {token}"}
    )
    elapsed_time = time.time() - start_time
    
    assert response.status_code == 200
    assert elapsed_time < 0.5, f"Cached response took {elapsed_time:.3f}s, should be under 500ms"
    
    data = response.json()
    assert len(data["storyboards"]) > 0
    print(f"✅ Cached catchup feed responded in {elapsed_time*1000:.0f}ms")


def test_catchup_feed_uncached_performance(test_user, db):
    """Test that uncached catchup feed responds in under 5 seconds"""
    # Clear cache first
    from app.models.cache import StoryboardCache
    db.query(StoryboardCache).filter(
        StoryboardCache.user_id == test_user.id
    ).delete()
    db.commit()
    
    client = TestClient(app)
    
    # Create auth token
    from app.utils.auth import create_access_token
    token = create_access_token({"sub": str(test_user.id)})
    
    start_time = time.time()
    response = client.get(
        "/api/v1/catchup-feed?filter=core&limit=5&offset=0",
        headers={"Authorization": f"Bearer {token}"}
    )
    elapsed_time = time.time() - start_time
    
    assert response.status_code == 200
    assert elapsed_time < 5.0, f"Uncached response took {elapsed_time:.3f}s, should be under 5s"
    
    data = response.json()
    print(f"✅ Uncached catchup feed responded in {elapsed_time*1000:.0f}ms")


def test_filter_switch_performance(test_user, db):
    """Test that switching filters is fast when cache is warm"""
    # Pre-warm cache for multiple filters
    filters = ["core", "industry:Consumer", "specialization:Food & Beverage"]
    for filter_ctx in filters:
        get_or_build_storyboards_for_filter(test_user, filter_ctx, db)
    
    client = TestClient(app)
    from app.utils.auth import create_access_token
    token = create_access_token({"sub": str(test_user.id)})
    
    # Test switching between filters
    response_times = []
    for filter_ctx in filters:
        start_time = time.time()
        response = client.get(
            f"/api/v1/catchup-feed?filter={filter_ctx}&limit=5&offset=0",
            headers={"Authorization": f"Bearer {token}"}
        )
        elapsed_time = time.time() - start_time
        response_times.append(elapsed_time)
        
        assert response.status_code == 200
        assert elapsed_time < 0.5, f"Filter '{filter_ctx}' took {elapsed_time:.3f}s, should be under 500ms"
    
    avg_time = sum(response_times) / len(response_times)
    print(f"✅ Average filter switch time: {avg_time*1000:.0f}ms")
    assert avg_time < 0.3, f"Average filter switch should be under 300ms, got {avg_time*1000:.0f}ms"


def test_concurrent_requests_performance(test_user, db):
    """Test that multiple concurrent requests don't slow down significantly"""
    import concurrent.futures
    
    # Pre-warm cache
    get_or_build_storyboards_for_filter(test_user, "core", db)
    
    client = TestClient(app)
    from app.utils.auth import create_access_token
    token = create_access_token({"sub": str(test_user.id)})
    
    def make_request():
        start = time.time()
        response = client.get(
            "/api/v1/catchup-feed?filter=core&limit=5&offset=0",
            headers={"Authorization": f"Bearer {token}"}
        )
        return time.time() - start, response.status_code
    
    # Make 10 concurrent requests
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(make_request) for _ in range(10)]
        results = [f.result() for f in futures]
    
    times = [r[0] for r in results]
    statuses = [r[1] for r in results]
    
    assert all(s == 200 for s in statuses), "All requests should succeed"
    assert max(times) < 1.0, f"Slowest request took {max(times):.3f}s, should be under 1s"
    
    print(f"✅ 10 concurrent requests: avg={sum(times)/len(times)*1000:.0f}ms, max={max(times)*1000:.0f}ms")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
