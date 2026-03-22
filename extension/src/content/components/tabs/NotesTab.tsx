import { h } from 'preact';
import { highlights } from '../../state';

export default function NotesTab() {
  const items = highlights.value;

  if (items.length === 0) {
    return (
      <div class="guru-loading" style={{ flexDirection: 'column', gap: '8px' }}>
        <div>No notes yet.</div>
        <div style={{ fontSize: '12px', color: '#94A3B8' }}>
          Select text on the article to highlight and add notes.
        </div>
      </div>
    );
  }

  return (
    <div>
      {items.map((item, i) => (
        <div key={i} class="guru-section" style={{
          background: '#FFFBEB',
          padding: '10px 14px',
          borderRadius: '8px',
          borderLeft: '3px solid #F59E0B',
        }}>
          <div class="guru-section-text" style={{ fontStyle: 'italic' }}>
            "{item.text}"
          </div>
          {item.note && (
            <div style={{ marginTop: '6px', fontSize: '13px', color: '#64748B' }}>
              {item.note}
            </div>
          )}
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#94A3B8' }}>
            {item.timestamp}
          </div>
        </div>
      ))}
    </div>
  );
}
