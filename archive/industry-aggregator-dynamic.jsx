import React, { useState, useEffect, useCallback } from "react";
import { Search, ExternalLink, Loader2, Download, Newspaper, ChevronDown, Calendar, Building2, X, RefreshCw, Clock, Database, Zap, CheckCircle, AlertCircle } from "lucide-react";

// Industry and Sub-industry configuration with search terms
const industryConfig = {
  "Consumer": {
    subIndustries: [
      { name: "Food & Beverage", searchTerms: ["food beverage industry news", "CPG food trends", "beverage market news"] },
      { name: "Health, Beauty & Personal Care", searchTerms: ["beauty industry news", "cosmetics market trends", "personal care CPG"] },
      { name: "Apparel & Footwear", searchTerms: ["apparel industry news", "footwear market trends", "fashion retail news"] },
      { name: "Home & Furniture", searchTerms: ["furniture industry news", "home furnishings market", "furniture retail trends"] },
      { name: "General Merchandise & Mass Retail", searchTerms: ["mass retail news", "general merchandise trends", "big box retail"] },
      { name: "Specialty Retail & E-commerce", searchTerms: ["ecommerce retail news", "specialty retail trends", "online retail market"] },
      { name: "Restaurants & Food Service", searchTerms: ["restaurant industry news", "foodservice trends", "QSR market news"] }
    ]
  },
  "Technology": {
    subIndustries: [
      { name: "Enterprise Software (SaaS)", searchTerms: ["enterprise software news", "SaaS industry trends", "B2B software market"] },
      { name: "Consumer Internet & Digital Platforms", searchTerms: ["consumer tech news", "digital platforms trends", "internet company news"] },
      { name: "Semiconductors & Chip Design", searchTerms: ["semiconductor industry news", "chip market trends", "semiconductor M&A"] },
      { name: "Hardware & Connected Devices", searchTerms: ["IoT industry news", "connected devices market", "hardware tech trends"] },
      { name: "Cloud Infrastructure & IT Services", searchTerms: ["cloud computing news", "IT services trends", "data center market"] },
      { name: "Financial Technology", searchTerms: ["fintech industry news", "payments technology trends", "digital banking news"] },
      { name: "Media & Telecom", searchTerms: ["telecom industry news", "media technology trends", "5G market news"] }
    ]
  },
  "Finance": {
    subIndustries: [
      { name: "Banking & Depository Institutions", searchTerms: ["banking industry news", "bank trends 2026", "commercial banking market"] },
      { name: "Capital Markets & Securities", searchTerms: ["capital markets news", "securities industry trends", "investment banking news"] },
      { name: "Asset & Wealth Management", searchTerms: ["asset management news", "wealth management trends", "investment management market"] },
      { name: "Insurance", searchTerms: ["insurance industry news", "insurance market trends", "insurtech news"] },
      { name: "Private Capital & Institutional Investors", searchTerms: ["private equity news", "venture capital trends", "private credit market"] },
      { name: "Specialty Finance & Alternative Lenders", searchTerms: ["alternative lending news", "specialty finance trends", "private credit news"] },
      { name: "Financial Technology (FinTech)", searchTerms: ["fintech news", "financial technology trends", "digital finance market"] }
    ]
  }
};

// Time period options
const timePeriods = [
  { id: "week", label: "Last Week", days: 7 },
  { id: "month", label: "Last Month", days: 30 },
  { id: "3months", label: "Last 3 Months", days: 90 }
];

// Trusted non-paywalled sources to prioritize
const trustedSources = [
  "Food Navigator", "Food Dive", "Beverage Daily", "Business of Fashion", "Beauty Independent",
  "Global Cosmetics News", "Retail Dive", "Retail Brew", "Modern Retail", "Nation's Restaurant News",
  "Restaurant Business", "Globe Newswire", "Fashion United", "WWD", "SiliconANGLE", "InfoWorld",
  "CIO", "CNBC", "IEEE Spectrum", "Semi Engineering", "IoT Insider", "IT Brew", "InformationWeek",
  "FinTech Futures", "Telecoms.com", "Deloitte", "Banking Dive", "American Banker", "KPMG",
  "Morgan Stanley", "PwC", "Oliver Wyman", "Insurance Journal", "IA Magazine", "PR Newswire",
  "Yahoo Finance", "EY", "Accenture", "McKinsey", "Bain", "BCG", "Reuters", "Bloomberg"
];

