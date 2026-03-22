import { h } from 'preact';
import { ANNOTATION_COLORS } from '../../shared/constants';
import { scrollProgress } from '../state';
import type { Annotation } from '../../shared/types';

interface AnnotationRailProps {
  annotations: Annotation[];
  totalSections: number;
  onDotTap: (annotation: Annotation) => void;
}

export default function AnnotationRail({ annotations, totalSections, onDotTap }: AnnotationRailProps) {
  if (annotations.length === 0) return null;

  // Read signal directly so only this component re-renders on scroll
  const scroll = scrollProgress.value;

  const handleDotClick = (ann: Annotation) => {
    const ratio = totalSections > 0
      ? ann.position_after_section / totalSections
      : 0.5;
    const scrollTarget = ratio * (document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    onDotTap(ann);
  };

  return (
    <div class="guru-rail">
      <div
        class="guru-scroll-indicator"
        style={{ top: `${scroll * 100}%` }}
      />
      {annotations.map((ann) => {
        const position = totalSections > 0
          ? (ann.position_after_section / totalSections) * 100
          : 50;
        const color = ANNOTATION_COLORS[ann.type] || '#6366F1';

        return (
          <div
            key={ann.id}
            class="guru-rail-dot"
            style={{
              top: `${position}%`,
              backgroundColor: color,
            }}
            title={ann.text.slice(0, 60)}
            onClick={() => handleDotClick(ann)}
          />
        );
      })}
    </div>
  );
}
