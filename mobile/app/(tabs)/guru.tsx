import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, AppState,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { useTheme } from '../../contexts/ThemeContext';
import GuruBlob, { BlobState } from '../../components/ui/GuruBlob';
import GuruWordmark from '../../components/ui/GuruWordmark';
import BlockRenderer, { AgentBlock } from '../../components/Agent/BlockRenderer';
import { openExternalTab } from '../../utils/openExternalTab';
import ExtensionInstallBanner from '../../components/ExtensionInstallBanner';

/**
 * Agentic Guru tab — Journey Pipeline (Epic H, GUR-228).
 * State a goal → the agent plans visible steps → executes them via the
 * existing backend, streaming generative UI blocks → approval gates on every
 * write → outcome tally. Free-form questions answered inline.
 */

const GOALS = [
  { label: 'Catch me up', text: 'Catch me up on my feed', color: '#38BDF8' },
  { label: 'Dive into saved & expert picks', text: 'Dive-in mode: walk me through my saved-for-later queue and expert picks, deep-read style', color: '#EC4899' },
  { label: 'Run my recap', text: 'Run my recap', color: '#FB923C' },
  { label: 'How am I tracking this week?', text: 'How am I tracking against my goals this week?', color: '#34D399' },
  { label: 'What did I learn today?', text: 'Synthesize what I learned today from my reading', color: '#6366F1' },
];

// GUR-231: journey mode — drives the time heartbeat's ring_type. 'progress'
// is a valid journey mode but is NEVER logged (no ring for it).
type JourneyMode = 'catchup' | 'divein' | 'recap' | 'progress';

function classifyGoal(text: string): JourneyMode {
  if (/dive|saved|crux|deep/i.test(text)) return 'divein';
  if (/recap|what did i learn|synthesize/i.test(text)) return 'recap';
  if (/track|progress|ring/i.test(text)) return 'progress';
  return 'catchup';
}

// Persistent mode switcher — always one tap from any mode, never chat-trapped.
const MODES: { label: string; text: string; mode: JourneyMode }[] = [
  { label: 'Catch up', text: 'Switch modes: catch me up on my feed', mode: 'catchup' },
  { label: 'Dive in', text: 'Switch modes: dive into my saved articles and expert picks', mode: 'divein' },
  { label: 'Recap', text: 'Switch modes: run my recap', mode: 'recap' },
  { label: 'Progress', text: 'Switch modes: show my progress and rings', mode: 'progress' },
];

type TurnInput =
  | { type: 'goal' | 'message'; text: string }
  | { type: 'decision'; approval_id: string; approved: boolean };

// R17 (founder): the journey SURVIVES leaving the tab — dive into an article,
// hop to a pillar, even reload the page (web), and you land exactly where you
// left off. Module cache covers in-app navigation on every platform;
// sessionStorage adds web-reload durability. "↺ New goal" is the only reset.
// (The backend already persists the conversation per session_id — this keeps
// the RENDERED journey in sync with it.)
const JOURNEY_KEY = 'guru_agent_journey_v1';
type JourneyPayload = { sessionId: string | null; blocks: AgentBlock[]; nextKey: number; mode: JourneyMode };
let journeyCache: JourneyPayload | null = null;

const VALID_MODES: JourneyMode[] = ['catchup', 'divein', 'recap', 'progress'];

function loadJourney(): JourneyPayload {
  if (journeyCache) return journeyCache;
  try {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(JOURNEY_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j && Array.isArray(j.blocks)) {
          return {
            sessionId: j.sessionId ?? null,
            blocks: j.blocks,
            nextKey: j.nextKey || j.blocks.length + 1,
            mode: VALID_MODES.includes(j.mode) ? j.mode : 'catchup',
          };
        }
      }
    }
  } catch {}
  return { sessionId: null, blocks: [], nextKey: 0, mode: 'catchup' };
}

function saveJourney(sessionId: string | null, blocks: AgentBlock[], nextKey: number, mode: JourneyMode) {
  journeyCache = { sessionId, blocks, nextKey, mode };
  try {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(JOURNEY_KEY, JSON.stringify(journeyCache));
    }
  } catch {}
}

function clearJourney() {
  journeyCache = null;
  try {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(JOURNEY_KEY);
    }
  } catch {}
}

