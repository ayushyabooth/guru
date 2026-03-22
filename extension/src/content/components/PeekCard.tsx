import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ANNOTATION_COLORS } from '../../shared/constants';
import type { Annotation } from '../../shared/types';

interface PeekCardProps {
  annotation: Annotation;
  onTap: () => void;
  onDismiss: () => void;
}

export default function PeekCard({ annotation, onTap, onDismiss }: PeekCardProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // Slide in after mount
    requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss after 8 seconds (enough time to read)
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // Wait for slide-out animation
    }, 8000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
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
        {annotation.type}
      </div>
      <div class="guru-peek-card-text">
        {annotation.text}
      </div>
    </div>
  );
}
