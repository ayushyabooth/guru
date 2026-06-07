import { h } from 'preact';
import { panelVisible } from '../state';
import { SNAP_HEIGHTS } from '../../shared/constants';

interface GuruFABProps {
  count: number;
  visible: boolean;
  onClick: () => void;
}

export default function GuruFAB({ count, visible, onClick }: GuruFABProps) {
  if (!visible) return null;

  // Move FAB above the panel when it's open
  const isPanelOpen = panelVisible.value;
  const bottomPx = isPanelOpen
    ? SNAP_HEIGHTS.default * window.innerHeight + 16
    : 32;

  return (
    <button
      class="guru-fab guru-interactive"
      onClick={onClick}
      title={isPanelOpen ? 'Close Guru panel' : 'Open Guru insights'}
      style={{ bottom: `${bottomPx}px` }}
    >
      {/* Guru triskelion mark — three INTERLOCKING rings in the brand accents
          (Catch-up blue top · Dive-in pink bottom-left · Recap orange
          bottom-right), using the canonical logo geometry (viewBox 200, R 70,
          center offset 35) scaled to 24 so the rings overlap like the real Guru
          logo rather than reading as three separate bubbles.
          Designed in Figma first (file CVsVL7zvjyO3yoLlUJqBxI). */}
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="7.8" r="7.2" stroke="#38BDF8" stroke-width="1.5" />
        <circle cx="8.19" cy="14.4" r="7.2" stroke="#EC4899" stroke-width="1.5" />
        <circle cx="15.81" cy="14.4" r="7.2" stroke="#FB923C" stroke-width="1.5" />
      </svg>
      {count > 0 && <span class="guru-fab-badge">{count}</span>}
    </button>
  );
}