export default function GuruAgentScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const restored = useRef(loadJourney()).current;
  const [blocks, setBlocks] = useState<AgentBlock[]>(restored.blocks);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [blobState, setBlobState] = useState<BlobState>('idle');
  const sessionIdRef = useRef<string | null>(restored.sessionId);
  const scrollRef = useRef<ScrollView>(null);
  const keyRef = useRef(restored.nextKey);
  // GUR-231: journey mode + activity recency for the time heartbeat. Refs, not
  // state — nothing renders off them, and the 60s interval reads them live.
  const modeRef = useRef<JourneyMode>(restored.mode);
  const lastActivityRef = useRef(Date.now());
  const bumpActivity = () => { lastActivityRef.current = Date.now(); };
  // BUG 1 fix (web first-tap swallowed): RN-web's responder system can miss the
  // first press after hydration, so taps get BOTH onPress (responder) and a raw
  // DOM onClick on web. A single real tap fires both, so a shared ref-based
  // 300ms dedupe guarantees the handler runs exactly once per tap.
  const lastPressRef = useRef(0);
  const tapProps = (fn: () => void) => {
    const guarded = () => {
      const now = Date.now();
      if (now - lastPressRef.current < 300) return;
      lastPressRef.current = now;
      fn();
    };
    return {
      onPress: guarded,
      // RN-web View/Pressable forward onClick to the DOM node; no-op on native.
      ...(Platform.OS === 'web' ? ({ onClick: guarded } as any) : {}),
    };
  };
  // BUG 2 fix: only auto-scroll while the user is "pinned" to the bottom
  // (within 120px of the end — default true), and do the scroll in
  // onContentSizeChange (fires after layout) instead of a fragile timeout.
  const pinnedRef = useRef(true);
  const onThreadScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    bumpActivity(); // scrolling the thread counts as engagement (GUR-231)
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
    pinnedRef.current = distanceFromEnd < 120;
  };
  const onThreadContentSizeChange = () => {
    if (pinnedRef.current) scrollRef.current?.scrollToEnd({ animated: false });
  };

  // Persist the rendered journey on every change so leaving + returning
  // resumes in place (R17). `busy` is a dep so the save AFTER a turn completes
  // captures the session_id (it arrives in the final 'done' event, after the
  // last block append).
  React.useEffect(() => {
    saveJourney(sessionIdRef.current, blocks, keyRef.current, modeRef.current);
  }, [blocks, busy]);

  // GUR-231 TASK 1: agent journey time heartbeat. Every 60s, while a journey
  // is on screen (blocks > 0), the app is foreground/visible, and the user was
  // active within the last 2 minutes, log one minute of ring time for the
  // current mode. 'progress' journeys log nothing (no progress ring).
  // Fire-and-forget: a failed beat must never disturb the journey UX.
  const hasJourney = blocks.length > 0;
  React.useEffect(() => {
    if (!hasJourney) return; // entry screen logs nothing
    const id = setInterval(() => {
      try {
        const visible = Platform.OS === 'web'
          ? (typeof document !== 'undefined' && document.visibilityState === 'visible')
          : AppState.currentState === 'active';
        if (!visible) return;
        if (Date.now() - lastActivityRef.current >= 120_000) return; // idle
        const mode = modeRef.current;
        if (mode !== 'catchup' && mode !== 'divein' && mode !== 'recap') return;
        const now = Date.now();
        (async () => {
          const token = await getAuthToken();
          await fetch(`${API_BASE_URL}/metrics/log-time`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ring_type: mode,
              duration_seconds: 60,
              context_id: sessionIdRef.current ?? undefined,
              started_at: new Date(now - 60_000).toISOString(),
              ended_at: new Date(now).toISOString(),
              activity_type: 'agent',
              idle_seconds: 0,
            }),
          });
        })().catch(() => {});
      } catch {}
    }, 60_000);
    return () => clearInterval(id);
  }, [hasJourney]);

  // GUR-231 TASK 2: seeded goals via ?goal=<text> — other surfaces deep-link
  // straight into a journey (e.g. Dive-in's "Build the crux →"). Auto-send
  // exactly once, only onto a fresh thread, then strip the param.
  const params = useLocalSearchParams<{ goal?: string }>();
  const seededGoalRef = useRef(false);
  React.useEffect(() => {
    const raw = params.goal;
    const goal = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
    if (!goal || seededGoalRef.current) return;
    seededGoalRef.current = true;
    // R24: an explicit deep-linked goal supersedes any persisted journey —
    // the user just asked for something specific; "doing nothing" (the old
    // blocks.length guard) read as a broken button.
    if (blocks.length > 0) {
      sessionIdRef.current = null;
      clearJourney();
      setBlocks([]);
      setStatus(null);
    }
    setTimeout(() => onSend(goal), 50);
    try { router.setParams({ goal: undefined } as any); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.goal]);

  const bg = isDark ? '#0A0E17' : '#F8FAFC';
  const tPrim = isDark ? '#F1F5F9' : '#0F172A';
  const tSec = isDark ? '#94A3B8' : '#475569';

  const append = (b: AgentBlock) => {
    keyRef.current += 1;
    const withKey = { ...b, _key: `b${keyRef.current}` };
    setBlocks(prev => [...prev, withKey]);
    // Scrolling happens in the ScrollView's onContentSizeChange (post-layout,
    // pinned-aware) — no timeout race during streamed block bursts.
  };

  const sendTurn = async (turnInput: TurnInput, echo?: string) => {
    if (busy) return;
    setBusy(true);
    setBlobState('thinking');
    setStatus('thinking…');
    if (echo) append({ type: 'user_echo', text: echo });
    let sawOutcome = false;
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE_URL}/agent/turn`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionIdRef.current, input: turnInput }),
      });
      if (!res.ok || !res.body) {
        append({ type: 'text', md: `Hmm, I hit a snag (HTTP ${res.status}). Try again in a moment.` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          bumpActivity(); // any SSE event = the journey is live (GUR-231)
          if (evt.event === 'status') setStatus(evt.text);
          else if (evt.event === 'block') {
            if (evt.block?.type === 'outcome_summary') sawOutcome = true;
            append(evt.block);
          } else if (evt.event === 'done') {
            sessionIdRef.current = evt.session_id || sessionIdRef.current;
          } else if (evt.event === 'error') {
            append({ type: 'text', md: `Something went wrong: ${evt.message}` });
          }
        }
      }
    } catch (e) {
      append({ type: 'text', md: 'Network hiccup — check your connection and try again.' });
    } finally {
      setBusy(false);
      setStatus(null);
      if (sawOutcome) {
        setBlobState('celebrate');
        setTimeout(() => setBlobState('idle'), 1400);
      } else {
        setBlobState('idle');
      }
    }
  };

  const onSend = (text: string) => {
    const t = text.trim();
    if (!t) return;
    bumpActivity();
    setInput('');
    // An explicit user send re-pins the thread so they see their own echo.
    pinnedRef.current = true;
    // A journey STARTS here — classify the goal to set the heartbeat mode.
    if (blocks.length === 0) modeRef.current = classifyGoal(t);
    sendTurn({ type: blocks.length === 0 ? 'goal' : 'message', text: t }, t);
  };

  const onDecision = (approvalId: string, approved: boolean) => {
    bumpActivity();
    setBlocks(prev => prev.map(b =>
      b.type === 'approval' && b.approval_id === approvalId
        ? { ...b, _resolved: approved ? 'approved' : 'declined' }
        : b
    ));
    sendTurn({ type: 'decision', approval_id: approvalId, approved });
  };

  // "Read →" opens the SOURCE in a new tab immediately (same lesson as GUR-221:
  // never strand the user on an intermediary), then the in-app reader for
  // notes/highlights/Q&A via deferred navigation so the popup isn't cancelled.
  const onOpenArticle = (id: string, url?: string) => {
    if (url) openExternalTab(url);
    setTimeout(() => router.push(`/article/${id}?source=guru`), 0);
  };

  const onNewGoal = () => {
    sessionIdRef.current = null;
    modeRef.current = 'catchup'; // mode resets with the journey (GUR-231)
    clearJourney();
    setBlocks([]);
    setStatus(null);
    setBlobState('idle');
  };

  const intentBar = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: 16, marginBottom: 88,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
      borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.10)',
      borderWidth: 1, borderRadius: 24, paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
      ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as any : {}),
    }}>
      <TextInput
        value={input}
        onChangeText={(t) => { bumpActivity(); setInput(t); }}
        onSubmitEditing={() => onSend(input)}
        placeholder={blocks.length === 0 ? '…or type any goal or question' : busy ? 'Interrupt or redirect…' : 'Ask, redirect, or set a new goal…'}
        placeholderTextColor={tSec}
        style={{ flex: 1, color: tPrim, fontSize: 14, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) }}
        accessibilityLabel="Message Guru"
      />
      <Pressable
        {...tapProps(() => onSend(input))}
        disabled={!input.trim() || busy}
        accessibilityRole="button"
        accessibilityLabel="Send"
        style={({ pressed }) => ({
          width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
          backgroundColor: input.trim() && !busy ? '#6366F1' : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: input.trim() && !busy ? '#fff' : tSec, fontSize: 16 }}>↑</Text>
      </Pressable>
    </View>
  );

  // ── Entry state (no journey yet) ──
  if (blocks.length === 0) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 70 }}>
          <View style={{ alignItems: 'center', marginBottom: 26 }}>
            <GuruBlob size={64} state={busy ? 'thinking' : 'idle'} />
            <Text accessibilityRole="header" style={{ color: tPrim, fontSize: 22, fontWeight: '800', marginTop: 20 }}>
              What should we get done?
            </Text>
            <Text style={{ color: tSec, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
              I'll plan it, you approve it — we'll work through it together.
            </Text>
          </View>
          {GOALS.map((g, i) => (
            <Pressable
              key={i}
              {...tapProps(() => onSend(g.text))}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: `${g.color}1F`, borderColor: `${g.color}45`, borderWidth: 1,
                borderRadius: 19, paddingHorizontal: 18, paddingVertical: 14, marginBottom: 12,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: tPrim, fontSize: 14, fontWeight: '600' }}>{g.label}</Text>
              <Text style={{ color: g.color, fontSize: 15, fontWeight: '700' }}>→</Text>
            </Pressable>
          ))}
          {/* First-time users get the widget install path from the agentic
              experience too, not just Home (self-hides once installed). */}
          <View style={{ marginTop: 6 }}>
            <ExtensionInstallBanner />
          </View>
        </ScrollView>
        {intentBar}
      </KeyboardAvoidingView>
    );
  }

  // ── Journey state ──
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: bg }}>
      {/* R13: THE signature lockup — "guru" + living period. The period is
          state-aware: it agitates while the agent works. Status text lives
          solely in the thread's thinking row. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 58, paddingHorizontal: 20, paddingBottom: 12 }}>
        <GuruWordmark size={19} color={tPrim} state={blobState} />
        <View style={{ flex: 1 }} />
        <Pressable
          {...tapProps(onNewGoal)}
          accessibilityRole="button"
          accessibilityLabel="Start a new goal"
          style={({ pressed }) => ({ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)', opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={{ color: tSec, fontSize: 11, fontWeight: '600' }}>↺ New goal</Text>
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        onScroll={onThreadScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onThreadContentSizeChange}
      >
        {blocks.map(b => (
          <BlockRenderer key={b._key} block={b} isDark={isDark} onSend={onSend} onDecision={onDecision} onOpenArticle={onOpenArticle} />
        ))}
        {busy && (
          // R8: the organism itself thinks in the thread — not just a text line
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, marginTop: 2 }}>
            <GuruBlob size={34} state="thinking" />
            <Text style={{ color: tSec, fontSize: 12.5, flex: 1 }}>{status || 'working…'}</Text>
          </View>
        )}
      </ScrollView>
      {/* Persistent mode switcher — escape hatch from any journey, one tap */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, gap: 7 }}>
        {MODES.map((m, i) => (
          <Pressable
            key={i}
            {...tapProps(() => { modeRef.current = m.mode; onSend(m.text); })}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 13, backgroundColor: isDark ? 'rgba(99,102,241,0.10)' : 'rgba(99,102,241,0.07)', borderWidth: 1, borderColor: isDark ? 'rgba(129,140,248,0.22)' : 'rgba(99,102,241,0.18)', opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}
          >
            <Text style={{ color: isDark ? '#A5B4FC' : '#6366F1', fontSize: 11, fontWeight: '600' }}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      {intentBar}
    </KeyboardAvoidingView>
  );
}
