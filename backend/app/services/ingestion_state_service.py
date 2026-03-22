"""
Service for managing ingestion state to avoid re-processing unchanged files
"""
import hashlib
import os
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc
import logging

from app.models.ingestion import IngestionState, IngestionLog, IngestionStatus
from app.db.database import SessionLocal

logger = logging.getLogger(__name__)


class IngestionStateService:
    """Service for managing ingestion state and file change detection"""
    
    @staticmethod
    def get_ingestion_state(file_path: str, db: Optional[Session] = None) -> Optional[IngestionState]:
        """
        Get the most recent ingestion state for a file
        
        Args:
            file_path: Path to the file to check
            db: Database session (optional, will create if not provided)
            
        Returns:
            Most recent IngestionState or None if no previous ingestion
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            state = db.query(IngestionState).filter(
                IngestionState.file_path == file_path
            ).order_by(desc(IngestionState.created_at)).first()
            
            return state
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def compute_file_hash(filepath: str) -> str:
        """
        Compute SHA256 hash of file content
        
        Args:
            filepath: Path to the file
            
        Returns:
            SHA256 hash as hex string
            
        Raises:
            FileNotFoundError: If file doesn't exist
            IOError: If file can't be read
        """
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"File not found: {filepath}")
        
        sha256_hash = hashlib.sha256()
        
        try:
            with open(filepath, 'rb') as f:
                # Read file in chunks to handle large files efficiently
                for chunk in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(chunk)
        except IOError as e:
            raise IOError(f"Error reading file {filepath}: {e}")
        
        return sha256_hash.hexdigest()
    
    @staticmethod
    def has_file_changed(file_path: str, db: Optional[Session] = None) -> bool:
        """
        Check if file has changed since last successful ingestion
        
        Args:
            file_path: Path to the file to check
            db: Database session (optional)
            
        Returns:
            True if file has changed or no previous successful ingestion exists
        """
        try:
            # Get current file hash
            current_hash = IngestionStateService.compute_file_hash(file_path)
            
            # Get last successful ingestion state
            last_state = IngestionStateService.get_ingestion_state(file_path, db)
            
            if not last_state or last_state.status != IngestionStatus.COMPLETED:
                # No previous successful ingestion
                logger.info(f"No previous successful ingestion found for {file_path}")
                return True
            
            # Compare hashes
            if last_state.file_hash != current_hash:
                logger.info(f"File {file_path} has changed (hash: {last_state.file_hash[:8]}... -> {current_hash[:8]}...)")
                return True
            
            logger.info(f"File {file_path} unchanged since last ingestion")
            return False
            
        except (FileNotFoundError, IOError) as e:
            logger.error(f"Error checking file {file_path}: {e}")
            return True  # Assume changed if we can't check
    
    @staticmethod
    def create_ingestion_state(file_path: str, db: Optional[Session] = None) -> IngestionState:
        """
        Create new ingestion state with 'pending' status
        
        Args:
            file_path: Path to the file being ingested
            db: Database session (optional)
            
        Returns:
            New IngestionState instance
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            # Compute current file hash
            file_hash = IngestionStateService.compute_file_hash(file_path)
            
            # Create new state
            state = IngestionState(
                file_path=file_path,
                file_hash=file_hash,
                status=IngestionStatus.PENDING,
                total_articles_ingested=0
            )
            
            db.add(state)
            db.commit()
            db.refresh(state)
            
            logger.info(f"Created ingestion state for {file_path} (ID: {state.id})")
            return state
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def update_ingestion_state(
        state_id: str, 
        status: IngestionStatus, 
        total_articles: int = None,
        error_message: str = None,
        db: Optional[Session] = None
    ) -> bool:
        """
        Update ingestion state with new status and counts
        
        Args:
            state_id: UUID of the ingestion state
            status: New status
            total_articles: Total articles ingested (optional)
            error_message: Error message if failed (optional)
            db: Database session (optional)
            
        Returns:
            True if update successful, False otherwise
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            state = db.query(IngestionState).filter(IngestionState.id == state_id).first()
            
            if not state:
                logger.error(f"Ingestion state not found: {state_id}")
                return False
            
            # Update fields
            state.status = status
            state.updated_at = datetime.utcnow()
            
            if total_articles is not None:
                state.total_articles_ingested = total_articles
            
            if status == IngestionStatus.COMPLETED:
                state.last_ingested_at = datetime.utcnow()
                state.error_message = None  # Clear any previous error
            elif status == IngestionStatus.FAILED and error_message:
                state.error_message = error_message
            
            db.commit()
            
            logger.info(f"Updated ingestion state {state_id} to {status.value}")
            return True
            
        except Exception as e:
            logger.error(f"Error updating ingestion state {state_id}: {e}")
            db.rollback()
            return False
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def log_ingestion_action(
        state_id: str,
        action: str,
        article_id: str = None,
        details: str = None,
        db: Optional[Session] = None
    ) -> bool:
        """
        Log an ingestion action for debugging and auditing
        
        Args:
            state_id: UUID of the ingestion state
            action: Action performed ('parsed', 'created_article', 'updated_article', 'skipped')
            article_id: UUID of related article (optional)
            details: Additional details about the action (optional)
            db: Database session (optional)
            
        Returns:
            True if log created successfully, False otherwise
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            log_entry = IngestionLog(
                ingestion_state_id=state_id,
                action=action,
                article_id=article_id,
                details=details
            )
            
            db.add(log_entry)
            db.commit()
            
            logger.debug(f"Logged ingestion action: {action} for state {state_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error logging ingestion action: {e}")
            db.rollback()
            return False
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def get_ingestion_history(file_path: str = None, limit: int = 10, db: Optional[Session] = None) -> list[IngestionState]:
        """
        Get ingestion history, optionally filtered by file path
        
        Args:
            file_path: Optional file path filter
            limit: Maximum number of records to return
            db: Database session (optional)
            
        Returns:
            List of IngestionState records ordered by creation date (newest first)
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            query = db.query(IngestionState)
            
            if file_path:
                query = query.filter(IngestionState.file_path == file_path)
            
            states = query.order_by(desc(IngestionState.created_at)).limit(limit).all()
            return states
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def get_ingestion_stats(db: Optional[Session] = None) -> Dict[str, Any]:
        """
        Get overall ingestion statistics
        
        Args:
            db: Database session (optional)
            
        Returns:
            Dictionary with ingestion statistics
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            from app.models.article import Article, ExpertNote
            
            # Total articles
            total_articles = db.query(Article).count()
            
            # Total ingestion states
            total_states = db.query(IngestionState).count()
            
            # Last successful ingestion
            last_successful = db.query(IngestionState).filter(
                IngestionState.status == IngestionStatus.COMPLETED
            ).order_by(desc(IngestionState.last_ingested_at)).first()
            
            # Articles by industry (from expert notes)
            industry_counts = {}
            try:
                industry_results = db.query(
                    ExpertNote.expert_industry,
                    db.func.count(ExpertNote.id)
                ).group_by(ExpertNote.expert_industry).all()
                
                industry_counts = {industry: count for industry, count in industry_results}
            except Exception as e:
                logger.warning(f"Could not get industry counts: {e}")
            
            # Articles by priority
            priority_counts = {}
            try:
                priority_results = db.query(
                    ExpertNote.priority,
                    db.func.count(ExpertNote.id)
                ).group_by(ExpertNote.priority).all()
                
                priority_counts = {priority: count for priority, count in priority_results}
            except Exception as e:
                logger.warning(f"Could not get priority counts: {e}")
            
            return {
                'total_articles': total_articles,
                'total_ingestion_states': total_states,
                'last_ingestion': last_successful.last_ingested_at if last_successful else None,
                'articles_by_industry': industry_counts,
                'articles_by_priority': priority_counts
            }
            
        finally:
            if close_db:
                db.close()
