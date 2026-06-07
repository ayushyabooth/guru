import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { isActivated, highlights, activeTab, panelVisible, chatMessages, isChatLoading, conversationId, overlayData } from '../state';
import { sendChatMessage, createAnnotation } from '../api-client';

interface SelectionInfo {
  text: string;
  x: number;
  y: number;
}

const MENU_WIDTH = 280;
const MENU_HEIGHT = 44;

// GUR-213: wrap a selection Range in <mark> elements so highlights are visible
// on the article itself. Handles multi-node ranges by wrapping each intersecting
// text node (surroundContents throws on ranges that cross element boundaries).
function paintHighlight(range: Range) {
  const styleMark = (m: HTMLElement) => {
    m.className = 'guru-highlight-mark';
    m.style.backgroundColor = 'rgba(245, 158, 11, 0.32)';
    m.style.color = 'inherit';
    m.style.borderRadius = '2px';
    m.style.padding = '0';
  };
  try {
    const mark = document.createElement('mark');
    styleMark(mark);
    range.surroundContents(mark);
    return;
  } catch {
    // Range spans multiple nodes — fall through to per-text-node wrapping.
  }
  try {
    const ancestor = range.commonAncestorContainer;
    const rootEl = (ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor) as Node | null;
    if (!rootEl) return;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (range.intersectsNode(node) && (node.textContent || '').trim()) {
        textNodes.push(node as Text);
      }
    }
    textNodes.forEach((tn) => {
      const r = document.createRange();
      r.selectNodeContents(tn);
      if (tn === range.startContainer) r.setStart(tn, range.startOffset);
      if (tn === range.endContainer) r.setEnd(tn, range.endOffset);
      if (r.collapsed) return;
      const mark = document.createElement('mark');
      styleMark(mark);
      try { r.surroundContents(mark); } catch { /* skip nodes that can't be cleanly wrapped */ }
    });
  } catch (e) {
    console.warn('[Guru] paintHighlight failed', e);
  }
}

// GUR-213 follow-up: stored highlights live in the backend (shown in the FAB
// sheet) but the on-page <mark> styling was lost on every page reload because it
// was only applied at selection time. Re-find each stored highlight's text in
// the article DOM on load and re-paint it, so highlights persist visually across
// refreshes. Matches the first un-marked occurrence of each highlight's text.
function findTextRange(text: string): Range | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const p = (node as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'MARK') {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip our own injected UI and anything already highlighted.
      if (p.closest('#guru-root, .guru-panel, .guru-fab, .guru-highlight-mark')) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.textContent || '').includes(text)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  } as any);
  const node = walker.nextNode() as Text | null;
  if (!node || !node.textContent) return null;
  const idx = node.textContent.indexOf(text);
  if (idx < 0) return null;
  const range = document.createRange();
  range.setStart(node, idx);
  range.setEnd(node, idx + text.length);
  return range;
}

export function repaintStoredHighlights(texts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const raw of texts) {
    const text = (raw || '').trim();
    // Too-short strings match noise; skip and de-dupe identical highlights.
    if (text.length < 4 || seen.has(text)) continue;
    seen.add(text);
    try {
      const range = findTextRange(text);
      if (range) paintHighlight(range);
    } catch { /* graceful: a highlight whose text can't be located is just not repainted */ }
  }
}

