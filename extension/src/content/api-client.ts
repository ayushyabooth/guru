import type { OverlayResponse, ChatResponse, ChatMessage } from '../shared/types';

// All API calls go through the background service worker via chrome.runtime.sendMessage.
// Content scripts can't reliably fetch from localhost due to CORS/network restrictions
// when running on publisher pages. The background worker has full network access.

function sendToBackground(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response?.data);
    });
  });
}

export async function fetchOverlayData(articleId: string): Promise<OverlayResponse> {
  return sendToBackground({ type: 'FETCH_OVERLAY', articleId });
}

export async function sendChatMessage(
  articleId: string,
  question: string,
  conversationHistory: ChatMessage[],
  conversationId?: string,
): Promise<ChatResponse> {
  return sendToBackground({
    type: 'FETCH_CHAT',
    payload: {
      article_id: articleId,
      question,
      conversation_history: conversationHistory,
      conversation_id: conversationId,
    },
  });
}

/** Fetch chat history for an article from the backend */
export async function fetchChatHistory(articleId: string): Promise<{
  messages: ChatMessage[];
  conversation_id: string;
}> {
  return sendToBackground({ type: 'FETCH_CHAT_HISTORY', articleId });
}

/** Fetch user annotations/highlights for an article from the backend */
export async function fetchAnnotations(articleId: string): Promise<Array<{
  id: string;
  highlighted_text: string;
  note_text: string | null;
  color: string;
  created_at: string;
}>> {
  return sendToBackground({ type: 'FETCH_ANNOTATIONS', articleId });
}

/** Save a highlight/note annotation to the backend */
export async function createAnnotation(articleId: string, data: {
  highlighted_text: string;
  note_text?: string;
  start_offset: number;
  end_offset: number;
}): Promise<{ id: string }> {
  return sendToBackground({
    type: 'CREATE_ANNOTATION',
    articleId,
    payload: {
      highlighted_text: data.highlighted_text,
      note_text: data.note_text || null,
      color: 'gold',
      start_offset: data.start_offset,
      end_offset: data.end_offset,
    },
  });
}
