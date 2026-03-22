/**
 * Lightweight interaction tracking service.
 * Fire-and-forget: logs to backend but doesn't block UI.
 */
import { API_BASE_URL } from '../constants/config';
import { getAuthToken } from '../utils/auth';

type InteractionType = 'spotlight_tap' | 'link_open' | 'highlight' | 'annotation_expand';

interface TrackParams {
  interactionType: InteractionType;
  articleId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export async function trackInteraction(params: TrackParams): Promise<void> {
  try {
    const token = await getAuthToken();
    if (!token) return;

    // Fire-and-forget — we don't await the response in the caller
    fetch(`${API_BASE_URL}/interactions/track`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        interaction_type: params.interactionType,
        article_id: params.articleId || null,
        content: params.content || null,
        metadata: params.metadata || null,
      }),
    }).catch(() => {
      // Silently fail — tracking should never break the UI
    });
  } catch {
    // Silently fail
  }
}
