import React from 'react';
import { View, Text, TextStyle } from 'react-native';

export interface ParsedGuruResponse {
  /** Human-readable answer text — never raw JSON braces/keys. */
  response: string;
  /** Follow-up question suggestions extracted from a JSON wrapper, if any. */
  followups: string[];
}

const TEXT_KEYS = ['response', 'answer', 'text', 'content', 'message', 'reply'] as const;
const FOLLOWUP_KEYS = ['followups', 'follow_ups', 'followUps', 'follow_up_prompts', 'suggestions'] as const;

const unescapeText = (s: string): string =>
  s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').trim();

/**
 * Tolerant parser for Ask Guru / Socratic model output. The model sometimes
 * returns its raw `{"response": "...", "followups": [...]}` JSON verbatim
 * (optionally wrapped in a ```json fence, with prose around it, truncated, or
 * double-escaped). Strategy: strip fences → locate the outermost {...} →
 * JSON.parse → on failure regex-extract "response":"..." → last-resort scrub
 * of braces/keys. Raw JSON must NEVER reach the user.
 */
export function parseGuruResponse(raw: unknown): ParsedGuruResponse {
  if (raw == null) return { response: '', followups: [] };

  // Already-parsed object (backend occasionally forwards the model object).
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const resp = TEXT_KEYS.map(k => obj[k]).find(v => typeof v === 'string' && v.trim()) as string | undefined;
    const fuRaw = FOLLOWUP_KEYS.map(k => obj[k]).find(v => Array.isArray(v)) as unknown[] | undefined;
    const followups = (fuRaw || []).filter((f): f is string => typeof f === 'string' && !!f.trim());
    if (resp) return { response: unescapeText(resp), followups };
    return { response: '', followups };
  }

  let t = String(raw).trim();
  if (!t) return { response: '', followups: [] };

  // Unwrap a ```json … ``` code fence anywhere in the text, then drop any
  // stray/unterminated fence markers that survive.
  const fence = t.match(/```(?:json|markdown|md)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1].trim()) t = fence[1].trim();
  t = t.replace(/```(?:json|markdown|md)?/gi, '').trim();

  // A bare JSON string ("...").
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      const p = JSON.parse(t);
      if (typeof p === 'string') return { response: p.trim(), followups: [] };
    } catch { /* fall through */ }
  }

  // Locate the outermost {...}; only treat as a wrapper if a known text key
  // appears (so prose that merely contains braces is untouched).
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  const hasTextKey = new RegExp(`"(?:${TEXT_KEYS.join('|')})"\\s*:`).test(t);
  // Truncated wrapper: starts with `{"response": ...` but the closing `}` was cut off.
  const candidate =
    first !== -1 && last > first ? t.slice(first, last + 1)
    : hasTextKey && first !== -1 ? t.slice(first)
    : null;

  if (hasTextKey && candidate) {
    // 1) Strict parse of the outermost object.
    try {
      const parsed = JSON.parse(candidate);
      const fromObj = parseGuruResponse(parsed);
      if (fromObj.response) return fromObj;
    } catch { /* fall through to regex extraction */ }

    // 2) Regex extraction — survives truncated / mildly malformed JSON.
    const m = candidate.match(new RegExp(`"(?:${TEXT_KEYS.join('|')})"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (m && m[1].trim()) {
      const followups: string[] = [];
      const fuBlock = candidate.match(new RegExp(`"(?:${FOLLOWUP_KEYS.join('|')})"\\s*:\\s*\\[([\\s\\S]*?)(?:\\]|$)`));
      if (fuBlock) {
        const re = /"((?:[^"\\]|\\.)+)"/g;
        let fm: RegExpExecArray | null;
        while ((fm = re.exec(fuBlock[1])) !== null) followups.push(unescapeText(fm[1]));
      }
      return { response: unescapeText(m[1]), followups };
    }

    // 3) Last resort: scrub JSON punctuation/keys so braces never reach the user.
    const scrubbed = candidate
      .replace(new RegExp(`"(?:${FOLLOWUP_KEYS.join('|')})"\\s*:\\s*\\[[\\s\\S]*?(?:\\]|$)`, 'gi'), '')
      .replace(/"[A-Za-z0-9_]+"\s*:/g, '')
      .replace(/[{}[\]]/g, '')
      .replace(/^[\s",:]+|[\s",:]+$/g, '');
    if (scrubbed) return { response: unescapeText(scrubbed), followups: [] };
  }

  return { response: unescapeText(t), followups: [] };
}

/**
 * Normalise an Ask Guru / Socratic response into clean display text.
 * Thin wrapper over parseGuruResponse (which also surfaces followups).
 */
export function cleanGuruResponse(raw: string): string {
  return parseGuruResponse(raw).response;
}

function renderInline(text: string, baseStyle: TextStyle, keyPrefix: string) {
  // Split on **bold** and *italic* spans, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <Text key={`${keyPrefix}-${i}`} style={[baseStyle, { fontWeight: '700' }]}>{bold[1]}</Text>;
    const italic = p.match(/^\*([^*]+)\*$/);
    if (italic) return <Text key={`${keyPrefix}-${i}`} style={[baseStyle, { fontStyle: 'italic' }]}>{italic[1]}</Text>;
    const code = p.match(/^`([^`]+)`$/);
    if (code) return <Text key={`${keyPrefix}-${i}`} style={[baseStyle, { fontFamily: 'monospace' }]}>{code[1]}</Text>;
    return <Text key={`${keyPrefix}-${i}`} style={baseStyle}>{p}</Text>;
  });
}

interface Props {
  text: string;
  color: string;
  /** Accent for bullets / numbers (defaults to text color). */
  accent?: string;
  fontSize?: number;
}

/**
 * Lightweight markdown renderer for Guru chat responses: paragraphs, blank-line
 * spacing, bold / italic / inline-code, dash and bullet lists, numbered lists,
 * and headings. No external dependency.
 */
export default function GuruFormattedText({ text, color, accent, fontSize = 14 }: Props) {
  const clean = cleanGuruResponse(text);
  const lines = clean.split('\n');
  const base: TextStyle = { color, fontSize, lineHeight: Math.round(fontSize * 1.45) };
  const markColor = accent || color;

  return (
    <View>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 7 }} />;

        const header = trimmed.match(/^#{1,4}\s+(.*)$/);
        if (header) {
          return (
            <Text key={i} style={{ color, fontSize: fontSize + 1, fontWeight: '700', lineHeight: Math.round((fontSize + 1) * 1.45), marginBottom: 4, marginTop: i ? 4 : 0 }}>
              {renderInline(header[1], { color, fontSize: fontSize + 1, fontWeight: '700' }, `h${i}`)}
            </Text>
          );
        }

        const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 4, paddingLeft: 2 }}>
              <Text style={{ color: markColor, fontSize, lineHeight: base.lineHeight, marginRight: 8 }}>•</Text>
              <Text style={[base, { flex: 1 }]}>{renderInline(bullet[1], base, `b${i}`)}</Text>
            </View>
          );
        }

        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 4, paddingLeft: 2 }}>
              <Text style={{ color: markColor, fontSize, lineHeight: base.lineHeight, marginRight: 8, fontWeight: '700' }}>{numbered[1]}.</Text>
              <Text style={[base, { flex: 1 }]}>{renderInline(numbered[2], base, `n${i}`)}</Text>
            </View>
          );
        }

        return (
          <Text key={i} style={[base, { marginBottom: 6 }]}>
            {renderInline(trimmed, base, `p${i}`)}
          </Text>
        );
      })}
    </View>
  );
}
