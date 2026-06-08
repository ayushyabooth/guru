import { h } from 'preact';
import { richContent, overlayData, activeTab, pendingPrompt, panelVisible } from '../../state';

/**
 * Scroll the publisher article to where a spotlight quote appears and flash it,
 * then minimise the panel so the reader sees the passage in context. Matches on
 * a leading substring of the quote (quotes are extracted verbatim-ish).
 */
function scrollToQuote(quote: string) {
  const clean = quote.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '');
  const needle = clean.slice(0, 45).trim();
  if (needle.length < 6) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const p = (node as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      if (p.closest('#guru-root, .guru-panel, .guru-fab')) return NodeFilter.FILTER_REJECT;
      return (node.textContent || '').includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  } as any);
  const node = walker.nextNode() as Text | null;
  const el = node?.parentElement as HTMLElement | undefined;
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prevBg = el.style.backgroundColor;
  const prevTr = el.style.transition;
  el.style.transition = 'background-color 0.35s ease';
  el.style.backgroundColor = 'rgba(99,102,241,0.28)';
  setTimeout(() => { el.style.backgroundColor = prevBg; setTimeout(() => { el.style.transition = prevTr; }, 400); }, 1400);
  // Drop the sheet to its minimised snap so the passage is visible.
  panelVisible.value = false;
}

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
            {/* Tapping a quote scrolls the article to where it appears and
                flashes it, so the reader sees it in context. */}
            {content.spotlight_quotes.map((quote, i) => (
              <div
                key={i}
                class="guru-quote-card guru-interactive"
                style={{ cursor: 'pointer' }}
                onClick={() => scrollToQuote(quote)}
                title="Jump to this quote in the article"
              >
                {quote}
              </div>
            ))}
          </div>
        </div>
      )}

      {content.socratic_prompts && content.socratic_prompts.length > 0 && (
        <div class="guru-section">
          <div class="guru-section-title">Think about it</div>
          {/* Tapping a prompt jumps straight into the Ask Guru flow and asks it. */}
          {content.socratic_prompts.map((prompt, i) => (
            <div
              key={i}
              class="guru-socratic-prompt"
              onClick={() => { pendingPrompt.value = prompt; activeTab.value = 3; }}
            >
              {prompt}
            </div>
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
