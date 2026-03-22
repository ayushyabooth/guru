export interface Annotation {
  id: string;
  type: string;  // "reflection" | "connection" | "insight"
  text: string;
  position_after_section: number;
  generated_by: string;
}

export interface RichContent {
  summary_whats_in: string | null;
  summary_why_matters: string | null;
  summary_between_lines: string | null;
  spotlight_quotes: string[];
  socratic_prompts: string[];
}

export interface RelatedArticle {
  id: string;
  title: string;
  source: string;
  url?: string;
  thumbnail_url?: string;
  word_count?: number;
}

export interface OverlayResponse {
  id: string;
  headline: string;
  author?: string;
  publish_date?: string;
  source: string;
  url: string;
  thumbnail_url?: string;
  word_count: number;
  is_paywalled: boolean;
  expert_flags: number;
  annotations: Annotation[];
  rich_content: RichContent | null;
  related_articles: RelatedArticle[];
  industry?: string;
  cluster_theme?: string;
  total_sections: number;
}

export interface ByUrlResponse {
  article_id: string;
  headline: string;
  source: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  response: string;
  related_article_citations: string[];
  follow_up_prompts: string[];
  conversation_id: string;
  exchange_id: string;
}

export interface ActivateMessage {
  type: 'ACTIVATE';
  articleId: string;
  url: string;
}

export type ExtensionMessage =
  | ActivateMessage
  | { type: 'CHECK_URL'; url: string }
  | { type: 'AUTH_TOKEN'; token: string };
