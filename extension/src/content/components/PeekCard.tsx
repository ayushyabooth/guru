import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ANNOTATION_COLORS } from '../../shared/constants';
import { scrollProgress, overlayData } from '../state';
import type { Annotation } from '../../shared/types';

interface PeekCardProps {
  annotation: Annotation;
  onTap: () => void;
  onDismiss: () => void;
}

export default function PeekCard({ annotation, onTap, onDismiss }: PeekCardProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const dismissingRef = useRef(false);

  const dismiss = () => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setVisible(false);
    setTimeout(onDismiss, 350);
  };

  useEffect(() => {
    dismissingRef.current = false;

    // Double-rAF ensures the browser has painted the initial state
    // before we trigger the transition (prevents same-frame snap)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });

    // Auto-dismiss after 6 seconds
    timerRef.current = setTimeout(dismiss, 6000);

    // Scroll-aware dismiss: if user scrolls >15% away from annotation, dismiss
    const data = overlayData.value;
    const totalSections = data?.total_sections || 1;
    const annPosition = annotation.position_after_section / totalSections;

    const onScroll = () => {
      const progress = scrollProgress.value;
      if (Math.abs(progress - annPosition) > 0.15) {
        dismiss();
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('scroll', onScroll);
    };
  }, [annotation.id]);

  const color = ANNOTATION_COLORS[annotation.type] || '#6366F1';

  return (
    <div
      class={`guru-peek-card ${visible ? 'visible' : ''}`}
      style={{ top: '40%' }}
      onClick={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        onTap();
      }}
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
