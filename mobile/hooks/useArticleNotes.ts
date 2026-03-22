import { useState, useEffect } from 'react';
import { useDiveInContext, ArticleNote } from '../contexts/DiveInContext';

/**
 * Custom hook for managing article notes
 * Handles Pause-and-Relate, Micro-Prompt, and Q&A responses
 */
export const useArticleNotes = (articleId: string) => {
  const context = useDiveInContext();
  const [notes, setNotes] = useState<ArticleNote | undefined>(
    context.getNote(articleId)
  );

  useEffect(() => {
    // Update local state when context changes
    setNotes(context.getNote(articleId));
  }, [articleId, context.sessionNotes]);

  const savePauseAndRelate = (responses: Array<{
    suggestedArticleId: string;
    response: 'yes' | 'no' | 'not_sure';
  }>) => {
    const updatedNote: Partial<ArticleNote> = {
      pauseAndRelate: responses,
    };
    context.saveNote(articleId, updatedNote);
    setNotes(context.getNote(articleId));
  };

  const saveMicroPrompt = (response: {
    textResponse?: string;
    emojiResponse?: string;
  }) => {
    const updatedNote: Partial<ArticleNote> = {
      microPrompt: response,
    };
    context.saveNote(articleId, updatedNote);
    setNotes(context.getNote(articleId));
  };

  const saveQAPair = (qaPair: {
    questionId: string;
    question: string;
    answer: string;
    citations: string[];
    saved: boolean;
  }) => {
    const currentNotes = context.getNote(articleId);
    const existingQAPairs = currentNotes?.qaPairs || [];
    
    // Check if Q&A pair already exists
    const existingIndex = existingQAPairs.findIndex(
      qa => qa.questionId === qaPair.questionId
    );

    let updatedQAPairs;
    if (existingIndex >= 0) {
      // Update existing Q&A pair
      updatedQAPairs = [...existingQAPairs];
      updatedQAPairs[existingIndex] = qaPair;
    } else {
      // Add new Q&A pair
      updatedQAPairs = [...existingQAPairs, qaPair];
    }

    const updatedNote: Partial<ArticleNote> = {
      qaPairs: updatedQAPairs,
    };
    context.saveNote(articleId, updatedNote);
    setNotes(context.getNote(articleId));
  };

  const getSavedNotes = (checkArticleId?: string): ArticleNote | undefined => {
    const id = checkArticleId || articleId;
    return context.getNote(id);
  };

  const getAllNotes = (): Record<string, ArticleNote> => {
    return context.sessionNotes;
  };

  const clearNotes = () => {
    context.saveNote(articleId, {
      pauseAndRelate: undefined,
      microPrompt: undefined,
      qaPairs: undefined,
    });
    setNotes(undefined);
  };

  return {
    notes,
    savePauseAndRelate,
    saveMicroPrompt,
    saveQAPair,
    getSavedNotes,
    getAllNotes,
    clearNotes,
  };
};
