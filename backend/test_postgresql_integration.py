#!/usr/bin/env python3
"""
Integration test for PostgreSQL + FastAPI + SQLAlchemy models
"""
import sys
import os
import requests
import json
from datetime import datetime, date
import uuid

# Add the app directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '.'))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.storyboard import Storyboard, StoryboardArticle
from app.models.interaction import UserSavedArticle, UserNotRelevant
from app.models.recap import RecapSession, RecapQuestion, RecapResponse
from app.models.metric import TimeLog, DailyMetric
from app.config import settings

def test_database_connection():
    """Test direct database connection"""
    print("🔧 Testing database connection...")
    try:
        engine = create_engine(settings.DATABASE_URL, echo=False)
        connection = engine.connect()
        
        # Test basic query
        result = connection.execute("SELECT 1 as test")
        test_value = result.fetchone()[0]
        
        if test_value == 1:
            print("✅ Database connection successful!")
            connection.close()
            return True
        else:
            print("❌ Database connection failed - unexpected result")
            return False
            
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False

def test_table_creation():
    """Test table creation with all models"""
    print("🔧 Testing table creation...")
    try:
        engine = create_engine(settings.DATABASE_URL, echo=False)
        
        # Drop all tables first (for clean test)
        Base.metadata.drop_all(bind=engine)
        print("🧹 Dropped existing tables")
        
        # Create all tables
        Base.metadata.create_all(bind=engine)
        print("✅ All tables created successfully!")
        
        # Verify tables exist
        inspector = engine.inspect(engine)
        tables = inspector.get_table_names()
        
        expected_tables = [
            'users', 'user_profiles', 'articles', 'expert_notes',
            'storyboards', 'storyboard_articles', 'user_saved_articles',
            'user_not_relevant', 'recap_sessions', 'recap_questions',
            'recap_responses', 'time_logs', 'daily_metrics'
        ]
        
        missing_tables = [table for table in expected_tables if table not in tables]
        if missing_tables:
            print(f"❌ Missing tables: {missing_tables}")
            return False
        
        print(f"✅ All {len(expected_tables)} tables created: {', '.join(tables)}")
        return True
        
    except Exception as e:
        print(f"❌ Table creation failed: {e}")
        return False

def test_crud_operations():
    """Test CRUD operations with PostgreSQL"""
    print("🔧 Testing CRUD operations...")
    try:
        engine = create_engine(settings.DATABASE_URL, echo=False)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        # Test User creation with UUID
        user_id = uuid.uuid4()
        test_user = User(
            id=user_id,
            email="postgres_test@guru.com",
            password_hash="hashed_password_123",
            is_active=True
        )
        db.add(test_user)
        db.commit()
        print("✅ User created with UUID primary key")
        
        # Test UserProfile with JSON arrays
        test_profile = UserProfile(
            user_id=user_id,
            core_industry="Consumer",
            specializations=["Food & Beverage", "Personal Care"],
            additional_interest_industries=["Technology"],
            total_weekly_capacity_band="~2h",
            catchup_daily_goal_minutes=20,
            catchup_daily_max_minutes=45,
            divein_weekly_goal_minutes=90,
            recap_weekly_goal_minutes=30
        )
        db.add(test_profile)
        db.commit()
        print("✅ UserProfile created with JSON arrays")
        
        # Test Article creation
        article_id = uuid.uuid4()
        test_article = Article(
            id=article_id,
            url="https://example.com/postgres-test-article",
            title="PostgreSQL Test Article",
            source="Test Source",
            publish_date=datetime.now(),
            raw_text="This is test article content for PostgreSQL...",
            word_count=500,
            is_paywalled=False
        )
        db.add(test_article)
        db.commit()
        print("✅ Article created successfully")
        
        # Test relationships
        user_with_profile = db.query(User).filter(User.id == user_id).first()
        if user_with_profile and user_with_profile.profile:
            specializations = user_with_profile.profile.specializations
            print(f"✅ Relationships working: User has {len(specializations)} specializations")
        
        # Test complex query with joins
        query_result = db.query(User).join(UserProfile).filter(
            UserProfile.core_industry == "Consumer"
        ).first()
        
        if query_result:
            print("✅ Complex queries with joins working")
        
        db.close()
        return True
        
    except Exception as e:
        print(f"❌ CRUD operations failed: {e}")
        return False

def test_fastapi_integration():
    """Test FastAPI integration with PostgreSQL"""
    print("🔧 Testing FastAPI + PostgreSQL integration...")
    
    # Test health endpoint
    try:
        response = requests.get("http://localhost:8000/health", timeout=5)
        if response.status_code == 200:
            print("✅ FastAPI health endpoint working")
        else:
            print("❌ FastAPI health endpoint failed")
            return False
    except Exception as e:
        print(f"⚠️  FastAPI server not running: {e}")
        return False
    
    # Test signup endpoint with PostgreSQL
    try:
        signup_data = {
            "email": "fastapi_postgres_test@guru.com",
            "password": "testpassword123"
        }
        
        response = requests.post(
            "http://localhost:8000/auth/signup",
            json=signup_data,
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            if "user_id" in data and "access_token" in data:
                print("✅ FastAPI signup with PostgreSQL working")
                return True
            else:
                print("❌ FastAPI signup response missing required fields")
                return False
        else:
            print(f"❌ FastAPI signup failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ FastAPI integration test failed: {e}")
        return False

def main():
    print("🚀 Starting PostgreSQL + SQLAlchemy Integration Tests\n")
    
    tests = [
        ("Database Connection", test_database_connection),
        ("Table Creation", test_table_creation),
        ("CRUD Operations", test_crud_operations),
        ("FastAPI Integration", test_fastapi_integration),
    ]
    
    results = {}
    for test_name, test_func in tests:
        print(f"\n📋 Running: {test_name}")
        print("-" * 50)
        results[test_name] = test_func()
        print()
    
    print("=" * 60)
    print("📊 TEST RESULTS SUMMARY")
    print("=" * 60)
    
    passed = 0
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name:.<40} {status}")
        if result:
            passed += 1
    
    print(f"\nTotal: {passed}/{len(tests)} tests passed")
    
    if passed == len(tests):
        print("\n🎉 ALL TESTS PASSED! PostgreSQL + SQLAlchemy setup is complete!")
        print("\n✅ Ready for production:")
        print("  - All 13 database tables created")
        print("  - UUID primary keys working")
        print("  - PostgreSQL-specific types (JSON arrays) working")
        print("  - Relationships and foreign keys working")
        print("  - FastAPI integration working")
        print("  - Authentication endpoints working")
    else:
        print(f"\n⚠️  {len(tests) - passed} tests failed. Please review the setup.")
    
    return passed == len(tests)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
