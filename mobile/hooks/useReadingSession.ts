import { useState, useEffect, useRef } from 'react';

export interface ReadingSession {
  articleId: string;
  timeSpentMinutes: number;
  completionStatus: 'in_progress' | 'read';
  timestamp: string;
}

/**
 * Custom hook for tracking reading sessions
 * Automatically tracks time spent reading an article
 */
export const useReadingSession = (articleId: string) => {
  const [timeSpent, setTimeSpent] = useState(0); // in seconds
  const [status, setStatus] = useState<'in_progress' | 'read'>('in_progress');
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Start timer
    startTimeRef.current = Date.now();
    
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setTimeSpent(elapsed);
    }, 1000);

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [articleId]);

  const getTimeSpent = (): number => {
    return timeSpent;
  };

  const getTimeSpentMinutes = (): number => {
    return Math.round(timeSpent / 60);
  };

  const markAsRead = () => {
    setStatus('read');
    
    // Save to localStorage
    const session: ReadingSession = {
      articleId,
      timeSpentMinutes: getTimeSpentMinutes(),
      completionStatus: 'read',
      timestamp: new Date().toISOString(),
    };

    try {
      const existingSessions = localStorage.getItem('guru_divein_read_sessions');
      const sessions: ReadingSession[] = existingSessions ? JSON.parse(existingSessions) : [];
      
      // Check if session already exists for this article
      const existingIndex = sessions.findIndex(s => s.articleId === articleId);
      if (existingIndex >= 0) {
        // Update existing session
        sessions[existingIndex] = session;
      } else {
        // Add new session
        sessions.push(session);
      }
      
      localStorage.setItem('guru_divein_read_sessions', JSON.stringify(sessions));
    } catch (error) {
    }

    return session;
  };

  const getReadingSessions = (): ReadingSession[] => {
    try {
      const sessions = localStorage.getItem('guru_divein_read_sessions');
      return sessions ? JSON.parse(sessions) : [];
    } catch (error) {
      return [];
    }
  };

  const isArticleRead = (checkArticleId: string): boolean => {
    const sessions = getReadingSessions();
    return sessions.some(s => s.articleId === checkArticleId && s.completionStatus === 'read');
  };

  return {
    timeSpent,
    status,
    getTimeSpent,
    getTimeSpentMinutes,
    markAsRead,
    getReadingSessions,
    isArticleRead,
  };
};
