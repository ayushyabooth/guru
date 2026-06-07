import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  isActivated, isLoading, overlayData, panelVisible,
  annotations, annotationCount,
  unseenPeekCards,
} from '../state';
import type { Annotation } from '../../shared/types';
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
  const anns = annotations.value;
  const count = annotationCount.value;

  // ---- Peek card lifecycle (GUR-51) ---------------------------------------
  // One card visible at a time. When a new annotation comes into range while a
  // card is showing, the current card slides OUT before the next slides IN
  // (out-then-in swap). 8s auto-dismiss per BRD E.2. Each annotation shown once
  // per session (unseenPeekCards). Refs back the async callbacks so the scroll
  // listener never reads stale state and never needs to re-subscribe.
  const [peekAnn, setPeekAnn] = useState<Annotation | null>(null);
  const [peekVisible, setPeekVisible] = useState(false);
  const peekAnnRef = useRef<Annotation | null>(null);
  const peekVisibleRef = useRef(false);
  peekAnnRef.current = peekAnn;
  peekVisibleRef.current = peekVisible;

  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
  const swapTimer = useRef<ReturnType<typeof setTimeout>>();
  const clearPeekTimers = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (swapTimer.current) clearTimeout(swapTimer.current);
  };

  const hidePeek = () => {
    clearPeekTimers();
    setPeekVisible(false);
    swapTimer.current = setTimeout(() => setPeekAnn(null), 350); // after slide-out
  };

  const mountPeek = (ann: Annotation) => {
    setPeekAnn(ann);
    // Double-rAF so the card paints at translateX(80px)/opacity:0 before we flip
    // to .visible — otherwise the enter transition is skipped (same-frame snap).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setPeekVisible(true)),
    );
    dismissTimer.current = setTimeout(hidePeek, 8000); // BRD E.2: 8s
  };

  const requestPeek = (ann: Annotation) => {
    if (peekAnnRef.current?.id === ann.id) return; // already showing this one
    clearPeekTimers();
    if (peekAnnRef.current && peekVisibleRef.current) {
      // Slide the current card out, then bring the new one in.
      setPeekVisible(false);
      swapTimer.current = setTimeout(() => mountPeek(ann), 380);
    } else {
      mountPeek(ann);
    }
  };
  // Stable handles so the scroll effect doesn't re-subscribe on every render.
  const requestPeekRef = useRef(requestPeek);
  const hidePeekRef = useRef(hidePeek);
  requestPeekRef.current = requestPeek;
  hidePeekRef.current = hidePeek;

  // Auto-show peek cards as the user scrolls past annotation positions.
  useEffect(() => {
    if (!activated || !data || anns.length === 0) return;

    if (unseenPeekCards.value.size === 0) {
      unseenPeekCards.value = new Set(anns.map(a => a.id));
    }

    let ticking = false;
    const checkScroll = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        ticking = false;
        const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
        const progress = scrollHeight > clientHeight
          ? scrollTop / (scrollHeight - clientHeight)
          : 0;
        const totalSections = data.total_sections || 1;

        // Dismiss the active card once the user scrolls clear of its anchor.
        const current = peekAnnRef.current;
        if (current && peekVisibleRef.current) {
          const curPos = current.position_after_section / totalSections;
          if (Math.abs(progress - curPos) > 0.15) hidePeekRef.current();
        }

        // Don't pop new cards while the panel is open.
        if (panelVisible.value) return;

        const unseen = unseenPeekCards.value;
        for (const ann of anns) {
          if (!unseen.has(ann.id)) continue;
          const annPosition = ann.position_after_section / totalSections;
          // Trigger within 5% of the annotation position.
          if (Math.abs(progress - annPosition) < 0.05 && progress > 0.02) {
            const next = new Set(unseen);
            next.delete(ann.id);
            unseenPeekCards.value = next;
            requestPeekRef.current(ann);
            break; // one at a time
          }
        }
      });
    };

    window.addEventListener('scroll', checkScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', checkScroll);
      clearPeekTimers();
    };
  }, [activated, data, anns]);

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
          requestPeek(ann);
        }}
      />
      {peekAnn && (
        <PeekCard
          annotation={peekAnn}
          visible={peekVisible}
          onTap={() => {
            clearPeekTimers();
            setPeekVisible(false);
            swapTimer.current = setTimeout(() => setPeekAnn(null), 350);
            panelVisible.value = true;
          }}
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
