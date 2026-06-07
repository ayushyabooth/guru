import { h } from 'preact';
import { ANNOTATION_COLORS } from '../../shared/constants';
import type { Annotation } from '../../shared/types';

interface PeekCardProps {
  annotation: Annotation;
  /** Drives the slide-in/out transition. Owned by the parent so it can
   *  orchestrate a clean out-then-in swap when one card replaces another. */
  visible: boolean;
  onTap: () => void;
}

/**
 * Presentational peek card. All lifecycle (enter/exit timing, auto-dismiss,
 * scroll-away dismiss, and the one-at-a-time swap) is owned by App.tsx so a
 * replacement card can slide the previous one out before sliding in — see
 * GUR-51. This component only reflects the `visible` prop.
 */
export default function PeekCard({ annotation, visible, onTap }: PeekCardProps) {
  const color = ANNOTATION_COLORS[annotation.type] || '#6366F1';

  return (
    <div
      class={`guru-peek-card ${visible ? 'visible' : ''}`}
      style={{ top: '40%' }}
      onClick={onTap}
    >
      <div class="guru-peek-card-type" style={{ color }}>
        {annotation.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
      </div>
      <div class="guru-peek-card-text">
        {annotation.text}
      </div>
    </div>
  );
}
