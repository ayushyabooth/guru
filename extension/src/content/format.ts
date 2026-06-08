/**
 * Normalise + lightly format Guru / Socratic chat responses for the extension
 * panel. The model sometimes wraps answers in a ```json fence or JSON object,
 * or the transport double-escapes newlines — which leaked literal "\n" and
 * "json" into the chat bubble. Clean that up and render basic markdown.
 */
export function cleanGuruResponse(raw: string): string {
  if (!raw) return '';
  let t = String(raw).trim();

  const fence = t.match(/```(?:json|markdown|md)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();

  if ((t.startsWith('{') && t.includes('"response"')) || (t.startsWith('"') && t.endsWith('"'))) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'string') t = parsed;
      else if (parsed && typeof parsed === 'object') {
        t = parsed.response || parsed.answer || parsed.text || parsed.content ||
            parsed.message || parsed.reply || t;
      }
    } catch {
      // Malformed/truncated JSON — extract the "response" value directly.
      const m = t.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) t = m[1];
    }
  }

  t = t.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  return t.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert a cleaned Guru response to safe HTML: escapes first (no XSS), then
 * applies bold / italic / inline-code, bullet + numbered lists, and paragraph
 * spacing. Returned string is meant for dangerouslySetInnerHTML inside the
 * extension's shadow DOM.
 */
export function guruMarkdownToHtml(raw: string): string {
  const cleaned = escapeHtml(cleanGuruResponse(raw));
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  return cleaned
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '<div style="height:6px"></div>';
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bullet) return `<div class="guru-md-li">• ${inline(bullet[1])}</div>`;
      const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
      if (numbered) return `<div class="guru-md-li"><strong>${numbered[1]}.</strong> ${inline(numbered[2])}</div>`;
      const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
      if (heading) return `<div class="guru-md-h">${inline(heading[1])}</div>`;
      return `<div class="guru-md-p">${inline(line)}</div>`;
    })
    .join('');
}
