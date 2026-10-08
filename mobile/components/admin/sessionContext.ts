/**
 * The words of a report's Session context card (GUR-277, frame 29:28), as
 * parts the card styles: quiet (the default), strong (what the tester said or
 * saw, the ids) and faint (separators). Pure, so the tests read it without
 * rendering. ReportDetail draws the card.
 *
 * Every field is optional: an older report has none of it. In privacy mode the
 * server sends no text and no titles, so the lines say so and show short ids.
 */
import type {
  ReportClientContext,
  ReportSessionContext,
  ReportSessionItem,
  SessionItemKind,
} from '../../services/admin-service';
import { reportScreenLabel } from '../../services/report-context';

export interface Part {
  text: string;
  tone?: 'strong' | 'faint';
}

/** The kinds in the order the counts read. */
export const SESSION_KINDS: SessionItemKind[] = ['recap_answer', 'save', 'question', 'note', 'highlight', 'agent_turn'];

/** The activity tag: the kind's name and its icon (components/ui/Icon names, Phosphor bold). */
const KIND_META: Record<SessionItemKind, { label: string; icon: string }> = {
  recap_answer: { label: 'Recap answer', icon: 'feather' },
  save: { label: 'Save', icon: 'bookmark-outline' },
  question: { label: 'Question', icon: 'chat-question-outline' },
  note: { label: 'Note', icon: 'note-edit-outline' },
  highlight: { label: 'Highlight', icon: 'highlighter' },
  agent_turn: { label: 'Agent turn', icon: 'pulse' },
};

/** "note" -> Note with the note pencil. A kind this build doesn't know reads as sent, with no icon. */
export function kindMeta(kind: string | null | undefined): { label: string; icon: string | null } {
  const known = kind ? (KIND_META as Record<string, { label: string; icon: string }>)[kind] : undefined;
  if (known) return known;
  return { label: capitalize((kind || 'activity').replace(/_+/g, ' ').trim()), icon: null };
}

/** What privacy mode shows instead of the tester's words. */
export const NOT_KEPT = 'text not kept';

// ─── Screens, newest first ───────────────────────────────────────────────

export interface TrailStop {
  label: string;
  at: string | null;
}

/** The trail as labels, newest first: "Recap · stage 3", "Home". With no trail, the screen the report came from. */
export function trailStops(client: ReportClientContext | null | undefined): TrailStop[] {
  const trail = Array.isArray(client?.trail) ? client.trail : [];
  const stops = trail
    .filter((t) => !!t && !!t.screen)
    .map((t) => ({ label: reportScreenLabel(t.screen, t.step), at: t.at ?? null }));
  if (stops.length === 0 && client?.screen) return [{ label: reportScreenLabel(client.screen, client.step), at: null }];
  return stops;
}

// ─── On screen ───────────────────────────────────────────────────────────

/** "Recap journey 3f2a91c0  ·  article “The quiet return of the chip makers”". Empty when nothing was on screen. */
export function onScreenParts(client: ReportClientContext | null | undefined): Part[] {
  const on = client?.on_screen;
  if (!on) return [];
  const groups: Part[][] = [];
  if (on.recap_journey_id) groups.push([{ text: 'Recap journey ' }, { text: shortId(on.recap_journey_id), tone: 'strong' }]);
  const title = clean(on.article_title);
  if (title) groups.push([{ text: 'article ' }, { text: quoted(title), tone: 'strong' }]);
  else if (on.article_id) groups.push([{ text: 'article ' }, { text: shortId(on.article_id), tone: 'strong' }]);
  if (on.trace_id) groups.push([{ text: 'turn ' }, { text: shortId(on.trace_id), tone: 'strong' }]);
  const parts: Part[] = [];
  groups.forEach((group, i) => {
    if (i > 0) parts.push({ text: '  ·  ', tone: 'faint' });
    parts.push(...group);
  });
  if (parts.length > 0) parts[0] = { ...parts[0], text: capitalize(parts[0].text) };
  return parts;
}

