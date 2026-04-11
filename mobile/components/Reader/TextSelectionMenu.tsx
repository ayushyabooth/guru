/**
 * TextSelectionMenu — cross-platform floating action menu for text selection.
 *
 * On web: listens for `selectionchange` and shows a glassmorphic popup near the selection.
 * On native: uses `selectable` Text + manual detection via a long-press wrapper.
 *
 * Actions: Highlight, Note, Ask Guru
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Modal,
  TextInput,
} from 'react-native';
import Icon from '../ui/Icon';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { trackInteraction } from '../../services/interaction-tracker';
import { Spacing } from '@/constants/liquidGlass';

interface TextSelectionMenuProps {
  articleId: string;
  /** Ref to the scrollable container element (web only) */
  containerRef?: React.RefObject<any>;
  /** Callback when user picks "Ask Guru" with selected text */
  onAskGuru?: (selectedText: string) => void;
  /** Callback after a highlight is created */
  onHighlightCreated?: () => void;
}

interface SelectionInfo {
  text: string;
  x: number;
  y: number;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
}

export const TextSelectionMenu: React.FC<TextSelectionMenuProps> = ({
  articleId,
  containerRef,
  onAskGuru,
  onHighlightCreated,
}) => {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');
  const menuRef = useRef<View>(null);
  // Track whether the note modal is open so selectionchange doesn't clear state
  const noteOpenRef = useRef(false);

  // ─── Web: detect selection via Selection API ───────────────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let debounceTimer: NodeJS.Timeout;

    /**
     * Compute the character offset of a (container, offset) pair
     * relative to the full textContent of the paragraph element.
     */
    const getAbsoluteOffset = (paraEl: HTMLElement, container: Node, offset: number): number => {
      const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node === container) return charCount + offset;
        charCount += (node.textContent?.length ?? 0);
      }
      return charCount + offset; // fallback
    };

    const handleSelectionChange = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          // Don't clear selection while note modal is open
          if (!noteOpenRef.current) setSelection(null);
          return;
        }

        const selectedText = sel.toString().trim();
        if (selectedText.length < 3) {
          if (!noteOpenRef.current) setSelection(null);
          return;
        }

        // Check if selection is within our article content
        const range = sel.getRangeAt(0);
        const container = containerRef?.current;
        if (container && !container.contains?.(range.commonAncestorContainer)) {
          if (!noteOpenRef.current) setSelection(null);
          return;
        }

        // Get position for the popup
        const rect = range.getBoundingClientRect();

        // Find the paragraph element and its index
        let paragraphIndex = 0;
        let paraEl: HTMLElement | null = null;
        let node = range.startContainer as HTMLElement;
        while (node && node.parentElement) {
          if (node.getAttribute?.('data-para-index')) {
            paragraphIndex = parseInt(node.getAttribute('data-para-index') || '0', 10);
            paraEl = node;
            break;
          }
          node = node.parentElement;
        }

        // Compute absolute offsets relative to full paragraph text
        let startOffset = range.startOffset;
        let endOffset = range.endOffset;
        if (paraEl) {
          startOffset = getAbsoluteOffset(paraEl, range.startContainer, range.startOffset);
          endOffset = getAbsoluteOffset(paraEl, range.endContainer, range.endOffset);
        }

        setSelection({
          text: selectedText,
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
          paragraphIndex,
          startOffset,
          endOffset,
        });
      }, 300);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(debounceTimer);
    };
  }, [containerRef]);

  // ─── Actions ───────────────────────────────────────────────────

  const handleHighlight = useCallback(async () => {
    if (!selection) return;

    try {
      const token = await getAuthToken();
      if (!token) {
        console.warn('[TextSelectionMenu] No auth token – cannot save highlight');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/articles/${articleId}/annotations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          highlighted_text: selection.text,
          color: 'gold',
          paragraph_index: selection.paragraphIndex,
          start_offset: selection.startOffset,
          end_offset: selection.endOffset,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[TextSelectionMenu] Highlight save failed (${res.status}):`, errBody);
        return;
      }

      trackInteraction({
        interactionType: 'highlight',
        articleId,
        content: selection.text.slice(0, 200),
      });

      onHighlightCreated?.();
    } catch (error) {
      console.error('[TextSelectionMenu] Highlight error:', error);
    } finally {
      setSelection(null);
      window.getSelection?.()?.removeAllRanges();
    }
  }, [selection, articleId, onHighlightCreated]);

  const handleNote = useCallback(() => {
    if (!selection) return;
    noteOpenRef.current = true;
    setShowNoteInput(true);
  }, [selection]);

  const handleSaveNote = useCallback(async () => {
    if (!selection) return;

    try {
      const token = await getAuthToken();
      if (!token) {
        console.warn('[TextSelectionMenu] No auth token – cannot save note');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/articles/${articleId}/annotations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          highlighted_text: selection.text,
          note_text: noteText,
          color: 'gold',
          paragraph_index: selection.paragraphIndex,
          start_offset: selection.startOffset,
          end_offset: selection.endOffset,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[TextSelectionMenu] Note save failed (${res.status}):`, errBody);
        return;
      }

      trackInteraction({
        interactionType: 'highlight',
        articleId,
        content: selection.text.slice(0, 200),
        metadata: { has_note: true },
      });

      onHighlightCreated?.();
    } catch (error) {
      console.error('[TextSelectionMenu] Note save error:', error);
    } finally {
      noteOpenRef.current = false;
      setSelection(null);
      setShowNoteInput(false);
      setNoteText('');
      window.getSelection?.()?.removeAllRanges();
    }
  }, [selection, noteText, articleId, onHighlightCreated]);

  const handleAskGuru = useCallback(() => {
    if (!selection) return;

    trackInteraction({
      interactionType: 'annotation_expand',
      articleId,
      content: selection.text.slice(0, 200),
    });

    onAskGuru?.(selection.text);
    setSelection(null);
    window.getSelection?.()?.removeAllRanges();
  }, [selection, articleId, onAskGuru]);

  const handleDismiss = useCallback(() => {
    noteOpenRef.current = false;
    setSelection(null);
    setShowNoteInput(false);
    setNoteText('');
    window.getSelection?.()?.removeAllRanges();
  }, []);

  // ─── Render ────────────────────────────────────────────────────

  if (!selection) return null;

  // Position menu above the selection
  const screenWidth = Dimensions.get('window').width;
  const menuWidth = 220;
  let menuX = Math.max(10, Math.min(selection.x - menuWidth / 2, screenWidth - menuWidth - 10));
  let menuY = Math.max(60, selection.y - 55);

  return (
    <>
      {/* Floating selection menu */}
      <View
        ref={menuRef}
        style={[
          styles.menuContainer,
          Platform.OS === 'web' && ({
            position: 'fixed',
            left: menuX,
            top: menuY,
            zIndex: 9999,
          } as any),
        ]}
      >
        <View style={styles.menuInner}>
          <TouchableOpacity style={styles.menuButton} onPress={handleHighlight}>
            <Icon name="marker" size={16} color="#FBBF24" />
            <Text style={styles.menuButtonText}>Highlight</Text>
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity style={styles.menuButton} onPress={handleNote}>
            <Icon name="note-text-outline" size={16} color="#38BDF8" />
            <Text style={styles.menuButtonText}>Note</Text>
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity style={styles.menuButton} onPress={handleAskGuru}>
            <Icon name="chat-question-outline" size={16} color="#10B981" />
            <Text style={styles.menuButtonText}>Ask Guru</Text>
          </TouchableOpacity>
        </View>

        {/* Arrow pointing down */}
        <View style={styles.menuArrow} />
      </View>

      {/* Note input modal */}
      <Modal
        visible={showNoteInput}
        transparent
        animationType="fade"
        onRequestClose={handleDismiss}
      >
        <TouchableOpacity style={styles.noteOverlay} activeOpacity={1} onPress={handleDismiss}>
          <View style={styles.noteContainer} onStartShouldSetResponder={() => true}>
            <Text style={styles.noteTitle}>Add a note</Text>
            <Text style={styles.noteQuote} numberOfLines={3}>
              "{selection?.text?.slice(0, 150) || ''}{(selection?.text?.length || 0) > 150 ? '...' : ''}"
            </Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Your thoughts..."
              placeholderTextColor="#64748B"
              value={noteText}
              onChangeText={setNoteText}
              multiline
              autoFocus
            />
            <View style={styles.noteActions}>
              <TouchableOpacity style={styles.noteCancelButton} onPress={handleDismiss}>
                <Text style={styles.noteCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.noteSaveButton, !noteText.trim() && styles.noteSaveDisabled]}
                onPress={handleSaveNote}
                disabled={!noteText.trim()}
              >
                <Text style={styles.noteSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  menuContainer: {
    alignItems: 'center',
  },
  menuInner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 20, 35, 0.95)',
    borderRadius: 12,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    ...Platform.select({
      web: {
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      } as any,
      default: {
        elevation: Spacing.sm,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: Spacing.xs },
        shadowOpacity: 0.3,
        shadowRadius: Spacing.sm,
      },
    }),
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  menuButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  menuDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  menuArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(15, 20, 35, 0.95)',
  },
  noteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  noteContainer: {
    backgroundColor: '#0F1423',
    borderRadius: Spacing.md,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  noteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 12,
  },
  noteQuote: {
    fontSize: 14,
    color: '#94A3B8',
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: Spacing.md,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#FBBF24',
  },
  noteInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#F1F5F9',
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: Spacing.md,
  },
  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  noteCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: Spacing.sm,
  },
  noteCancelText: {
    fontSize: 16,
    color: '#94A3B8',
    fontWeight: '500',
  },
  noteSaveButton: {
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderRadius: Spacing.sm,
    backgroundColor: '#38BDF8',
  },
  noteSaveDisabled: {
    backgroundColor: 'rgba(56, 189, 248, 0.3)',
  },
  noteSaveText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export default TextSelectionMenu;
