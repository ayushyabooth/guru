import { h } from 'preact';
import { annotations } from '../../state';
import { ANNOTATION_COLORS } from '../../../shared/constants';

export default function InsightsTab() {
  const anns = annotations.value;

  if (anns.length === 0) {
    return <div class="guru-loading">No insights generated yet.</div>;
  }

  return (
    <div>
      {anns.map((ann) => {
        const color = ANNOTATION_COLORS[ann.type] || '#6366F1';
        return (
          <div key={ann.id} class="guru-section" style={{
            borderLeft: `3px solid ${color}`,
            paddingLeft: '12px',
          }}>
            <div class="guru-peek-card-type" style={{ color, marginBottom: '4px' }}>
              {ann.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
            </div>
            <div class="guru-section-text">{ann.text}</div>
          </div>
        );
      })}
    </div>
  );
}