// ─── Failed calls ────────────────────────────────────────────────────────

/** The status tag: the code, or "No answer" for status 0. */
export function callStatusLabel(status: number | null | undefined): string {
  return typeof status === 'number' && status > 0 ? String(status) : 'No answer';
}

// ─── Activity ────────────────────────────────────────────────────────────

/**
 * One activity line, after the frame:
 *   recap_answer  "Stage 2, answer 3 of 3: “...”"
 *   save          "Saved “title”" and the detail, if any
 *   question      "On “title”: “...”"
 *   note          "Note on “title”: “...”"
 *   highlight     "Highlight on “title”: “...”"
 *   agent_turn    "Asked “...”  ·  4 blocks"
 * In privacy mode the text becomes "text not kept" and a title the article's short id.
 */
export function activityParts(item: ReportSessionItem, privacy: boolean): Part[] {
  const text = privacy ? null : clean(item.text);
  const title = privacy ? null : clean(item.article_title);
  const detail = clean(item.detail);
  const article = title ? quoted(title) : item.article_id ? `article ${shortId(item.article_id)}` : null;
  // The detail after a dot, in the line's quiet tone (frame: "Asked “...”  ·  4 blocks").
  const tail: Part[] = detail ? [{ text: '  ·  ' }, { text: detail }] : [];

  // "<lead>: “text”", or "<lead>, text not kept" in privacy mode, or the lead alone when nothing was typed.
  const said = (lead: string): Part[] => {
    if (text) return [{ text: `${lead}: ` }, { text: quoted(text), tone: 'strong' }];
    return [{ text: privacy ? `${lead}, ${NOT_KEPT}` : lead }];
  };

  switch (item.kind) {
    case 'recap_answer':
      return said(detail ? capitalize(detail) : 'Recap answer');
    case 'save': {
      const saved: Part[] = title
        ? [{ text: 'Saved ' }, { text: quoted(title), tone: 'strong' }]
        : [{ text: article ? `Saved ${article}` : 'Saved an article' }];
      return detail ? [...saved, { text: ` ${detail}` }] : saved;
    }
    case 'question':
      return [...said(article ? (text ? `On ${article}` : `Question on ${article}`) : 'Question'), ...tail];
    case 'note':
      return [...said(article ? `Note on ${article}` : 'Note'), ...tail];
    case 'highlight':
      return [...said(article ? `Highlight on ${article}` : 'Highlight'), ...tail];
    case 'agent_turn':
      if (text) return [{ text: 'Asked ' }, { text: quoted(text), tone: 'strong' }, ...tail];
      return [{ text: privacy ? `Asked, ${NOT_KEPT}` : 'A turn' }, ...tail];
    default:
      return text ? [{ text: quoted(text), tone: 'strong' }, ...tail] : tail.slice(1);
  }
}

/** Privacy mode: how many of each kind, for the kinds that happened. */
export function kindCounts(session: ReportSessionContext | null | undefined): { kind: SessionItemKind; count: number }[] {
  const counts = session?.counts;
  if (!counts) return [];
  return SESSION_KINDS.map((kind) => ({ kind, count: counts[kind] ?? 0 })).filter(
    (c) => typeof c.count === 'number' && Number.isFinite(c.count) && c.count > 0,
  );
}

// ─── Time ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local time: "8:39 PM" today, "Oct 6, 8:39 PM" before. With seconds for a failed call: "8:40:58 PM". */
export function fmtLocalTime(iso: string | null | undefined, withSeconds = false): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = withSeconds ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
  const clock = `${hour12}:${mm}${ss} ${h < 12 ? 'AM' : 'PM'}`;
  return d.toDateString() === new Date().toDateString() ? clock : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** The first 8 characters of an id, as the admin views show ids. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function quoted(text: string): string {
  return `“${text}”`;
}

/** One line: runs of whitespace, newlines included, become one space. Empty becomes null. */
function clean(value: string | null | undefined): string | null {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