// Storage keys
const STORAGE_KEY = "industry-aggregator-articles";
const LAST_SYNC_KEY = "industry-aggregator-last-sync";

// Format today's date
const formatDate = () => {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

// Parse date string to Date object
const parseDate = (dateStr) => {
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

// Calculate period based on article date
const calculatePeriod = (articleDate) => {
  const now = new Date();
  const date = parseDate(articleDate);
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 7) return "week";
  if (diffDays <= 30) return "month";
  return "3months";
};

// Article Card Component
const ArticleCard = ({ article, rank }) => (
  <div className="group bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl border border-slate-700/50 p-4 hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10 transition-all duration-300">
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center text-slate-900 font-bold text-sm shadow-lg">
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <a 
          href={article.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-slate-100 group-hover:text-amber-400 font-medium text-sm leading-snug block transition-colors duration-200"
        >
          {article.title}
        </a>
        <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
          <span className="font-medium text-amber-500/80">{article.source}</span>
          <span className="text-slate-600">•</span>
          <span>{article.date}</span>
          <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${
            article.period === 'week' ? 'bg-emerald-500/20 text-emerald-400' :
            article.period === 'month' ? 'bg-blue-500/20 text-blue-400' :
            'bg-slate-600/50 text-slate-400'
          }`}>
            {article.period === 'week' ? 'This Week' : article.period === 'month' ? 'This Month' : '3 Months'}
          </span>
        </div>
      </div>
      <a 
        href={article.url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="flex-shrink-0 p-2 text-slate-500 hover:text-amber-400 hover:bg-slate-700/50 rounded-lg transition-all"
      >
        <ExternalLink size={14} />
      </a>
    </div>
  </div>
);

// Dropdown Component
const Dropdown = ({ label, value, options, onChange, placeholder, disabled = false }) => (
  <div className="relative">
    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">{label}</label>
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full appearance-none bg-slate-800 border rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all ${
          disabled ? 'border-slate-700 text-slate-500 cursor-not-allowed' : 'border-slate-600 cursor-pointer text-slate-100 hover:border-slate-500'
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={typeof opt === 'string' ? opt : (opt.id || opt.name)} value={typeof opt === 'string' ? opt : (opt.id || opt.name)}>
            {typeof opt === 'string' ? opt : (opt.label || opt.name)}
          </option>
        ))}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  </div>
);

// Sync Status Component
const SyncStatus = ({ lastSync, articleCount, isLoading }) => (
  <div className="flex items-center gap-4 text-xs text-slate-400">
    <div className="flex items-center gap-1.5">
      <Database size={12} className="text-amber-500/70" />
      <span>{articleCount} articles cached</span>
    </div>
    {lastSync && (
      <div className="flex items-center gap-1.5">
        <Clock size={12} className="text-slate-500" />
        <span>Last sync: {new Date(lastSync).toLocaleDateString()}</span>
      </div>
    )}
    {isLoading && (
      <div className="flex items-center gap-1.5 text-amber-400">
        <Loader2 size={12} className="animate-spin" />
        <span>Syncing...</span>
      </div>
    )}
  </div>
);

export default function IndustryAggregator() {
  const [selectedIndustry, setSelectedIndustry] = useState("");
  const [selectedSubIndustry, setSelectedSubIndustry] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("3months");
  const [articles, setArticles] = useState([]);
  const [allStoredArticles, setAllStoredArticles] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [syncStatus, setSyncStatus] = useState({ message: "", type: "" });
  const [isInitialized, setIsInitialized] = useState(false);

  const industries = Object.keys(industryConfig);
  const subIndustries = selectedIndustry 
    ? industryConfig[selectedIndustry].subIndustries.map(s => s.name) 
    : [];

  // Load stored articles on mount
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        // Load articles
        const storedResult = await window.storage.get(STORAGE_KEY);
        if (storedResult?.value) {
          const parsed = JSON.parse(storedResult.value);
          // Clean up articles older than 3 months
          const cleanedArticles = cleanOldArticles(parsed);
          setAllStoredArticles(cleanedArticles);
        }
        
        // Load last sync timestamp
        const syncResult = await window.storage.get(LAST_SYNC_KEY);
        if (syncResult?.value) {
          setLastSync(syncResult.value);
        }
      } catch (error) {
        console.log("No stored data found, starting fresh");
      }
      setIsInitialized(true);
    };
    
    loadStoredData();
  }, []);

  // Clean articles older than 3 months
  const cleanOldArticles = (articlesDb) => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
    
    const cleaned = {};
    Object.keys(articlesDb).forEach(subIndustry => {
      cleaned[subIndustry] = articlesDb[subIndustry].filter(article => {
        const articleDate = parseDate(article.date);
        return articleDate >= threeMonthsAgo;
      });
    });
    return cleaned;
  };

  // Save articles to storage
  const saveArticles = async (articlesDb) => {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(articlesDb));
      await window.storage.set(LAST_SYNC_KEY, new Date().toISOString());
      setLastSync(new Date().toISOString());
    } catch (error) {
      console.error("Failed to save articles:", error);
    }
  };

  // Fetch new articles using API
  const fetchNewArticles = async (subIndustryName, searchTerms, lastSyncDate, isFirstSync = false) => {
    const newArticles = [];
    
    // Build search query with time constraint
    // For first sync (no lastSyncDate), look back 3 months
    let timeConstraint = "";
    if (isFirstSync || !lastSyncDate) {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
      timeConstraint = `after:${threeMonthsAgo.toISOString().split('T')[0]}`;
    } else {
      timeConstraint = `after:${new Date(lastSyncDate).toISOString().split('T')[0]}`;
    }
    
    // For first sync, do more searches to get comprehensive coverage
    const searchLimit = isFirstSync ? 3 : 2;
    
    for (const term of searchTerms.slice(0, searchLimit)) { // More searches for first sync
      try {
        const query = `${term} ${timeConstraint}`.trim();
        const timeRangeDesc = isFirstSync ? "from the past 3 months" : "recent";
        
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            messages: [{
              role: "user",
              content: `Search for ${timeRangeDesc} industry news articles about: ${query}. Find ${isFirstSync ? '5-8' : '3-5'} articles from reputable non-paywalled sources like trade publications, news outlets, and industry journals. For each article, extract: title, source name, URL, and publication date. Focus on sources like: ${trustedSources.slice(0, 10).join(", ")}.`
            }]
          })
        });
        
        const data = await response.json();
        
        // Process the response to extract articles
        const textContent = data.content
          ?.filter(item => item.type === "text")
          ?.map(item => item.text)
          ?.join("\n") || "";
        
        // Parse articles from response (simplified extraction)
        const articleMatches = extractArticlesFromText(textContent, subIndustryName);
        newArticles.push(...articleMatches);
        
      } catch (error) {
        console.error(`Search failed for ${term}:`, error);
      }
    }
    
    return newArticles;
  };

  // Extract article data from AI response text
  const extractArticlesFromText = (text, subIndustry) => {
    const articles = [];
    const urlRegex = /https?:\/\/[^\s\)"\]]+/g;
    const urls = text.match(urlRegex) || [];
    
    // Simple extraction - look for patterns like "Title - Source (Date)" or similar
    const lines = text.split('\n').filter(l => l.trim());
    
    for (const url of urls.slice(0, 5)) { // Limit to 5 articles per search
      // Find the line containing this URL
      const contextLine = lines.find(l => l.includes(url)) || "";
      
      // Try to extract title (text before URL or source)
      let title = contextLine.replace(url, '').trim();
      title = title.replace(/[\[\]()]/g, '').trim();
      title = title.split(' - ')[0] || title.split(':')[0] || title;
      title = title.substring(0, 120).trim();
      
      if (title.length < 10) continue; // Skip if title too short
      
      // Try to identify source from URL
      const urlObj = new URL(url);
      let source = urlObj.hostname.replace('www.', '').split('.')[0];
      source = source.charAt(0).toUpperCase() + source.slice(1);
      
      // Check if source matches any trusted source
      const matchedSource = trustedSources.find(s => 
        url.toLowerCase().includes(s.toLowerCase().replace(/\s/g, ''))
      );
      if (matchedSource) source = matchedSource;
      
      const article = {
        title: title,
        source: source,
        url: url,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        period: "week",
        subIndustry: subIndustry,
        fetchedAt: new Date().toISOString()
      };
      
      // Avoid duplicates
      if (!articles.find(a => a.url === url)) {
        articles.push(article);
      }
    }
    
    return articles;
  };

  // Sync articles for selected industry/sub-industry
  const syncArticles = async () => {
    setIsSyncing(true);
    
    // Determine if this is first sync (no lastSync timestamp)
    const isFirstSync = !lastSync;
    
    setSyncStatus({ 
      message: isFirstSync ? "First sync - fetching last 3 months..." : "Starting sync...", 
      type: "info" 
    });
    
    const updatedArticles = { ...allStoredArticles };
    let totalNewArticles = 0;
    
    const subIndustriesToSync = selectedSubIndustry 
      ? [industryConfig[selectedIndustry].subIndustries.find(s => s.name === selectedSubIndustry)]
      : industryConfig[selectedIndustry].subIndustries;
    
    for (const subInd of subIndustriesToSync) {
      if (!subInd) continue;
      
      setSyncStatus({ 
        message: `${isFirstSync ? '[Initial] ' : ''}Searching ${subInd.name}...`, 
        type: "info" 
      });
      
      const newArticles = await fetchNewArticles(subInd.name, subInd.searchTerms, lastSync, isFirstSync);
      
      // Merge with existing articles, avoiding duplicates
      const existingUrls = new Set((updatedArticles[subInd.name] || []).map(a => a.url));
      const uniqueNewArticles = newArticles.filter(a => !existingUrls.has(a.url));
      
      updatedArticles[subInd.name] = [
        ...uniqueNewArticles,
        ...(updatedArticles[subInd.name] || [])
      ];
      
      totalNewArticles += uniqueNewArticles.length;
      
      // Small delay between sub-industries to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Clean old articles and save
    const cleanedArticles = cleanOldArticles(updatedArticles);
    await saveArticles(cleanedArticles);
    setAllStoredArticles(cleanedArticles);
    
    setSyncStatus({ 
      message: totalNewArticles > 0 
        ? `Found ${totalNewArticles} new article${totalNewArticles !== 1 ? 's' : ''}!` 
        : "No new articles found", 
      type: totalNewArticles > 0 ? "success" : "info" 
    });
    
    setIsSyncing(false);
    
    // Clear status after 3 seconds
    setTimeout(() => setSyncStatus({ message: "", type: "" }), 3000);
  };

  // Filter articles by time period
  const filterByPeriod = (articleList, period) => {
    // Recalculate periods based on current date
    const articlesWithPeriod = articleList.map(a => ({
      ...a,
      period: calculatePeriod(a.date)
    }));
    
    if (period === "week") {
      return articlesWithPeriod.filter(a => a.period === "week");
    } else if (period === "month") {
      return articlesWithPeriod.filter(a => a.period === "week" || a.period === "month");
    }
    return articlesWithPeriod;
  };

  // Generate articles based on selections (from cache)
  const generateArticles = () => {
    setIsLoading(true);
    setHasGenerated(true);
    
    setTimeout(() => {
      let allArticles = [];
      
      if (selectedSubIndustry) {
        allArticles = allStoredArticles[selectedSubIndustry] || [];
      } else if (selectedIndustry) {
        const subs = industryConfig[selectedIndustry].subIndustries;
        subs.forEach(sub => {
          const subArticles = allStoredArticles[sub.name] || [];
          allArticles = [...allArticles, ...subArticles];
        });
      }
      
      // Filter by time period
      const filteredArticles = filterByPeriod(allArticles, selectedPeriod);
      
      // Sort by date (most recent first)
      filteredArticles.sort((a, b) => parseDate(b.date) - parseDate(a.date));
      
      setArticles(filteredArticles);
      setIsLoading(false);
    }, 300);
  };

  // Reset selections
  const resetSelections = () => {
    setSelectedIndustry("");
    setSelectedSubIndustry("");
    setSelectedPeriod("3months");
    setArticles([]);
    setHasGenerated(false);
  };

  // Handle industry change
  const handleIndustryChange = (industry) => {
    setSelectedIndustry(industry);
    setSelectedSubIndustry("");
    setArticles([]);
    setHasGenerated(false);
  };

  // Download articles as markdown file
  const downloadMarkdown = () => {
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const periodLabel = timePeriods.find(p => p.id === selectedPeriod)?.label || "Last 3 Months";
    const categoryLabel = selectedSubIndustry 
      ? `${selectedIndustry} > ${selectedSubIndustry}`
      : `${selectedIndustry} (All Sub-Industries)`;

    let markdown = `# Industry News Links\n\n`;
    markdown += `**Generated:** ${today}\n`;
    markdown += `**Time Period:** ${periodLabel}\n\n`;
    markdown += `---\n\n`;
    markdown += `## ${categoryLabel}\n\n`;

    articles.forEach((article, index) => {
      markdown += `${index + 1}. [${article.title}](${article.url}) - *${article.source}* (${article.date})\n`;
    });

    markdown += `\n---\n\n`;
    markdown += `*Generated by Industry Content Aggregator*\n`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = selectedSubIndustry 
      ? `${selectedIndustry}_${selectedSubIndustry.replace(/[^a-zA-Z0-9]/g, '')}_Links_${new Date().toISOString().split('T')[0]}.md`
      : `${selectedIndustry}_All_Links_${new Date().toISOString().split('T')[0]}.md`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Count total cached articles
  const totalCachedArticles = Object.values(allStoredArticles).reduce(
    (sum, arr) => sum + (arr?.length || 0), 0
  );

  // Reset cache to trigger fresh first-time sync
  const resetCache = async () => {
    try {
      await window.storage.delete(STORAGE_KEY);
      await window.storage.delete(LAST_SYNC_KEY);
      setAllStoredArticles({});
      setLastSync(null);
      setArticles([]);
      setHasGenerated(false);
      setSyncStatus({ message: "Cache cleared. Next sync will fetch 3 months of articles.", type: "success" });
      setTimeout(() => setSyncStatus({ message: "", type: "" }), 3000);
    } catch (error) {
      console.error("Failed to reset cache:", error);
    }
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border border-slate-700/50 p-6 mb-6 shadow-xl">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/20">
                <Newspaper className="text-slate-900" size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Industry Aggregator</h1>
                <p className="text-sm text-slate-400 mt-0.5">{formatDate()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30">
                DYNAMIC
              </span>
            </div>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            Curated industry news from non-paywalled sources. Select an industry and sync to fetch the latest articles, or browse cached content.
          </p>
          <div className="mt-4 pt-4 border-t border-slate-700/50 flex items-center justify-between">
            <SyncStatus lastSync={lastSync} articleCount={totalCachedArticles} isLoading={isSyncing} />
            {totalCachedArticles > 0 && (
              <button
                onClick={resetCache}
                className="text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                Reset Cache
              </button>
            )}
          </div>
        </div>

        {/* Selection Panel */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-slate-700/50 p-6 mb-6 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <Dropdown
              label="Industry"
              value={selectedIndustry}
              options={industries}
              onChange={handleIndustryChange}
              placeholder="Select industry..."
            />
            <Dropdown
              label="Sub-Industry"
              value={selectedSubIndustry}
              options={subIndustries}
              onChange={setSelectedSubIndustry}
              placeholder="All sub-industries"
              disabled={!selectedIndustry}
            />
            <Dropdown
              label="Time Period"
              value={selectedPeriod}
              options={timePeriods}
              onChange={setSelectedPeriod}
              placeholder="Select period..."
            />
          </div>
          
          {/* Sync Status Message */}
          {syncStatus.message && (
            <div className={`mb-4 px-4 py-2 rounded-lg flex items-center gap-2 text-sm ${
              syncStatus.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
              syncStatus.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
              'bg-blue-500/20 text-blue-400 border border-blue-500/30'
            }`}>
              {syncStatus.type === 'success' ? <CheckCircle size={16} /> : 
               syncStatus.type === 'error' ? <AlertCircle size={16} /> : 
               <Loader2 size={16} className="animate-spin" />}
              {syncStatus.message}
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={generateArticles}
              disabled={!selectedIndustry || isLoading}
              className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                selectedIndustry && !isLoading
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-slate-900 hover:shadow-lg hover:shadow-amber-500/25 hover:scale-[1.02]'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Show Articles
                </>
              )}
            </button>
            
            <button
              onClick={syncArticles}
              disabled={!selectedIndustry || isSyncing}
              className={`py-3 px-4 rounded-xl font-semibold text-sm transition-all flex items-center gap-2 ${
                selectedIndustry && !isSyncing
                  ? 'bg-slate-700 text-slate-100 hover:bg-slate-600 border border-slate-600'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
            >
              <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Syncing...' : 'Sync New'}
            </button>
            
            {(selectedIndustry || hasGenerated) && (
              <button
                onClick={resetSelections}
                className="py-3 px-4 rounded-xl font-semibold text-sm border border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-slate-100 transition-all flex items-center gap-2"
              >
                <X size={16} />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {hasGenerated && !isLoading && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-slate-700/50 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  {selectedSubIndustry || selectedIndustry}
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  {articles.length} article{articles.length !== 1 ? 's' : ''} • {timePeriods.find(p => p.id === selectedPeriod)?.label}
                </p>
              </div>
              {articles.length > 0 && (
                <button
                  onClick={downloadMarkdown}
                  className="flex items-center gap-2 py-2 px-4 rounded-xl text-sm font-semibold border border-slate-600 text-slate-300 hover:bg-slate-700 transition-all"
                >
                  <Download size={16} />
                  Export MD
                </button>
              )}
            </div>
            
            {articles.length > 0 ? (
              <div className="space-y-3">
                {articles.map((article, index) => (
                  <ArticleCard key={article.url + index} article={article} rank={index + 1} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-800 rounded-2xl mb-4">
                  <Newspaper size={32} className="text-slate-600" />
                </div>
                <p className="text-slate-400 mb-2">No articles found for this selection.</p>
                <p className="text-slate-500 text-sm">Try syncing to fetch new articles or adjust your filters.</p>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!hasGenerated && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border border-slate-700/50 p-8 text-center shadow-xl">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-700 rounded-2xl mb-5 shadow-lg">
              <Building2 size={40} className="text-slate-500" />
            </div>
            <h3 className="text-slate-200 font-bold text-lg mb-2">Select an Industry to Begin</h3>
            <p className="text-sm text-slate-500 mb-6">Choose from 3 industries with 21 sub-industries</p>
            <div className="flex flex-wrap justify-center gap-3">
              {industries.map(ind => (
                <button
                  key={ind}
                  onClick={() => handleIndustryChange(ind)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-700 hover:text-amber-400 transition-all border border-slate-700 hover:border-amber-500/50"
                >
                  {ind}
                  <span className="ml-2 text-slate-500 text-xs">
                    ({industryConfig[ind].subIndustries.length})
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-slate-600">
          <p>Articles are cached locally and automatically cleaned after 90 days.</p>
          <p className="mt-1">Use "Sync New" to fetch latest articles from the web.</p>
        </div>
      </div>
    </div>
  );
}
