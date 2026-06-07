import { signal, computed } from '@preact/signals';
import type { OverlayResponse, Annotation, ChatMessage } from '../shared/types';

// Core state
export const overlayData = signal<OverlayResponse | null>(null);
export const isActivated = signal(false);
export const isLoading = signal(false);
export const error = signal<string | null>(null);

// UI state
export const panelVisible = signal(false);
export const activeTab = signal(0); // 0=Summary, 1=Insights, 2=Notes, 3=Ask Guru
export const panelHeight = signal(0.4); // Current snap (0=minimized, 0.4=default, 0.8=expanded)
export const scrollProgress = signal(0);
export const activePeekCard = signal<Annotation | null>(null);

// Chat state
export const chatMessages = signal<ChatMessage[]>([]);
export const conversationId = signal<string | null>(null);
export const isChatLoading = signal(false);
// Set to a question to jump to Ask Guru and auto-send it (e.g. tapping a
// "Think about it" prompt in the Summary tab). AskGuruTab consumes + clears it.
export const pendingPrompt = signal<string | null>(null);

// Highlights (loaded from backend UserAnnotation, persisted via /articles/{id}/annotations)
export const highlights = signal<Array<{ id?: string; text: string; note?: string; timestamp: string }>>([]);

// Computed
export const annotations = computed(() => overlayData.value?.annotations ?? []);
export const richContent = computed(() => overlayData.value?.rich_content ?? null);
export const totalSections = computed(() => overlayData.value?.total_sections ?? 1);
export const annotationCount = computed(() => annotations.value.length);
export const unseenPeekCards = signal(new Set<string>());
