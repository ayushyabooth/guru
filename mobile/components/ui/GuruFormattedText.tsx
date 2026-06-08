import React from 'react';
import { View, Text, TextStyle } from 'react-native';

/**
 * Normalise an Ask Guru / Socratic response into clean display text.
 * The model sometimes wraps its answer in a ```json fence or a JSON object, or
 * the transport double-escapes newlines — which leaked literal "\n" and "json"
 * into the chat bubble. Unwrap fences, extract the text field from a JSON
 * wrapper, and turn escaped whitespace into real whitespace.
 */
export function cleanGuruResponse(raw: string): string {
  if (!raw) return '';
  let t = String(raw).trim();

  // Unwrap a ```json … ``` code fence anywhere in the text.
  const fence = t.match(/```(?:json|markdown|md)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();

  // If it looks like a JSON wrapper, pull out the human-readable field.
  if ((t.startsWith('{') && t.includes('"response"')) || (t.startsWith('"') && t.endsWith('"'))) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'string') {
        t = parsed;
      } else if (parsed && typeof parsed === 'object') {
        t = parsed.response || parsed.answer || parsed.text || parsed.content ||
            parsed.message || parsed.reply || t;
      }
    } catch {
      // Malformed JSON (e.g. truncated, or a stray "{" before a fence) — grab
      // the "response" string value directly so raw JSON never reaches the user.
      const m = t.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) t = m[1];
    }
  }

  // Convert escaped whitespace/quotes into real characters.
  t = t.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  return t.trim();
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
