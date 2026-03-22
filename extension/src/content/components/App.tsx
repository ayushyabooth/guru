import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  isActivated, isLoading, overlayData, panelVisible,
  annotations, annotationCount, activePeekCard, scrollProgress,
  unseenPeekCards,
} from '../state';
import GuruFAB from './GuruFAB';
import AnnotationRail from './AnnotationRail';
import OverlayPanel from './OverlayPanel';
import PeekCard from './PeekCard';
import SelectionMenu from './SelectionMenu';

export default function App() {
  const activated = isActivated.value;
  const loading = isLoading.value;
  const data = overlayData.value;
  const panel = panelVisible.value;
  const peek = activePeekCard.value;
  const anns = annotations.value;
  const count = annotationCount.value;

  // Auto-show peek cards as user scrolls past annotation positions
  // Only shows each annotation once per session (tracked in unseenPeekCards)
  const peekTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!activated || !data || anns.length === 0) return;

    // Initialize unseen set with all annotation IDs on first load
    if (unseenPeekCards.value.size === 0) {
      unseenPeekCards.value = new Set(anns.map(a => a.id));
    }

    let ticking = false;
    const checkScroll = () => {
      if (ticking || panel || peek) return;
      ticking = true;

      requestAnimationFrame(() => {
        ticking = false;
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        const progress = scrollHeight > clientHeight
          ? scrollTop / (scrollHeight - clientHeight)
          : 0;

        const totalSections = data.total_sections || 1;
        const unseen = unseenPeekCards.value;

        for (const ann of anns) {
          if (!unseen.has(ann.id)) continue;

          // Annotation position as a ratio (0-1)
          const annPosition = ann.position_after_section / totalSections;

          // Trigger when user scrolls within 5% of the annotation position
          if (Math.abs(progress - annPosition) < 0.05 && progress > 0.02) {
            // Remove from unseen
            const next = new Set(unseen);
            next.delete(ann.id);
            unseenPeekCards.value = next;

            // Show peek card after a brief delay (feels natural)
            if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
            peekTimerRef.current = setTimeout(() => {
              activePeekCard.value = ann;
            }, 400);

            break; // Only one at a time
          }
        }
      });
    };

    window.addEventListener('scroll', checkScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', checkScroll);
      if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    };
  }, [activated, data, anns, panel, peek]);

  if (!activated) return null;

  if (loading) {
    return (
      <div class="guru-loading guru-interactive">
        Loading Guru insights...
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <GuruFAB
        count={count}
        visible={true}
        onClick={() => { panelVisible.value = !panelVisible.value; }}
      />
      <AnnotationRail
        annotations={anns}
        totalSections={data.total_sections}
        onDotTap={(ann) => {
          // Mark as seen
          const next = new Set(unseenPeekCards.value);
          next.delete(ann.id);
          unseenPeekCards.value = next;
          activePeekCard.value = ann;
        }}
      />
      {peek && (
        <PeekCard
          annotation={peek}
          onTap={() => {
            panelVisible.value = true;
            activePeekCard.value = null;
          }}
          onDismiss={() => { activePeekCard.value = null; }}
        />
      )}
      {panel && (
        <OverlayPanel
          onClose={() => { panelVisible.value = false; }}
        />
      )}
      <SelectionMenu />
    </>
  );
}
