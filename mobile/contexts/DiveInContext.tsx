import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Types
export interface Article {
  id: string;
  headline: string;
  source: string;
  context: string;
  readingTime: number;
  priority: string;
  isSaved: boolean;
  content?: string;
}

export interface ReadingSession {
  articleId: string;
  timeSpentMinutes: number;
  completionStatus: 'in_progress' | 'read';
  timestamp: string;
}

export interface ArticleNote {
  articleId: string;
  pauseAndRelate?: Array<{
    suggestedArticleId: string;
    response: 'yes' | 'no' | 'not_sure';
  }>;
  microPrompt?: {
    textResponse?: string;
    emojiResponse?: string;
  };
  qaPairs?: Array<{
    questionId: string;
    question: string;
    answer: string;
    citations: string[];
    saved: boolean;
  }>;
}

interface DiveInState {
  currentArticle: Article | null;
  currentContext: string;
  articles: Article[];
  readingHistory: string[];
  sessionNotes: Record<string, ArticleNote>;
}

interface DiveInContextType extends DiveInState {
  setCurrentArticle: (article: Article | null) => void;
  setCurrentContext: (context: string) => void;
  setArticles: (articles: Article[]) => void;
  pushToHistory: (articleId: string) => void;
  popFromHistory: () => string | undefined;
  clearHistory: () => void;
  saveNote: (articleId: string, note: Partial<ArticleNote>) => void;
  getNote: (articleId: string) => ArticleNote | undefined;
}

const DiveInContext = createContext<DiveInContextType | undefined>(undefined);

// Helper functions for localStorage
const getStorageKey = (key: string, userId: string = 'default') => {
  return `guru_divein_${userId}_${key}`;
};

const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return defaultValue;
    }
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

const saveToStorage = <T,>(key: string, value: T): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
  }
};

export const DiveInProvider: React.FC<{ children: ReactNode; userId?: string }> = ({
  children,
  userId = 'default',
}) => {
  // Always start with server-safe defaults; load from localStorage after mount
  // so SSR HTML matches client hydration (avoids React Error #418).
  const [currentArticle, setCurrentArticleState] = useState<Article | null>(null);
  const [currentContext, setCurrentContextState] = useState<string>('finance');
  const [articles, setArticlesState] = useState<Article[]>([]);
  const [readingHistory, setReadingHistoryState] = useState<string[]>([]);
  const [sessionNotes, setSessionNotesState] = useState<Record<string, ArticleNote>>({});
  const [isHydrated, setIsHydrated] = useState(false);

  // Load persisted state after mount (client-only, deferred past hydration).
  useEffect(() => {
    setCurrentArticleState(loadFromStorage(getStorageKey('currentArticle', userId), null));
    setCurrentContextState(loadFromStorage(getStorageKey('currentContext', userId), 'finance'));
    setArticlesState(loadFromStorage(getStorageKey('articles', userId), []));
    setReadingHistoryState(loadFromStorage(getStorageKey('readingHistory', userId), []));
    setSessionNotesState(loadFromStorage(getStorageKey('sessionNotes', userId), {}));
    setIsHydrated(true);
  }, [userId]);

  // Auto-save to localStorage on state changes (skip until hydration is done).
  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(getStorageKey('currentArticle', userId), currentArticle);
  }, [currentArticle, userId, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(getStorageKey('currentContext', userId), currentContext);
  }, [currentContext, userId, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(getStorageKey('articles', userId), articles);
  }, [articles, userId, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(getStorageKey('readingHistory', userId), readingHistory);
  }, [readingHistory, userId, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(getStorageKey('sessionNotes', userId), sessionNotes);
  }, [sessionNotes, userId, isHydrated]);

  // State setters with auto-save
  const setCurrentArticle = (article: Article | null) => {
    setCurrentArticleState(article);
  };

  const setCurrentContext = (context: string) => {
    setCurrentContextState(context);
  };

  const setArticles = (newArticles: Article[]) => {
    setArticlesState(newArticles);
  };

  const pushToHistory = (articleId: string) => {
    setReadingHistoryState((prev) => [...prev, articleId]);
  };

  const popFromHistory = (): string | undefined => {
    let poppedId: string | undefined;
    setReadingHistoryState((prev) => {
      const newHistory = [...prev];
      poppedId = newHistory.pop();
      return newHistory;
    });
    return poppedId;
  };

  const clearHistory = () => {
    setReadingHistoryState([]);
  };

  const saveNote = (articleId: string, note: Partial<ArticleNote>) => {
    setSessionNotesState((prev) => ({
      ...prev,
      [articleId]: {
        ...prev[articleId],
        articleId,
        ...note,
      },
    }));
  };

  const getNote = (articleId: string): ArticleNote | undefined => {
    return sessionNotes[articleId];
  };

  const value: DiveInContextType = {
    currentArticle,
    currentContext,
    articles,
    readingHistory,
    sessionNotes,
    setCurrentArticle,
    setCurrentContext,
    setArticles,
    pushToHistory,
    popFromHistory,
    clearHistory,
    saveNote,
    getNote,
  };

  return <DiveInContext.Provider value={value}>{children}</DiveInContext.Provider>;
};

export const useDiveInContext = () => {
  const context = useContext(DiveInContext);
  if (!context) {
    throw new Error('useDiveInContext must be used within DiveInProvider');
  }
  return context;
};
