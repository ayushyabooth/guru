export const API_BASE_URL = 'http://localhost:8000/api/v1';

// Design tokens (from mobile/constants/theme.ts)
export const COLORS = {
  accent: '#6366F1',
  overlayBg: 'rgba(255, 255, 255, 0.92)',
  overlayBorder: 'rgba(255, 255, 255, 0.3)',
  overlayShadow: '0 -4px 24px rgba(0, 0, 0, 0.08)',
  toolbarBg: 'rgba(0, 0, 0, 0.55)',
  textPrimary: '#1E293B',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  surface: '#F8FAFC',
  white: '#FFFFFF',
  error: '#EF4444',
  success: '#10B981',
} as const;

export const ANNOTATION_COLORS: Record<string, string> = {
  reflection: '#10B981',
  connection: '#F59E0B',
  insight: '#3B82F6',
  expert_insight: '#F59E0B',
  leading_question: '#8B5CF6',
};

export const SNAP_HEIGHTS = {
  minimized: 48,     // Tab bar only
  default: 0.4,      // 40vh
  expanded: 0.8,     // 80vh
} as const;

export const FAB_SIZE = 56;
export const RAIL_WIDTH = 12;
export const DOT_SIZE = 8;
export const PEEK_CARD_WIDTH = 280;
export const Z_INDEX = 2147483647;
