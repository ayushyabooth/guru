import { h } from 'preact';
import { richContent, overlayData } from '../../state';

export default function SummaryTab() {
  const content = richContent.value;
  const data = overlayData.value;
  const relatedArticles = data?.related_articles ?? [];

  if (!content) {
    return <div class="guru-loading">No summary available yet.</div>;
  }

  return (
    <div>
      {content.summary_whats_in && (
        <div class="guru-section">
          <div class="guru-section-title">What's in the article</div>
          <div class="guru-section-text">{content.summary_whats_in}</div>
        </div>
      )}

      {content.summary_why_matters && (
        <div class="guru-section">
          <div class="guru-section-title">Why it matters</div>
          <div class="guru-section-text">{content.summary_why_matters}</div>
        </div>
      )}

      {content.summary_between_lines && (
        <div class="guru-section">
          <div class="guru-section-title">Between the lines</div>
          <div class="guru-section-text">{content.summary_between_lines}</div>
        </div>
      )}

      {content.spotlight_quotes && content.spotlight_quotes.length > 0 && (
        <div class="guru-section">
          <div class="guru-section-title">Spotlight Quotes</div>
          <div class="guru-quotes-scroll">
            {content.spotlight_quotes.map((quote, i) => (
              <div key={i} class="guru-quote-card">{quote}</div>
            ))}
          </div>
        </div>
      )}

      {content.socratic_prompts && content.socratic_prompts.length > 0 && (
        <div class="guru-section">
          <div class="guru-section-title">Think about it</div>
          {content.socratic_prompts.map((prompt, i) => (
            <div key={i} class="guru-socratic-prompt">{prompt}</div>
          ))}
        </div>
      )}

      {relatedArticles.length > 0 && (
        <div class="guru-section">
          <div class="guru-section-title">
            Also in this story
            <span class="guru-related-count">{relatedArticles.length} articles</span>
          </div>
          <div class="guru-related-scroll">
            {relatedArticles.map((article: any) => (
              <a
                key={article.id}
                class="guru-related-card guru-interactive"
                href={article.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                title={article.title}
              >
                {article.thumbnail_url && (
                  <img
                    class="guru-related-thumb"
                    src={article.thumbnail_url}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div class="guru-related-title">{article.title}</div>
                <div class="guru-related-meta">
                  {article.source}
                  {article.word_count ? ` · ${Math.ceil(article.word_count / 200)} min` : ''}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
