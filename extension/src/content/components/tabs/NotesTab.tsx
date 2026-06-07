import { h } from 'preact';
import { highlights } from '../../state';

const subhead = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase' as const,
  color: '#94A3B8',
  margin: '0 0 8px 2px',
};

const time = { marginTop: '4px', fontSize: '11px', color: '#94A3B8' };

export default function NotesTab() {
  const items = highlights.value;
  // Pure notes are stored with placeholder text "Note"; everything else is a
  // real text highlight (which may also carry an attached note).
  const highlightItems = items.filter((i) => i.text && i.text !== 'Note');
  const noteItems = items.filter((i) => i.text === 'Note' && i.note);

  if (items.length === 0) {
    return (
      <div class="guru-loading" style={{ flexDirection: 'column', gap: '8px' }}>
        <div>No highlights or notes yet.</div>
        <div style={{ fontSize: '12px', color: '#94A3B8' }}>
          Select text on the article to highlight, or add a note.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Highlights ── */}
      {highlightItems.length > 0 && (
        <div style={{ marginBottom: '18px' }}>
          <div style={subhead}>Highlights</div>
          {highlightItems.map((item, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(245,158,11,0.10)',
                padding: '10px 14px',
                borderRadius: '10px',
                borderLeft: '3px solid #F59E0B',
                marginBottom: '8px',
              }}
            >
              <div style={{ fontStyle: 'italic', lineHeight: 1.5 }}>“{item.text}”</div>
              {item.note && (
                <div style={{ marginTop: '6px', fontSize: '13px', color: '#64748B' }}>{item.note}</div>
              )}
              <div style={time}>{item.timestamp}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Notes ── (clearly separated from highlights) */}
      {noteItems.length > 0 && (
        <div>
          <div style={subhead}>Notes</div>
          {noteItems.map((item, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(99,102,241,0.10)',
                padding: '10px 14px',
                borderRadius: '10px',
                borderLeft: '3px solid #6366F1',
                marginBottom: '8px',
              }}
            >
              <div style={{ lineHeight: 1.5 }}>{item.note}</div>
              <div style={time}>{item.timestamp}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
