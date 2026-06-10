import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import GuruFormattedText from '../ui/GuruFormattedText';
import { Triskelion } from '../Rings/Triskelion';

/**
 * Renders the agent's generative UI blocks (schema v1 — see
 * docs/agentic-ui-architecture.md). Unknown block types render nothing, so the
 * backend can add types without breaking older clients.
 */
export interface AgentBlock {
  type: string;
  _key?: string;
  _resolved?: 'approved' | 'declined';
  [k: string]: any;
}

interface Props {
  block: AgentBlock;
  isDark: boolean;
  onSend: (text: string) => void;
  onDecision: (approvalId: string, approved: boolean) => void;
  onOpenArticle: (id: string) => void;
}

export default function BlockRenderer({ block, isDark, onSend, onDecision, onOpenArticle }: Props) {
  const tPrim = isDark ? '#F1F5F9' : '#0F172A';
  const tSec = isDark ? '#94A3B8' : '#475569';
  const glass = {
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF',
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  } as const;
  const pill = (bg: string, fg: string) => ({
    backgroundColor: bg, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 14,
    marginRight: 8, marginBottom: 8,
  } as const);
  const pillTxt = (fg: string) => ({ color: fg, fontSize: 12, fontWeight: '600' as const });

  switch (block.type) {
    case 'user_echo':
      return (
        <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: 'rgba(99,102,241,0.20)', borderColor: 'rgba(129,140,248,0.35)', borderWidth: 1, borderRadius: 16, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 10 }}>
          <Text style={{ color: isDark ? '#C7D2FE' : '#4338CA', fontSize: 13.5 }}>{block.text}</Text>
        </View>
      );

    case 'text':
      return (
        <View style={{ marginBottom: 12, maxWidth: '96%' }}>
          <GuruFormattedText text={block.md || ''} color={tPrim} accent="#818CF8" fontSize={14} />
        </View>
      );

    case 'plan': {
      const icon = (s: string) => (s === 'done' ? '✓' : s === 'active' ? '◐' : s === 'skipped' ? '↷' : '○');
      const ic = (s: string) => (s === 'done' ? '#34D399' : s === 'active' ? '#818CF8' : tSec);
      return (
        <View style={[glass, { marginBottom: 12, backgroundColor: isDark ? 'rgba(99,102,241,0.10)' : 'rgba(99,102,241,0.06)', borderColor: 'rgba(129,140,248,0.30)' }]}>
          <Text style={{ color: tPrim, fontWeight: '700', fontSize: 14, marginBottom: 2 }}>{block.goal}</Text>
          {!!block.eta_min && <Text style={{ color: tSec, fontSize: 11, marginBottom: 8 }}>~{block.eta_min} min</Text>}
          {(block.steps || []).map((s: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ color: ic(s.status), width: 20, fontSize: 13, fontWeight: '700' }}>{icon(s.status)}</Text>
              <Text style={{ color: s.status === 'done' ? tSec : tPrim, fontSize: 13, flex: 1, textDecorationLine: s.status === 'skipped' ? 'line-through' : 'none' }}>{s.title}</Text>
              {!!s.eta && <Text style={{ color: tSec, fontSize: 11 }}>{s.eta}</Text>}
            </View>
          ))}
        </View>
      );
    }

    case 'article_card': {
      const acts: string[] = block.actions || ['save', 'skip', 'ask', 'open'];
      return (
        <View style={[glass, { marginBottom: 12 }]}>
          {!!block.commitment_flag && (
            <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(251,146,60,0.15)', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 7 }}>
              <Text style={{ color: '#FB923C', fontSize: 10, fontWeight: '700' }}>⚑ advances your commitment</Text>
            </View>
          )}
          <Text style={{ color: tPrim, fontSize: 15, fontWeight: '700', marginBottom: 3 }}>{block.title}</Text>
          <Text style={{ color: tSec, fontSize: 11, marginBottom: 7 }}>
            {block.source}{block.reading_time ? ` · ${block.reading_time} min` : ''}
          </Text>
          {!!block.summary && <Text style={{ color: tSec, fontSize: 13, lineHeight: 19, marginBottom: 11 }}>{block.summary}</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {acts.includes('save') && (
              <TouchableOpacity style={pill('rgba(52,211,153,0.18)', '#34D399')} onPress={() => onSend(`Save "${block.title}" (article ${block.article_id})`)} accessibilityRole="button">
                <Text style={pillTxt('#34D399')}>Save</Text>
              </TouchableOpacity>
            )}
            {acts.includes('skip') && (
              <TouchableOpacity style={pill(isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', tSec)} onPress={() => onSend('Skip that one — next.')} accessibilityRole="button">
                <Text style={pillTxt(tSec)}>Skip</Text>
              </TouchableOpacity>
            )}
            {acts.includes('ask') && (
              <TouchableOpacity style={pill('rgba(99,102,241,0.18)', '#A5B4FC')} onPress={() => onSend(`What should I take away from "${block.title}" (article ${block.article_id})?`)} accessibilityRole="button">
                <Text style={pillTxt(isDark ? '#A5B4FC' : '#6366F1')}>Ask Guru</Text>
              </TouchableOpacity>
            )}
            {acts.includes('open') && !!block.article_id && (
              <TouchableOpacity style={pill('rgba(56,189,248,0.16)', '#38BDF8')} onPress={() => onOpenArticle(block.article_id)} accessibilityRole="button">
                <Text style={pillTxt('#38BDF8')}>Read →</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    case 'carousel':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {(block.items || []).slice(0, 3).map((item: any, i: number) => (
            <View key={i} style={{ width: 250, marginRight: 10 }}>
              <BlockRenderer block={{ ...item, type: 'article_card' }} isDark={isDark} onSend={onSend} onDecision={onDecision} onOpenArticle={onOpenArticle} />
            </View>
          ))}
        </ScrollView>
      );

    case 'rings':
      return (
        <View style={[glass, { marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
          <Triskelion size={84} progress={{ c: block.c || 0, d: block.d || 0, r: block.r || 0 }} />
          {!!block.caption && <Text style={{ color: tSec, fontSize: 13, flex: 1 }}>{block.caption}</Text>}
        </View>
      );

    case 'stats':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
          {(block.items || []).map((it: any, i: number) => (
            <View key={i} style={[glass, { paddingVertical: 8, paddingHorizontal: 12, marginRight: 8, marginBottom: 8, borderRadius: 12 }]}>
              <Text style={{ color: tPrim, fontWeight: '700', fontSize: 14 }}>{String(it.value)}<Text style={{ color: tSec, fontWeight: '400', fontSize: 11 }}>  {it.label}</Text></Text>
            </View>
          ))}
        </View>
      );

    case 'quote':
      return (
        <View style={{ backgroundColor: 'rgba(251,146,60,0.10)', borderLeftWidth: 3, borderLeftColor: '#FB923C', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: isDark ? '#FCD34D' : '#92400E', fontSize: 13, fontStyle: 'italic' }}>"{block.text}"</Text>
        </View>
      );

    case 'prompt_pills':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
          {(block.prompts || []).map((p: string, i: number) => (
            <TouchableOpacity key={i} style={pill('rgba(99,102,241,0.16)', '#A5B4FC')} onPress={() => onSend(p)} accessibilityRole="button">
              <Text style={pillTxt(isDark ? '#A5B4FC' : '#6366F1')}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      );

    case 'approval':
      return (
        <View style={[glass, { marginBottom: 12, backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)', borderColor: 'rgba(129,140,248,0.40)' }]}>
          <Text style={{ color: '#818CF8', fontSize: 10, fontWeight: '700', marginBottom: 5 }}>APPROVAL NEEDED</Text>
          <Text style={{ color: tPrim, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>{block.title}</Text>
          {(block.detail_lines || []).map((d: string, i: number) => (
            <Text key={i} style={{ color: tSec, fontSize: 12, marginBottom: 2 }}>· {d}</Text>
          ))}
          {block._resolved ? (
            <Text style={{ color: block._resolved === 'approved' ? '#34D399' : tSec, fontSize: 12, fontWeight: '600', marginTop: 8 }}>
              {block._resolved === 'approved' ? '✓ Approved' : 'Kept as is'}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              <TouchableOpacity style={pill('rgba(52,211,153,0.2)', '#34D399')} onPress={() => onDecision(block.approval_id, true)} accessibilityRole="button">
                <Text style={pillTxt('#34D399')}>{block.confirm_label || 'Approve'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={pill(isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', tSec)} onPress={() => onDecision(block.approval_id, false)} accessibilityRole="button">
                <Text style={pillTxt(tSec)}>{block.cancel_label || 'Keep as is'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      );

    case 'outcome_summary':
      return (
        <View style={[glass, { marginBottom: 12, backgroundColor: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.30)' }]}>
          <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '700', marginBottom: 6 }}>JOURNEY OUTCOME</Text>
          {(block.lines || []).map((l: string, i: number) => (
            <Text key={i} style={{ color: tPrim, fontSize: 14, fontWeight: '600', marginBottom: 3 }}>{l}</Text>
          ))}
          {!!block.commitment_line && <Text style={{ color: '#FB923C', fontSize: 12, marginTop: 4 }}>⚑ {block.commitment_line}</Text>}
          {!!block.rings && (
            <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
              <Triskelion size={72} progress={{ c: block.rings.c || 0, d: block.rings.d || 0, r: block.rings.r || 0 }} />
            </View>
          )}
          {!!(block.followups || []).length && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
              {block.followups.map((p: string, i: number) => (
                <TouchableOpacity key={i} style={pill('rgba(99,102,241,0.16)', '#A5B4FC')} onPress={() => onSend(p)} accessibilityRole="button">
                  <Text style={pillTxt(isDark ? '#A5B4FC' : '#6366F1')}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      );

    default:
      return null;
  }
}