export default function SelectionMenu() {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const noteInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingTextRef = useRef('');
  // GUR-213: keep the live Range so we can paint the highlight onto the page.
  const rangeRef = useRef<Range | null>(null);

  // Store handlers as refs so native event listeners can access current state
  const selectionRef = useRef<SelectionInfo | null>(null);
  selectionRef.current = selection;
  const skipNextMouseUpRef = useRef(false);

  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      // Skip if a menu button action just fired
      if (skipNextMouseUpRef.current) {
        skipNextMouseUpRef.current = false;
        return;
      }

      // Don't show selection menu if panel is open
      if (panelVisible.value) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        if (!showNoteInput) setSelection(null);
        return;
      }

      const text = sel.toString().trim();
      if (text.length < 3) return;

      const range = sel.getRangeAt(0);
      rangeRef.current = range.cloneRange();
      const rect = range.getBoundingClientRect();

      let x = rect.left + rect.width / 2 - MENU_WIDTH / 2;
      let y = rect.top - MENU_HEIGHT - 12;

      x = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
      y = Math.max(8, y);

      setSelection({ text, x, y });
      setShowNoteInput(false);
    }, 10);
  }, [showNoteInput]);

  // Listen to mouseup on the host document
  useEffect(() => {
    if (!isActivated.value) return;
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  // Dismiss selection when panel opens (FAB tapped)
  useEffect(() => {
    if (panelVisible.value && selection) {
      setSelection(null);
      setShowNoteInput(false);
      window.getSelection()?.removeAllRanges();
    }
  }, [panelVisible.value]);

  // Dismiss on click outside — but NOT when clicking inside menu
  useEffect(() => {
    if (!selection) return;

    const dismiss = (e: MouseEvent) => {
      // Check if click is inside the menu (by coordinates)
      const menu = menuRef.current;
      if (menu) {
        const rect = menu.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          return; // Click inside menu, don't dismiss
        }
      }
      if (!showNoteInput) {
        setSelection(null);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', dismiss);
    }, 300);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', dismiss);
    };
  }, [selection, showNoteInput]);

  // Focus note input when shown + attach native keydown listener
  useEffect(() => {
    const input = noteInputRef.current;
    if (!showNoteInput || !input) return;

    input.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); doSubmitNote(); }
      if (e.key === 'Escape') { setShowNoteInput(false); setSelection(null); }
    };

    input.addEventListener('keydown', onKeyDown);
    return () => input.removeEventListener('keydown', onKeyDown);
  }, [showNoteInput]);

  // Attach native click listeners to buttons via useEffect
  // This bypasses Preact's event system which doesn't work in closed Shadow DOM
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || !selection) return;

    const highlightBtn = menu.querySelector('[data-action="highlight"]') as HTMLElement;
    const noteBtn = menu.querySelector('[data-action="note"]') as HTMLElement;
    const askGuruBtn = menu.querySelector('[data-action="askguru"]') as HTMLElement;
    const saveBtn = menu.querySelector('[data-action="save"]') as HTMLElement;

    const onHighlight = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('[Guru] Native highlight click');
      skipNextMouseUpRef.current = true;
      doHighlight();
    };
    const onNote = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('[Guru] Native note click');
      skipNextMouseUpRef.current = true;
      pendingTextRef.current = selectionRef.current?.text || '';
      setShowNoteInput(true);
    };
    const onAskGuru = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      skipNextMouseUpRef.current = true;
      doAskGuru();
    };
    const onSave = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      doSubmitNote();
    };

    highlightBtn?.addEventListener('click', onHighlight);
    noteBtn?.addEventListener('click', onNote);
    askGuruBtn?.addEventListener('click', onAskGuru);
    saveBtn?.addEventListener('click', onSave);

    return () => {
      highlightBtn?.removeEventListener('click', onHighlight);
      noteBtn?.removeEventListener('click', onNote);
      askGuruBtn?.removeEventListener('click', onAskGuru);
      saveBtn?.removeEventListener('click', onSave);
    };
  }, [selection, showNoteInput]);

  function doHighlight() {
    const sel = selectionRef.current;
    if (!sel) return;
    const data = overlayData.value;
    const text = sel.text;
    console.log('[Guru] Highlighting:', text.slice(0, 50));

    highlights.value = [
      ...highlights.value,
      { text, timestamp: new Date().toLocaleTimeString() },
    ];
    // GUR-213: paint the highlight onto the page so there's an on-article indicator
    // (previously highlights were only listed in the Notes tab).
    if (rangeRef.current) paintHighlight(rangeRef.current);
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    if (data) {
      createAnnotation(data.id, { highlighted_text: text, start_offset: 0, end_offset: text.length })
        .then((r) => console.log('[Guru] Annotation saved:', r))
        .catch((e) => console.error('[Guru] Annotation save failed:', e));
    }
  }

  function doSubmitNote() {
    if (!pendingTextRef.current) return;
    const data = overlayData.value;
    const text = pendingTextRef.current;
    const noteInput = menuRef.current?.querySelector('.guru-note-input') as HTMLInputElement;
    const note = noteInput?.value || undefined;

    highlights.value = [
      ...highlights.value,
      { text, note, timestamp: new Date().toLocaleTimeString() },
    ];
    // GUR-213: paint the note's anchor text too (a note is an annotated highlight).
    if (rangeRef.current) paintHighlight(rangeRef.current);
    setSelection(null);
    setShowNoteInput(false);
    setNoteText('');
    window.getSelection()?.removeAllRanges();

    if (data) {
      createAnnotation(data.id, { highlighted_text: text, note_text: note, start_offset: 0, end_offset: text.length }).catch(() => {});
    }
  }

  async function doAskGuru() {
    const sel = selectionRef.current;
    if (!sel) return;
    const question = `Regarding this passage: "${sel.text}" — can you explain or provide more context?`;

    panelVisible.value = true;
    activeTab.value = 3;
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    const data = overlayData.value;
    if (!data) return;

    const userMsg = { role: 'user' as const, content: question };
    chatMessages.value = [...chatMessages.value, userMsg];
    isChatLoading.value = true;

    try {
      const response = await sendChatMessage(
        data.id,
        question,
        chatMessages.value,
        conversationId.value ?? undefined,
      );
      chatMessages.value = [
        ...chatMessages.value,
        { role: 'assistant', content: response.response },
      ];
      conversationId.value = response.conversation_id;
    } catch {
      chatMessages.value = [
        ...chatMessages.value,
        { role: 'assistant', content: 'Sorry, I had trouble answering that. Please try again.' },
      ];
    } finally {
      isChatLoading.value = false;
    }
  }

  if (!selection) return null;

  if (showNoteInput) {
    return (
      <div
        ref={menuRef}
        class="guru-selection-menu guru-interactive"
        style={{
          left: `${selection.x}px`,
          top: `${selection.y - 40}px`,
          width: `${MENU_WIDTH + 40}px`,
        }}
      >
        <input
          ref={noteInputRef}
          class="guru-note-input"
          type="text"
          placeholder="Add a note..."
        />
        <button class="guru-note-save" data-action="save">Save</button>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      class="guru-selection-menu guru-interactive"
      style={{
        left: `${selection.x}px`,
        top: `${selection.y}px`,
        width: `${MENU_WIDTH}px`,
      }}
    >
      <button class="guru-sel-btn" data-action="highlight" title="Highlight">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span>Highlight</span>
      </button>
      <div class="guru-sel-divider" />
      <button class="guru-sel-btn" data-action="note" title="Add Note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span>Note</span>
      </button>
      <div class="guru-sel-divider" />
      <button class="guru-sel-btn" data-action="askguru" title="Ask Guru">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>Ask Guru</span>
      </button>
    </div>
  );
}
