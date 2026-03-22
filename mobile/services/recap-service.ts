/**
 * Recap Journey Service — connects to the 4-stage Recap API
 */
import { getAuthToken } from '../utils/auth';
import { API_BASE_URL } from '../constants/config';

// ── Types ───────────────────────────────────────────────────────────

export interface RecapArticle {
  id: string;
  title: string;
  source: string | null;
  thumbnail_url: string | null;
  filter_context: string;
  key_quote: string | null;
  engagement_type: 'read' | 'saved' | 'qa_asked';
  time_spent_minutes: number;
}

export interface QAHighlight {
  question: string;
  article_title: string;
  answer_snippet: string;
}

export interface TopicCluster {
  theme: string;
  article_count: number;
  filters: string[];
}

export interface ReadingPattern {
  peak_day: string;
  total_articles: number;
  deepest_dive: {
    article_title: string;
    time_spent_minutes: number;
  };
}

export interface SnapshotData {
  articles_engaged: RecapArticle[];
  filters_explored: string[];
  qa_highlights: QAHighlight[];
  topic_clusters: TopicCluster[];
  reading_pattern: ReadingPattern;
}

export interface GuidedQuestion {
  type: 'retrieval' | 'pattern_spotting' | 'reflection' | 'surprise';
  text: string;
  referenced_articles: string[];
  response_format: 'free_text' | 'tappable_chips' | 'mixed';
  chips: string[];
}

export interface KeyInsight {
  id: string;
  insight_text: string;
  source: 'user_reflection' | 'system_extracted';
  source_article_ids: string[];
  filters_spanned: string[];
  created_at: string | null;
}

export interface SocraticResponse {
  response: string;
  follow_up_prompt: string;
  insight_extracted: KeyInsight | null;
  exchange_count: number;
  is_concluded: boolean;
}

export interface RecapJourney {
  journey_id: string;
  week_start: string;
  week_end: string;
  tier: 'lite' | 'standard' | 'full';
  status: string;
  stage_progress: number;
  activity_summary?: Record<string, any>;
  resumed?: boolean;
}

export interface RecapJourneySummary {
  id: string;
  week_start: string;
  week_end: string;
  tier: string;
  status: string;
  stage_progress: number;
  articles_read_count: number;
  commitment: string | null;
  insight_count: number;
  has_audio: boolean;
  created_at: string | null;
  completed_at: string | null;
}

export interface CommitmentData {
  commitment_text: string;
  week_start: string;
  week_end: string;
  journey_id: string;
}

export interface AudioStatus {
  status: 'generating_script' | 'generating_audio' | 'ready' | 'failed' | null;
  progress_pct: number;
  audio_url?: string;
  audio_duration_seconds?: number;
  error?: string;
}

export interface ScriptSegment {
  speaker: 'narrator' | 'analyst';
  text: string;
}

// ── Service ─────────────────────────────────────────────────────────

class RecapServiceClient {
  private baseUrl = API_BASE_URL;

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    if (!token) throw new Error('No authentication token found');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ── Journey Lifecycle ──────────────────────────────────────────

  async startJourney(options?: { forceNew?: boolean }): Promise<RecapJourney> {
    const body = options?.forceNew ? { force_new: true } : undefined;
    return this.request<RecapJourney>('POST', '/recap/start', body);
  }

  async getSnapshot(journeyId: string): Promise<{
    journey_id: string;
    tier: string;
    status: string;
    stage_progress: number;
    snapshot: SnapshotData;
    week_start: string;
    week_end: string;
  }> {
    return this.request('GET', `/recap/${journeyId}/snapshot`);
  }

  async advanceStage(journeyId: string): Promise<{ status: string; stage_progress: number }> {
    return this.request('POST', `/recap/${journeyId}/advance`);
  }

  // ── Stage 2: Questions ─────────────────────────────────────────

  async getQuestions(journeyId: string): Promise<{
    journey_id: string;
    questions: GuidedQuestion[];
    responses: Record<string, string>;
    tier: string;
  }> {
    return this.request('GET', `/recap/${journeyId}/questions`);
  }

  async submitAnswer(journeyId: string, questionIndex: number, response: string): Promise<{
    stored: boolean;
    question_index: number;
    all_answered: boolean;
    total_questions: number;
    answered_count: number;
    followup?: {
      followup_text: string;
      referenced_articles: string[];
    };
  }> {
    return this.request('POST', `/recap/${journeyId}/answer`, {
      question_index: questionIndex,
      response,
    });
  }

  // ── Stage 3: Socratic ─────────────────────────────────────────

  async socraticExchange(journeyId: string, message: string): Promise<SocraticResponse> {
    return this.request<SocraticResponse>('POST', `/recap/${journeyId}/socratic`, {
      message,
    });
  }

  // ── Insights ──────────────────────────────────────────────────

  async getInsights(journeyId: string): Promise<{
    journey_id: string;
    insights: KeyInsight[];
    total: number;
    user_generated: number;
    system_extracted: number;
  }> {
    return this.request('GET', `/recap/${journeyId}/insights`);
  }

  // ── Commitment ────────────────────────────────────────────────

  async storeCommitment(journeyId: string, text: string): Promise<{ saved: boolean }> {
    return this.request('POST', `/recap/${journeyId}/commitment`, { text });
  }

  async getMyCommitment(): Promise<{ commitment: CommitmentData | null }> {
    return this.request('GET', '/me/commitment');
  }

  // ── Summary ───────────────────────────────────────────────────

  async getSummary(journeyId: string): Promise<any> {
    return this.request('GET', `/recap/${journeyId}/summary`);
  }

  // ── Stage 4: Audio ───────────────────────────────────────────

  async generateAudio(journeyId: string, force = false): Promise<{
    status: string;
    audio_url?: string;
  }> {
    const query = force ? '?force=true' : '';
    return this.request('POST', `/recap/${journeyId}/audio/generate${query}`);
  }

  async getAudioStatus(journeyId: string): Promise<AudioStatus> {
    return this.request<AudioStatus>('GET', `/recap/${journeyId}/audio/status`);
  }

  getAudioStreamUrl(journeyId: string): string {
    return `${this.baseUrl}/recap/${journeyId}/audio/stream`;
  }

  // ── Archive ───────────────────────────────────────────────────

  async listJourneys(limit = 20, offset = 0): Promise<{
    journeys: RecapJourneySummary[];
    total: number;
  }> {
    return this.request('GET', `/recap/sessions?limit=${limit}&offset=${offset}`);
  }
}

export const recapService = new RecapServiceClient();
