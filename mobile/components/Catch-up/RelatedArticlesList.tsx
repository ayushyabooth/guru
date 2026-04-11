import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Article, NarrativeArticle } from '../../services/article-service';
import Icon from '../ui/Icon';

interface RelatedArticlesListProps {
  articles: Article[];
  isExpanded: boolean;
  onToggle: () => void;
  onSaveArticle: (articleId: string) => void;
  savedArticles: Set<string>;
  clusterNarrative?: string;
  narrativeArticles?: NarrativeArticle[];
}

export const RelatedArticlesList: React.FC<RelatedArticlesListProps> = ({
  articles,
  isExpanded,
  onToggle,
  onSaveArticle,
  savedArticles,
  clusterNarrative,
  narrativeArticles,
}) => {
  if (articles.length === 0) return null;
  
  // Helper to calculate reading time
  const getReadingTime = (wordCount: number, isPaywalled: boolean): number => {
    if (wordCount && wordCount > 0) {
      return Math.max(1, Math.round(wordCount / 225));
    }
    return isPaywalled ? 8 : 5;
  };
  
  // Bullet colors that rotate
  const bulletColors = ['#3B82F6', '#10B981', '#F59E0B'];
  
  // Extract context from cluster_narrative (text before "Also in this story:")
  const narrativeContext = clusterNarrative?.split('Also in this story:')[0]?.trim();
  
  return (
    <View>
      {/* Context Explanation */}
      {narrativeContext && (
        <View style={styles.contextContainer}>
          <Text style={styles.contextText}>
            {narrativeContext}
          </Text>
        </View>
      )}
      
      {/* Clickable "Also in this story" bullets */}
      {narrativeArticles && narrativeArticles.length > 0 && (
        <View style={styles.narrativeContainer}>
          <Text style={styles.narrativeHeader}>Also in this story:</Text>
          {narrativeArticles.map((article, idx) => (
            <TouchableOpacity
              key={article.id}
              style={styles.narrativeItem}
              onPress={() => Linking.openURL(article.url)}
            >
              <Icon name="circle" size={14} color={bulletColors[idx % bulletColors.length]} style={styles.narrativeBullet} />
              <Text style={styles.narrativeItemText} numberOfLines={1}>
                {article.title} ({getReadingTime(article.word_count, article.is_paywalled)} min)
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      
      <TouchableOpacity onPress={onToggle} style={styles.toggleButton}>
        <Text style={styles.toggleText}>
          {articles.length} related article{articles.length !== 1 ? 's' : ''}{' '}
          {isExpanded ? '▼' : '>'}
        </Text>
      </TouchableOpacity>
      
      {isExpanded && (
        <View style={styles.list}>
          {articles.map((article, idx) => (
            <View key={article.id} style={styles.listItem}>
              <Text style={styles.itemNumber}>{idx + 1}.</Text>
              <TouchableOpacity
                style={styles.itemContent}
                onPress={() => Linking.openURL(article.url)}
              >
                <Text style={styles.itemTitle} numberOfLines={2}>
                  {article.title}
                </Text>
                <Text style={styles.itemSource}>{article.source}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  savedArticles.has(article.id) && styles.saveButtonActive
                ]}
                onPress={() => onSaveArticle(article.id)}
              >
                <Text style={[
                  styles.saveButtonText,
                  savedArticles.has(article.id) && styles.saveButtonTextActive
                ]}>
                  {savedArticles.has(article.id) ? '✓' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  contextContainer: {
    marginBottom: 12,
    paddingBottom: 12,
  },
  contextText: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 20,
  },
  narrativeContainer: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  narrativeHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  narrativeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  narrativeBullet: {
    lineHeight: 20,
  },
  narrativeItemText: {
    flex: 1,
    fontSize: 12,
    color: '#38BDF8',
    fontFamily: 'monospace',
    textDecorationLine: 'underline',
  },
  toggleButton: {
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  toggleText: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: '500',
  },
  list: {
    marginTop: 8,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#eee',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  itemNumber: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    minWidth: 20,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
    color: '#F1F5F9',
  },
  itemSource: {
    fontSize: 11,
    color: '#64748B',
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    minWidth: 50,
    alignItems: 'center',
  },
  saveButtonActive: {
    backgroundColor: '#38BDF8',
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
  },
  saveButtonTextActive: {
    color: '#fff',
  },
});
