/**
 * The words of the admin's Session context card (GUR-277, frame 29:28): the
 * trail, what was on screen, the failed calls and the tester's activity, in
 * full text and in privacy mode. Pure helpers, so nothing renders.
 */
import { describe, expect, it } from '@jest/globals';
import type { ReportSessionItem } from '../../services/admin-service';
import {
  Part,
  activityParts,
  callStatusLabel,
  fmtLocalTime,
  kindCounts,
  kindMeta,
  onScreenParts,
  trailStops,
} from '../../components/admin/sessionContext';

const ARTICLE = '7c41e09b-aaaa-4bbb-8ccc-ddddeeeeffff';
const JOURNEY = '3f2a91c0-1111-4222-8333-444455556666';
const TRACE = '9d8c7b6a-1111-4222-8333-444455556666';

/** The line as it reads, with the strong parts in [brackets]. */
function read(parts: Part[]): string {
  return parts.map((p) => (p.tone === 'strong' ? `[${p.text}]` : p.text)).join('');
}

function item(over: Partial<ReportSessionItem>): ReportSessionItem {
  return {
    kind: 'note',
    at: '2026-10-07T20:24:00Z',
    text: null,
    article_id: null,
    article_title: null,
    trace_id: null,
    detail: null,
    ...over,
  };
}

describe('the Session context card', () => {
  it('reads the trail newest first with its labels', () => {
    const stops = trailStops({
      screen: 'recap',
      step: 'stage-3',
      trail: [
        { screen: 'recap', step: 'stage-3', at: '2026-10-07T20:41:00Z' },
        { screen: 'recap', step: 'stage-2', at: '2026-10-07T20:38:00Z' },
        { screen: 'home', step: null, at: '2026-10-07T20:30:00Z' },
        { screen: 'catchup', at: '2026-10-07T20:12:00Z' },
      ],
    });
    expect(stops.map((s) => s.label)).toEqual(['Recap · stage 3', 'Recap · stage 2', 'Home', 'Catch up']);
    expect(stops[0].at).toBe('2026-10-07T20:41:00Z');
    // No trail: the screen the report came from, without a time.
    expect(trailStops({ screen: 'divein', trail: [] })).toEqual([{ label: 'Dive in', at: null }]);
    expect(trailStops(null)).toEqual([]);
  });

  it('reads what was on screen, with the title when the server found one', () => {
    expect(
      read(
        onScreenParts({
          on_screen: {
            recap_journey_id: JOURNEY,
            article_id: ARTICLE,
            article_title: 'The quiet return of the chip makers',
            trace_id: null,
          },
        }),
      ),
    ).toBe('Recap journey [3f2a91c0]  ·  article [“The quiet return of the chip makers”]');
    // Privacy mode: no title, the article's short id instead.
    expect(read(onScreenParts({ on_screen: { article_id: ARTICLE, article_title: null } }))).toBe('Article [7c41e09b]');
    expect(read(onScreenParts({ on_screen: { trace_id: TRACE } }))).toBe('Turn [9d8c7b6a]');
    expect(onScreenParts({ on_screen: { article_id: null, recap_journey_id: null, trace_id: null } })).toEqual([]);
    expect(onScreenParts(null)).toEqual([]);
  });

  it('names a failed call by its status, or "No answer"', () => {
    expect(callStatusLabel(500)).toBe('500');
    expect(callStatusLabel(0)).toBe('No answer');
    expect(callStatusLabel(null)).toBe('No answer');
  });

  it("reads each kind of activity in the frame's words", () => {
    const title = 'The quiet return of the chip makers';
    expect(
      read(activityParts(item({ kind: 'recap_answer', detail: 'stage 2, answer 3 of 3', text: "They're building closer to home." }), false)),
    ).toBe("Stage 2, answer 3 of 3: [“They're building closer to home.”]");
    expect(read(activityParts(item({ kind: 'save', article_id: ARTICLE, article_title: title, detail: 'from Catch up' }), false))).toBe(
      `Saved [“${title}”] from Catch up`,
    );
    expect(read(activityParts(item({ kind: 'question', article_id: ARTICLE, article_title: title, text: 'Same story as last week?' }), false))).toBe(
      `On “${title}”: [“Same story as last week?”]`,
    );
    expect(read(activityParts(item({ kind: 'note', article_title: 'Agents at work', text: 'this contradicts\nthe earlier piece' }), false))).toBe(
      'Note on “Agents at work”: [“this contradicts the earlier piece”]',
    );
    expect(read(activityParts(item({ kind: 'highlight', article_title: 'Agents at work', text: 'most agents still wait' }), false))).toBe(
      'Highlight on “Agents at work”: [“most agents still wait”]',
    );
    expect(read(activityParts(item({ kind: 'agent_turn', text: 'Catch me up on chips', detail: '4 blocks', trace_id: TRACE }), false))).toBe(
      'Asked [“Catch me up on chips”]  ·  4 blocks',
    );
  });

  it('says "text not kept" in privacy mode and shows short ids, never text or titles', () => {
    const lines = [
      item({ kind: 'recap_answer', detail: 'stage 2, answer 3 of 3', text: 'secret answer' }),
      item({ kind: 'save', article_id: ARTICLE, article_title: 'Secret title' }),
      item({ kind: 'question', article_id: ARTICLE, text: 'secret question' }),
      item({ kind: 'note', article_id: ARTICLE, text: 'secret note' }),
      item({ kind: 'highlight', article_id: ARTICLE }),
      item({ kind: 'agent_turn', detail: '4 blocks', trace_id: TRACE, text: 'secret ask' }),
    ].map((i) => read(activityParts(i, true)));

    expect(lines).toEqual([
      'Stage 2, answer 3 of 3, text not kept',
      'Saved article 7c41e09b',
      'Question on article 7c41e09b, text not kept',
      'Note on article 7c41e09b, text not kept',
      'Highlight on article 7c41e09b, text not kept',
      'Asked, text not kept  ·  4 blocks',
    ]);
    expect(lines.join(' ')).not.toMatch(/secret/i);
  });

  it('counts each kind that happened, in a fixed order', () => {
    expect(
      kindCounts({ counts: { note: 2, save: 0, agent_turn: 1, recap_answer: 0, question: 0, highlight: 3 } }),
    ).toEqual([
      { kind: 'note', count: 2 },
      { kind: 'highlight', count: 3 },
      { kind: 'agent_turn', count: 1 },
    ]);
    expect(kindCounts({ counts: null })).toEqual([]);
  });

  it('names each kind with its icon, and an unknown kind as sent', () => {
    expect(kindMeta('recap_answer')).toEqual({ label: 'Recap answer', icon: 'feather' });
    expect(kindMeta('highlight')).toEqual({ label: 'Highlight', icon: 'highlighter' });
    expect(kindMeta('agent_turn')).toEqual({ label: 'Agent turn', icon: 'pulse' });
    expect(kindMeta('poll_vote')).toEqual({ label: 'Poll vote', icon: null });
  });

  it('shows the local time, with seconds for a failed call', () => {
    const now = new Date();
    now.setHours(20, 40, 58, 0);
    expect(fmtLocalTime(now.toISOString(), true)).toBe('8:40:58 PM');
    expect(fmtLocalTime(now.toISOString())).toBe('8:40 PM');
    expect(fmtLocalTime('2020-01-05T09:05:00')).toBe('Jan 5, 9:05 AM');
    expect(fmtLocalTime(null)).toBeNull();
    expect(fmtLocalTime('not a time')).toBeNull();
  });
});
