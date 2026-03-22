import { useDiveInContext, Article } from '../contexts/DiveInContext';

/**
 * Custom hook for managing Dive-in global state
 * Provides access to current article, context, articles list, and reading history
 */
export const useDiveInState = () => {
  const context = useDiveInContext();

  const switchContext = (newContext: string) => {
    context.setCurrentContext(newContext);
    // Filter articles by context would happen in the feed component
  };

  const openArticle = (article: Article) => {
    // Push current article to history if exists
    if (context.currentArticle) {
      context.pushToHistory(context.currentArticle.id);
    }
    context.setCurrentArticle(article);
  };

  const goBack = (): Article | null => {
    const previousArticleId = context.popFromHistory();
    
    if (previousArticleId) {
      // Find the article in the articles list
      const previousArticle = context.articles.find(a => a.id === previousArticleId);
      if (previousArticle) {
        context.setCurrentArticle(previousArticle);
        return previousArticle;
      }
    }
    
    // No previous article, return to feed
    context.setCurrentArticle(null);
    return null;
  };

  const updateArticles = (articles: Article[]) => {
    context.setArticles(articles);
  };

  return {
    currentArticle: context.currentArticle,
    currentContext: context.currentContext,
    articles: context.articles,
    readingHistory: context.readingHistory,
    switchContext,
    openArticle,
    goBack,
    updateArticles,
    clearHistory: context.clearHistory,
  };
};
