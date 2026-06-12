import { h } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';
import { activeTab, overlayData, annotations } from '../state';
import { SNAP_HEIGHTS } from '../../shared/constants';
import SummaryTab from './tabs/SummaryTab';
import InsightsTab from './tabs/InsightsTab';
import NotesTab from './tabs/NotesTab';
import AskGuruTab from './tabs/AskGuruTab';
import Goo from './Goo';

const TAB_NAMES = ['Summary', 'Insights', 'Notes', 'Ask Guru'];

interface OverlayPanelProps {
  onClose: () => void;
}

export default function OverlayPanel({ onClose }: OverlayPanelProps) {
  const [snapHeight, setSnapHeight] = useState(SNAP_HEIGHTS.default);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = snapHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [snapHeight]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging) return;
    const deltaY = dragStartY.current - e.clientY;
    const deltaRatio = deltaY / window.innerHeight;
    const newHeight = Math.max(0.05, Math.min(0.8, dragStartHeight.current + deltaRatio));
    setSnapHeight(newHeight);
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    // Snap to nearest position
    if (snapHeight < 0.15) {
      onClose();
    } else if (snapHeight < 0.55) {
      setSnapHeight(SNAP_HEIGHTS.default);
    } else {
      setSnapHeight(SNAP_HEIGHTS.expanded);
    }
  }, [snapHeight, onClose]);

  const data = overlayData.value;
  if (!data) return null;

  const heightPx = snapHeight * window.innerHeight;

  return (
    <div
      class="guru-panel guru-interactive"
      style={{
        height: `${heightPx}px`,
        transition: isDragging ? 'none' : undefined,
      }}
    >
      {/* Drag handle + close button */}
      <div
        class="guru-panel-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* THE signature: "guru" + living period (GUR-228 identity R13) */}
        <div style={{ position: 'absolute', left: '16px', top: '8px', display: 'flex', alignItems: 'flex-end', pointerEvents: 'none' }}>
          <span style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.5px', color: '#F1F5F9', lineHeight: 1 }}>guru</span>
          <span style={{ marginLeft: '3px', marginBottom: '0px', display: 'inline-flex' }}>
            <Goo size={11} bold />
          </span>
        </div>
        <div class="guru-panel-handle-bar" />
        <button
          class="guru-panel-close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Tab bar */}
      <div class="guru-panel-tabs">
        {TAB_NAMES.map((name, i) => (
          <button
            key={name}
            class={`guru-panel-tab ${activeTab.value === i ? 'active' : ''}`}
            onClick={() => { activeTab.value = i; }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div class="guru-panel-content">
        {activeTab.value === 0 && <SummaryTab />}
        {activeTab.value === 1 && <InsightsTab />}
        {activeTab.value === 2 && <NotesTab />}
        {activeTab.value === 3 && <AskGuruTab />}
      </div>
    </div>
  );
}
