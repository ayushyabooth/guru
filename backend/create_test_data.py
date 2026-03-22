#!/usr/bin/env python3
"""
Create test data for the catchup feed functionality
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.models.article import Article, ExpertNote
from app.models.storyboard import Storyboard, StoryboardArticle

def create_test_data():
    db = SessionLocal()
    try:
        # Create test articles with expert notes
        articles_data = [
            {
                "title": "Revolutionary AI Breakthrough in Food Safety",
                "source": "Food Tech Weekly",
                "url": "https://example.com/ai-food-safety",
                "word_count": 850,
                "is_paywalled": False,
                "industry": "Consumer",
                "specializations": ["Food & Beverage"],
                "summary": "New AI system can detect contamination in food products with 99.7% accuracy"
            },
            {
                "title": "Sustainable Packaging Innovation Transforms Industry",
                "source": "Green Business Journal",
                "url": "https://example.com/sustainable-packaging",
                "word_count": 720,
                "is_paywalled": True,
                "industry": "Consumer",
                "specializations": ["Food & Beverage"],
                "summary": "Biodegradable packaging made from seaweed reduces plastic waste by 80%"
            },
            {
                "title": "Healthcare AI Diagnostics Reach New Milestone",
                "source": "Medical Innovation Today",
                "url": "https://example.com/healthcare-ai",
                "word_count": 950,
                "is_paywalled": False,
                "industry": "Healthcare",
                "specializations": ["Medical Technology"],
                "summary": "AI-powered diagnostic tools now detect diseases 3 months earlier than traditional methods"
            },
            {
                "title": "Software Development Trends for 2026",
                "source": "Developer Weekly",
                "url": "https://example.com/dev-trends-2026",
                "word_count": 1200,
                "is_paywalled": False,
                "industry": "Technology",
                "specializations": ["Software Development"],
                "summary": "Low-code platforms and AI-assisted development dominate the software landscape"
            },
            {
                "title": "Consumer Behavior Shifts in Digital Age",
                "source": "Market Research Pro",
                "url": "https://example.com/consumer-behavior",
                "word_count": 680,
                "is_paywalled": True,
                "industry": "Consumer",
                "specializations": ["Market Research"],
                "summary": "Gen Z consumers prioritize sustainability and authenticity over brand loyalty"
            }
        ]
        
        created_articles = []
        
        for article_data in articles_data:
            # Create article
            article = Article(
                id=uuid.uuid4(),
                title=article_data["title"],
                source=article_data["source"],
                url=article_data["url"],
                word_count=article_data["word_count"],
                is_paywalled=article_data["is_paywalled"],
                created_at=datetime.now(timezone.utc)
            )
            db.add(article)
            
            # Create expert note
            expert_note = ExpertNote(
                id=uuid.uuid4(),
                article_id=article.id,
                expert_industry=article_data["industry"],
                expert_specializations=article_data["specializations"],
                summary=article_data["summary"],
                created_at=datetime.now(timezone.utc)
            )
            db.add(expert_note)
            
            created_articles.append((article, expert_note))
        
        # Create test storyboards
        storyboards_data = [
            {
                "headline_idx": 0,  # AI Food Safety article
                "related_indices": [1],  # Sustainable Packaging
                "industry": "Consumer",
                "specializations": ["Food & Beverage"],
                "summary": "The food industry is experiencing a technological revolution with AI-powered safety systems and sustainable packaging solutions leading the charge. These innovations promise to make food safer while reducing environmental impact.",
                "theme": "Food Tech Innovation"
            },
            {
                "headline_idx": 2,  # Healthcare AI article
                "related_indices": [],
                "industry": "Healthcare",
                "specializations": ["Medical Technology"],
                "summary": "Healthcare diagnostics are being transformed by artificial intelligence, enabling earlier disease detection and more accurate diagnoses. This represents a major leap forward in preventive medicine.",
                "theme": "AI in Healthcare"
            },
            {
                "headline_idx": 3,  # Software Development Trends
                "related_indices": [],
                "industry": "Technology",
                "specializations": ["Software Development"],
                "summary": "The software development landscape is rapidly evolving with AI-assisted coding and low-code platforms democratizing application development. These trends are reshaping how software is built and deployed.",
                "theme": "Dev Tools Evolution"
            },
            {
                "headline_idx": 4,  # Consumer Behavior
                "related_indices": [],
                "industry": "Consumer",
                "specializations": ["Market Research"],
                "summary": "Understanding modern consumer behavior is crucial for businesses as digital natives prioritize values-based purchasing decisions over traditional brand loyalty.",
                "theme": "Consumer Insights"
            }
        ]
        
        for storyboard_data in storyboards_data:
            headline_article = created_articles[storyboard_data["headline_idx"]][0]
            
            storyboard = Storyboard(
                id=uuid.uuid4(),
                headline_article_id=headline_article.id,
                industry=storyboard_data["industry"],
                specializations=storyboard_data["specializations"],
                summary=storyboard_data["summary"],
                theme=storyboard_data.get("theme"),
                created_at=datetime.now(timezone.utc)
            )
            db.add(storyboard)
            
            # Add headline article to storyboard
            storyboard_article = StoryboardArticle(
                id=uuid.uuid4(),
                storyboard_id=storyboard.id,
                article_id=headline_article.id,
                rank=1
            )
            db.add(storyboard_article)
            
            # Add related articles
            for rank, related_idx in enumerate(storyboard_data["related_indices"], start=2):
                related_article = created_articles[related_idx][0]
                storyboard_article = StoryboardArticle(
                    id=uuid.uuid4(),
                    storyboard_id=storyboard.id,
                    article_id=related_article.id,
                    rank=rank
                )
                db.add(storyboard_article)
        
        db.commit()
        print(f"✅ Created {len(created_articles)} articles and {len(storyboards_data)} storyboards")
        
        # Verify data
        article_count = db.query(Article).count()
        storyboard_count = db.query(Storyboard).count()
        print(f"📊 Database now has {article_count} articles and {storyboard_count} storyboards")
        
    except Exception as e:
        print(f"❌ Error creating test data: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    create_test_data()
