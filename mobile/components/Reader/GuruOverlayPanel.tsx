/**
 * GuruOverlayPanel — Bottom-sheet overlay for the Guru WebView reader.
 *
 * Shows transformative content (summary, annotations, notes, Q&A) as a
 * draggable overlay on top of the article WebView. Liquid-glass styling,
 * 4 tabs, animates between minimised (tab bar only), default (40%), and
 * expanded (80%) snap points.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  FlatList,
  Image,
} from 'react-native';
import Icon from '../ui/Icon';
import { AnnotationColors } from '../../constants/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelatedArticleData {
  id: string;
  title: string;
  source: string;
  url?: string;
  thumbnail_url?: string;
  word_count?: number;
}

export interface GuruOverlayPanelProps {
  visible: boolean;
  onClose: () => void;
  accentColor: string;
  richContent?: {
    summary_whats_in?: string;
    summary_why_matters?: string;
    summary_between_lines?: string;
    spotlight_quotes?: string[];
    socratic_prompts?: string[];
  };
  annotations: Array<{
    id: string;
    type: string;
    text: string;
    position_after_section: number;
    generated_by: string;
  }>;
  totalSections: number;
  highlights: Array<{ text: string; note?: string; timestamp: string }>;
  articleId: string;
  articleTitle: string;
  relatedArticles?: RelatedArticleData[];
  onExploreWithGuru: (question: string) => void;
  onAnnotationPositionTap: (positionRatio: number) => void;
  onRelatedArticleClick?: (articleId: string) => void;
  initialTab?: number;
  scrollToAnnotationId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { height: SCREEN_H } = Dimensions.get('window');
const MINIMISED_H = 48;
const DEFAULT_H = SCREEN_H * 0.4;
const EXPANDED_H = SCREEN_H * 0.8;
const TAB_LABELS = ['Summary', 'Insights', 'Notes', 'Ask Guru'] as const;
const TAB_ICONS = ['text-box-outline', 'lightbulb-on-outline', 'note-text-outline', 'chat-processing-outline'];

// ---------------------------------------------------------------------------
// Collapsible section (used in Summary tab)
// ---------------------------------------------------------------------------

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <View style={s.collapsible}>
      <TouchableOpacity style={s.collapsibleHeader} onPress={() => setOpen((v) => !v)} activeOpacity={0.7}>
        <Text style={s.collapsibleTitle}>{title}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#666" />
      </TouchableOpacity>
      {open && <View style={s.collapsibleBody}>{children}</View>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab: Summary
// ---------------------------------------------------------------------------

function SummaryTab({ richContent, relatedArticles, onRelatedArticleClick }: Pick<GuruOverlayPanelProps, 'richContent' | 'relatedArticles' | 'onRelatedArticleClick'>) {
  if (!richContent) return <Text style={s.emptyText}>No summary available yet.</Text>;
  return (
    <ScrollView style={s.tabScroll} showsVerticalScrollIndicator={false}>
      {richContent.summary_whats_in && (
        <CollapsibleSection title="What's in the article">
          <Text style={s.bodyText}>{richContent.summary_whats_in}</Text>
        </CollapsibleSection>
      )}
      {richContent.summary_why_matters && (
        <CollapsibleSection title="Why it matters">
          <Text style={s.bodyText}>{richContent.summary_why_matters}</Text>
        </CollapsibleSection>
      )}
      {richContent.summary_between_lines && (
        <CollapsibleSection title="Between the lines">
          <Text style={s.bodyText}>{richContent.summary_between_lines}</Text>
        </CollapsibleSection>
      )}
      {richContent.spotlight_quotes && richContent.spotlight_quotes.length > 0 && (
        <View style={s.quotesRow}>
          <Text style={s.sectionLabel}>Spotlight quotes</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quotesScroll}>
            {richContent.spotlight_quotes.map((q, i) => (
              <View key={i} style={s.quoteCard}>
                <Text style={s.quoteText}>"{q}"</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
      {relatedArticles && relatedArticles.length > 0 && (
        <View style={s.relatedSection}>
          <View style={s.relatedHeader}>
            <Text style={s.sectionLabel}>Also in this story</Text>
            <Text style={s.relatedCount}>{relatedArticles.length} articles</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {relatedArticles.map((article) => (
              <TouchableOpacity
                key={article.id}
                style={s.relatedCard}
                activeOpacity={0.7}
                onPress={() => onRelatedArticleClick?.(article.id)}
              >
                {article.thumbnail_url ? (
                  <Image source={{ uri: article.thumbnail_url }} style={s.relatedThumb} />
                ) : (
                  <View style={[s.relatedThumb, { backgroundColor: '#E2E8F0' }]} />
                )}
                <Text style={s.relatedTitle} numberOfLines={2}>{article.title}</Text>
                <Text style={s.relatedMeta}>
                  {article.source}{article.word_count ? ` · ${Math.ceil(article.word_count / 200)} min` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Tab: Insights
// ---------------------------------------------------------------------------

function InsightsTab({ annotations, totalSections, onExploreWithGuru, onAnnotationPositionTap }: Pick<GuruOverlayPanelProps, 'annotations' | 'totalSections' | 'onExploreWithGuru' | 'onAnnotationPositionTap'>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!annotations.length) return <Text style={s.emptyText}>No insights generated yet.</Text>;

  const sorted = [...annotations].sort((a, b) => a.position_after_section - b.position_after_section);
  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => {
        const colors = AnnotationColors[item.type as keyof typeof AnnotationColors] ?? AnnotationColors.reflection;
        const isExpanded = expandedId === item.id;
        const ratio = totalSections > 0 ? item.position_after_section / totalSections : 0;
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setExpandedId(isExpanded ? null : item.id)}
            style={[s.annotationCard, { backgroundColor: colors.bg, borderLeftColor: colors.accent }]}
          >
            <View style={s.annotationHeader}>
              <Icon name={colors.icon} size={16} color={colors.accent} />
              <Text style={[s.annotationType, { color: colors.accent }]}>{item.type.replace('_', ' ')}</Text>
              <TouchableOpacity onPress={() => onAnnotationPositionTap(ratio)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="crosshairs-gps" size={14} color="#999" />
              </TouchableOpacity>
            </View>
            <Text style={s.bodyText} numberOfLines={isExpanded ? undefined : 3}>{item.text}</Text>
            {isExpanded && (
              <TouchableOpacity style={s.exploreBtn} onPress={() => onExploreWithGuru(item.text)}>
                <Text style={s.exploreBtnText}>Explore with Guru →</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tab: Notes
// ---------------------------------------------------------------------------

function NotesTab({ highlights, onAnnotationPositionTap }: { highlights: GuruOverlayPanelProps['highlights']; onAnnotationPositionTap: (r: number) => void }) {
  if (!highlights.length) return <Text style={s.emptyText}>Highlight text in the article to save notes.</Text>;
  return (
    <FlatList
      data={highlights}
      keyExtractor={(_, i) => String(i)}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => (
        <View style={s.highlightCard}>
          <Text style={s.quoteText}>"{item.text}"</Text>
          {item.note && <Text style={s.noteText}>{item.note}</Text>}
          <Text style={s.timestampText}>{item.timestamp}</Text>
        </View>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Tab: Ask Guru
// ---------------------------------------------------------------------------

function AskGuruTab({ onExploreWithGuru }: Pick<GuruOverlayPanelProps, 'onExploreWithGuru'>) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'guru'; text: string }>>([]);

  const send = useCallback(() => {
    const q = input.trim();
    if (!q) return;
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setInput('');
    onExploreWithGuru(q);
  }, [input, onExploreWithGuru]);

  return (
    <View style={s.askContainer}>
      <FlatList
        data={messages}
        keyExtractor={(_, i) => String(i)}
        style={s.chatList}
        renderItem={({ item }) => (
          <View style={[s.chatBubble, item.role === 'user' ? s.chatUser : s.chatGuru]}>
            <Text style={s.bodyText}>{item.text}</Text>
          </View>
        )}
      />
      <View style={s.inputRow}>
        <TextInput
          style={s.chatInput}
          placeholder="Ask about this article..."
          placeholderTextColor="#999"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <TouchableOpacity onPress={send} style={s.sendBtn}>
          <Icon name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GuruOverlayPanel(props: GuruOverlayPanelProps) {
  const {
    visible, onClose, accentColor, richContent, annotations, totalSections,
    highlights, articleId, articleTitle, relatedArticles, onExploreWithGuru,
    onAnnotationPositionTap, onRelatedArticleClick, initialTab = 0, scrollToAnnotationId,
  } = props;

  const [activeTab, setActiveTab] = useState(initialTab);
  const sheetH = useRef(new Animated.Value(visible ? DEFAULT_H : 0)).current;
  const currentH = useRef(DEFAULT_H);

  // Snap to nearest height
  const snapTo = useCallback((target: number) => {
    currentH.current = target;
    Animated.spring(sheetH, { toValue: target, useNativeDriver: false, tension: 80, friction: 18 }).start();
  }, [sheetH]);

  // Visibility toggle
  useEffect(() => {
    if (visible) snapTo(DEFAULT_H);
    else snapTo(0);
  }, [visible, snapTo]);

  // Drag handling
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        const next = Math.max(MINIMISED_H, Math.min(EXPANDED_H, currentH.current - g.dy));
        sheetH.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const projected = currentH.current - g.dy;
        if (projected < MINIMISED_H + 30) { snapTo(MINIMISED_H); return; }
        if (projected > (DEFAULT_H + EXPANDED_H) / 2) { snapTo(EXPANDED_H); return; }
        snapTo(DEFAULT_H);
      },
    }),
  ).current;

  if (!visible) return null;

  return (
    <Animated.View style={[s.sheet, { height: sheetH }]}>
      {/* Drag handle */}
      <View {...panResponder.panHandlers} style={s.handleArea}>
        <View style={s.handle} />
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {TAB_LABELS.map((label, i) => (
          <TouchableOpacity key={label} style={s.tab} onPress={() => setActiveTab(i)} activeOpacity={0.7}>
            <Icon name={TAB_ICONS[i]} size={16} color={activeTab === i ? accentColor : '#888'} />
            <Text style={[s.tabLabel, activeTab === i && { color: accentColor }]}>{label}</Text>
            {activeTab === i && <View style={[s.tabUnderline, { backgroundColor: accentColor }]} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <View style={s.content}>
        {activeTab === 0 && <SummaryTab richContent={richContent} relatedArticles={relatedArticles} onRelatedArticleClick={onRelatedArticleClick} />}
        {activeTab === 1 && <InsightsTab annotations={annotations} totalSections={totalSections} onExploreWithGuru={onExploreWithGuru} onAnnotationPositionTap={onAnnotationPositionTap} />}
        {activeTab === 2 && <NotesTab highlights={highlights} onAnnotationPositionTap={onAnnotationPositionTap} />}
        {activeTab === 3 && <AskGuruTab onExploreWithGuru={onExploreWithGuru} />}
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.3)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: { backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' } as any,
      default: {},
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 12,
  },
  handleArea: { alignItems: 'center', paddingVertical: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.15)' },

  // Tabs
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.08)' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, position: 'relative' },
  tabLabel: { fontSize: 11, color: '#888', marginTop: 2, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  tabUnderline: { position: 'absolute', bottom: 0, left: '20%' as any, right: '20%' as any, height: 2, borderRadius: 1 },

  // Content
  content: { flex: 1, paddingHorizontal: 16 },
  tabScroll: { flex: 1, paddingTop: 8 },

  // Collapsible
  collapsible: { marginBottom: 12 },
  collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  collapsibleTitle: { fontSize: 14, fontWeight: '600', color: '#333', fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  collapsibleBody: { paddingTop: 4 },

  // Text
  bodyText: { fontSize: 14, lineHeight: 20, color: '#444', fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 32, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },

  // Spotlight quotes
  quotesRow: { marginTop: 12 },
  quotesScroll: { flexDirection: 'row' },
  quoteCard: { backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 12, marginRight: 10, width: 200 },
  quoteText: { fontSize: 13, fontStyle: 'italic', color: '#555', lineHeight: 18, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },

  // Annotations
  annotationCard: { borderLeftWidth: 3, borderRadius: 8, padding: 12, marginVertical: 6 },
  annotationHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  annotationType: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize', flex: 1, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  exploreBtn: { marginTop: 10, alignSelf: 'flex-end' },
  exploreBtnText: { fontSize: 13, fontWeight: '600', color: '#38BDF8', fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },

  // Highlights / Notes
  highlightCard: { backgroundColor: 'rgba(250,204,21,0.08)', borderRadius: 8, padding: 12, marginVertical: 6 },
  noteText: { fontSize: 13, color: '#666', marginTop: 4, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  timestampText: { fontSize: 11, color: '#aaa', marginTop: 6, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },

  // Ask Guru
  askContainer: { flex: 1, paddingTop: 8 },
  chatList: { flex: 1 },
  chatBubble: { borderRadius: 12, padding: 10, marginVertical: 4, maxWidth: '85%' as any },
  chatUser: { alignSelf: 'flex-end', backgroundColor: 'rgba(56,189,248,0.12)' },
  chatGuru: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.04)' },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 },
  chatInput: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.04)',
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#333',
    fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined,
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center' },

  // Related articles
  relatedSection: { marginTop: 16, marginBottom: 16 },
  relatedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  relatedCount: { fontSize: 12, color: '#94A3B8', fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  relatedCard: { width: 150, marginRight: 12, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.02)', overflow: 'hidden' },
  relatedThumb: { width: 150, height: 85, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  relatedTitle: { fontSize: 12, fontWeight: '600', color: '#1E293B', padding: 8, paddingBottom: 4, lineHeight: 16, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
  relatedMeta: { fontSize: 11, color: '#94A3B8', paddingHorizontal: 8, paddingBottom: 8, fontFamily: Platform.OS === 'web' ? 'system-ui' : undefined },
});
