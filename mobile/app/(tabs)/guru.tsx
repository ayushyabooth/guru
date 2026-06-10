import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { useTheme } from '../../contexts/ThemeContext';
import GuruBlob, { BlobState } from '../../components/ui/GuruBlob';
import BlockRenderer, { AgentBlock } from '../../components/Agent/BlockRenderer';
import { openExternalTab } from '../../utils/openExternalTab';

/**
 * Agentic Guru tab — Journey Pipeline (Epic H, GUR-228).
 * State a goal → the agent plans visible steps → executes them via the
 * existing backend, streaming generative UI blocks → approval gates on every
 * write → outcome tally. Free-form questions answered inline.
 */

const GOALS = [
  { label: 'Catch me up', text: 'Catch me up on my feed', color: '#38BDF8' },
  { label: 'Dive into saved & expert picks', text: 'Dive-in mode: walk me through my saved-for-later queue and expert picks, deep-read style', color: '#EC4899' },
  { label: 'Run my weekly recap', text: 'Run my weekly recap', color: '#FB923C' },
  { label: 'How am I tracking this week?', text: 'How am I tracking against my goals this week?', color: '#34D399' },
  { label: 'What did I learn this week?', text: 'Synthesize what I learned this week from my reading', color: '#6366F1' },
];

// Persistent mode switcher — always one tap from any mode, never chat-trapped.
const MODES = [
  { label: 'Catch up', text: 'Switch modes: catch me up on my feed' },
  { label: 'Dive in', text: 'Switch modes: dive into my saved articles and expert picks' },
  { label: 'Recap', text: 'Switch modes: run my weekly recap' },
  { label: 'Progress', text: 'Switch modes: show my progress and rings' },
];

type TurnInput =
  | { type: 'goal' | 'message'; text: string }
  | { type: 'decision'; approval_id: string; approved: boolean };

export default function GuruAgentScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [blobState, setBlobState] = useState<BlobState>('idle');
  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const keyRef = useRef(0);

  const bg = isDark ? '#0A0E17' : '#F8FAFC';
  const tPrim = isDark ? '#F1F5F9' : '#0F172A';
  const tSec = isDark ? '#94A3B8' : '#475569';

  const append = (b: AgentBlock) => {
    keyRef.current += 1;
    const withKey = { ...b, _key: `b${keyRef.current}` };
    setBlocks(prev => [...prev, withKey]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
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
    setInput('');
    sendTurn({ type: blocks.length === 0 ? 'goal' : 'message', text: t }, t);
  };

  const onDecision = (approvalId: string, approved: boolean) => {
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
        onChangeText={setInput}
        onSubmitEditing={() => onSend(input)}
        placeholder={blocks.length === 0 ? '…or type any goal or question' : busy ? 'Interrupt or redirect…' : 'Ask, redirect, or set a new goal…'}
        placeholderTextColor={tSec}
        style={{ flex: 1, color: tPrim, fontSize: 14, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) }}
        accessibilityLabel="Message Guru"
      />
      <TouchableOpacity
        onPress={() => onSend(input)}
        disabled={!input.trim() || busy}
        accessibilityRole="button"
        accessibilityLabel="Send"
        style={{
          width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
          backgroundColor: input.trim() && !busy ? '#6366F1' : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'),
        }}
      >
        <Text style={{ color: input.trim() && !busy ? '#fff' : tSec, fontSize: 16 }}>↑</Text>
      </TouchableOpacity>
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
            <TouchableOpacity
              key={i}
              onPress={() => onSend(g.text)}
              accessibilityRole="button"
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: `${g.color}1F`, borderColor: `${g.color}45`, borderWidth: 1,
                borderRadius: 19, paddingHorizontal: 18, paddingVertical: 14, marginBottom: 12,
              }}
            >
              <Text style={{ color: tPrim, fontSize: 14, fontWeight: '600' }}>{g.label}</Text>
              <Text style={{ color: g.color, fontSize: 15, fontWeight: '700' }}>→</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {intentBar}
      </KeyboardAvoidingView>
    );
  }

  // ── Journey state ──
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 58, paddingHorizontal: 20, paddingBottom: 12 }}>
        <GuruBlob size={26} state={blobState} />
        <Text style={{ color: tPrim, fontSize: 16, fontWeight: '700' }}>Guru</Text>
        {!!status && <Text style={{ color: tSec, fontSize: 11, flex: 1 }} numberOfLines={1}>⏺ {status}</Text>}
        {!status && <View style={{ flex: 1 }} />}
        <TouchableOpacity
          onPress={onNewGoal}
          accessibilityRole="button"
          accessibilityLabel="Start a new goal"
          style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)' }}
        >
          <Text style={{ color: tSec, fontSize: 11, fontWeight: '600' }}>↺ New goal</Text>
        </TouchableOpacity>
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {blocks.map(b => (
          <BlockRenderer key={b._key} block={b} isDark={isDark} onSend={onSend} onDecision={onDecision} onOpenArticle={onOpenArticle} />
        ))}
        {busy && (
          <Text style={{ color: tSec, fontSize: 12, marginBottom: 10 }}>⏺ {status || 'working…'}</Text>
        )}
      </ScrollView>
      {/* Persistent mode switcher — escape hatch from any journey, one tap */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, gap: 7 }}>
        {MODES.map((m, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => onSend(m.text)}
            disabled={busy}
            accessibilityRole="button"
            style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 13, backgroundColor: isDark ? 'rgba(99,102,241,0.10)' : 'rgba(99,102,241,0.07)', borderWidth: 1, borderColor: isDark ? 'rgba(129,140,248,0.22)' : 'rgba(99,102,241,0.18)', opacity: busy ? 0.5 : 1 }}
          >
            <Text style={{ color: isDark ? '#A5B4FC' : '#6366F1', fontSize: 11, fontWeight: '600' }}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {intentBar}
    </KeyboardAvoidingView>
  );
}
