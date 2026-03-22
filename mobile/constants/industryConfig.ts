/**
 * Central Industry & Specialization Visual Config
 *
 * THE single source of truth (frontend side) for all industry/specialization/interest
 * visual properties: colors, icons, dark-mode variants, glass tints.
 *
 * Architecture:
 *   - Backend `industries-specializations.json` is the canonical source
 *   - Backend serves it via GET /config/visual-config
 *   - This file has a STATIC FALLBACK that mirrors the backend config
 *   - Call `loadVisualConfigFromAPI()` on app startup to sync with backend
 *   - If the API is unreachable, the static fallback is used
 *
 * To add a new industry or specialization:
 *   1. Add the entry to backend/config/industries-specializations.json
 *   2. Update the STATIC_REGISTRY below to match (fallback for offline)
 *   3. That's it — everything else derives automatically
 */

// ── Helper: hex → rgba ──────────────────────────────────────────────
function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── Types ────────────────────────────────────────────────────────────

export interface IndustryVisualConfig {
  /** Canonical snake_case id (matches backend) */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Primary accent color (hex) */
  accent: string;
  /** Secondary accent for gradients (hex, optional — defaults to accent) */
  accentSecondary?: string;
  /** Vector icon name from MaterialCommunityIcons (or MaterialIcons when noted) */
  icon: string;
  /** Icon library: 'mci' = MaterialCommunityIcons, 'mi' = MaterialIcons */
  iconLibrary?: 'mci' | 'mi';
  /** Legacy emoji (kept for backward compat, will be phased out) */
  emoji: string;
  /** Category: which parent group this belongs to */
  category?: string;
}

export interface ResolvedVisualConfig extends IndustryVisualConfig {
  /** Light-mode background tint: accent at 8% opacity */
  bgLight: string;
  /** Dark-mode background tint: accent at 15% opacity */
  bgDark: string;
  /** Glass glow color: accent at 25% opacity */
  glow: string;
  /** Glass tint: accent at 8% opacity */
  tint: string;
  /** Light tint for backgrounds: accent at 4% opacity */
  lightTint: string;
  /** Gradient array for glass materials */
  gradient: string[];
}

// ── Static Fallback Registry ─────────────────────────────────────────
// Mirrors backend/config/industries-specializations.json.
// Used when the API is unreachable. Keep in sync when adding new entries.

const STATIC_REGISTRY: IndustryVisualConfig[] = [
  // ── Core Industries ──
  { id: 'consumer',    displayName: 'Consumer',    accent: '#10B981', accentSecondary: '#059669', icon: 'shopping-outline',    emoji: '🛍️', category: 'core' },
  { id: 'finance',     displayName: 'Finance',     accent: '#2563EB', accentSecondary: '#1E40AF', icon: 'chart-line',          emoji: '💰', category: 'core' },
  { id: 'technology',  displayName: 'Technology',  accent: '#4F46E5', accentSecondary: '#7C3AED', icon: 'monitor',             emoji: '🖥️', category: 'core' },

  // ── Consumer Specializations ──
  { id: 'food_beverage',                    displayName: 'Food & Beverage',                  accent: '#10B981', icon: 'food-apple-outline',         emoji: '🍔', category: 'consumer' },
  { id: 'health_beauty_personal_care',      displayName: 'Health/Beauty/Personal Care',       accent: '#EC4899', icon: 'spa-outline',                emoji: '💄', category: 'consumer' },
  { id: 'apparel_footwear',                 displayName: 'Apparel & Footwear',                accent: '#A855F7', icon: 'shoe-sneaker',               emoji: '👟', category: 'consumer' },
  { id: 'home_furniture',                   displayName: 'Home & Furniture',                  accent: '#F59E0B', icon: 'home-outline',               emoji: '🏠', category: 'consumer' },
  { id: 'general_merchandise_mass_retail',  displayName: 'General Merchandise & Mass Retail', accent: '#3B82F6', icon: 'store-outline',              emoji: '🏬', category: 'consumer' },
  { id: 'specialty_retail_ecommerce',       displayName: 'Specialty Retail & E-commerce',     accent: '#06B6D4', icon: 'cart-outline',               emoji: '🛒', category: 'consumer' },
  { id: 'restaurants_food_service',         displayName: 'Restaurants & Food Service',        accent: '#EF4444', icon: 'silverware-fork-knife',      emoji: '🍽️', category: 'consumer' },

  // ── Technology Specializations ──
  { id: 'enterprise_saas_software',         displayName: 'Enterprise SaaS & Software',        accent: '#4F46E5', icon: 'briefcase-outline',          emoji: '💼', category: 'technology' },
  { id: 'consumer_internet_social',         displayName: 'Consumer Internet & Social Media',  accent: '#3B82F6', icon: 'cellphone',                  emoji: '📱', category: 'technology' },
  { id: 'semiconductors_components',        displayName: 'Semiconductors & Components',       accent: '#6B7280', icon: 'chip',                       emoji: '🔌', category: 'technology' },
  { id: 'hardware_iot',                     displayName: 'Hardware & IoT',                    accent: '#0EA5E9', icon: 'access-point',               emoji: '📡', category: 'technology' },
  { id: 'cloud_infrastructure_it_services', displayName: 'Cloud Infrastructure & IT Services',accent: '#7C3AED', icon: 'cloud-outline',              emoji: '☁️', category: 'technology' },
  { id: 'fintech_technology',               displayName: 'FinTech (Technology focus)',         accent: '#22C55E', icon: 'credit-card-outline',        emoji: '💳', category: 'technology' },
  { id: 'media_entertainment_telecom',      displayName: 'Media/Entertainment/Telecom',       accent: '#EC4899', icon: 'movie-open-outline',         emoji: '🎬', category: 'technology' },

  // ── Finance Specializations ──
  { id: 'banking_diversified_financials',       displayName: 'Banking & Diversified Financials',      accent: '#2563EB', icon: 'bank-outline',             emoji: '🏦', category: 'finance' },
  { id: 'capital_markets_investment_banking',   displayName: 'Capital Markets & Investment Banking',   accent: '#1E40AF', icon: 'trending-up',             emoji: '📈', category: 'finance' },
  { id: 'asset_wealth_management',              displayName: 'Asset & Wealth Management',              accent: '#A855F7', icon: 'diamond-outline',          emoji: '💎', category: 'finance' },
  { id: 'insurance',                            displayName: 'Insurance',                              accent: '#F59E0B', icon: 'shield-outline',           emoji: '🛡️', category: 'finance' },
  { id: 'private_capital_pe_vc',                displayName: 'Private Capital (PE/VC)',                 accent: '#6B7280', icon: 'office-building-outline',  emoji: '🏢', category: 'finance' },
  { id: 'specialty_finance_alternative_lenders',displayName: 'Specialty Finance & Alternative Lenders', accent: '#EF4444', icon: 'cash-multiple',            emoji: '💵', category: 'finance' },
  { id: 'financial_technology_fintech',         displayName: 'Financial Technology (FinTech)',           accent: '#22C55E', icon: 'cellphone-link',           emoji: '📲', category: 'finance' },

  // ── Cross-cutting Interests ──
  { id: 'sustainability',          displayName: 'Sustainability',          accent: '#22C55E', icon: 'leaf',                  emoji: '🌱', category: 'interest' },
  { id: 'innovation',              displayName: 'Innovation',              accent: '#A855F7', icon: 'lightbulb-on-outline',  emoji: '💡', category: 'interest' },
  { id: 'digital_transformation',  displayName: 'Digital Transformation',  accent: '#06B6D4', icon: 'refresh',               emoji: '🔄', category: 'interest' },
  { id: 'ai_ml',                   displayName: 'AI/ML',                   accent: '#7C3AED', icon: 'robot-outline',          emoji: '🤖', category: 'interest' },
];

// ── Default/Fallback configs ─────────────────────────────────────────
const DEFAULT_CONFIG: IndustryVisualConfig = {
  id: 'default', displayName: 'General', accent: '#6B7280', icon: 'newspaper', emoji: '📰',
};
const CORE_CONFIG: IndustryVisualConfig = {
  id: 'core', displayName: 'Core', accent: '#38BDF8', icon: 'compass-outline', emoji: '📊', category: 'core',
};

// ── Build lookup index (normalized keys → config) ────────────────────

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[/()]/g, '_')     // slashes, parens → underscore
    .replace(/[&]/g, '_')       // ampersand → underscore
    .replace(/\s+/g, '_')       // spaces → underscore
    .replace(/_+/g, '_')        // collapse multiple underscores
    .replace(/^_|_$/g, '');     // trim leading/trailing underscores
}

/** Resolve a base config into a full config with computed colors */
function resolve(config: IndustryVisualConfig): ResolvedVisualConfig {
  const { accent, accentSecondary } = config;
  const secondary = accentSecondary || accent;
  return {
    ...config,
    bgLight: hexToRgba(accent, 0.08),
    bgDark: hexToRgba(accent, 0.15),
    glow: hexToRgba(accent, 0.25),
    tint: hexToRgba(accent, 0.08),
    lightTint: hexToRgba(accent, 0.04),
    gradient: [hexToRgba(accent, 0.08), hexToRgba(secondary, 0.25), hexToRgba(accent, 0.08)],
  };
}

/** Build the index from a registry array */
function buildIndex(registry: IndustryVisualConfig[]): Map<string, ResolvedVisualConfig> {
  const index = new Map<string, ResolvedVisualConfig>();
  for (const entry of registry) {
    const resolved = resolve(entry);
    index.set(entry.id, resolved);
    index.set(normalizeKey(entry.displayName), resolved);
  }
  index.set('default', resolve(DEFAULT_CONFIG));
  index.set('core', resolve(CORE_CONFIG));
  return index;
}

// Start with the static fallback
let _index = buildIndex(STATIC_REGISTRY);
let _registry = [...STATIC_REGISTRY];

// ── API Sync ─────────────────────────────────────────────────────────

interface APIVisualEntry {
  id: string;
  name: string;
  emoji: string;
  icon: string;
  color_primary: string;
  color_secondary?: string;
  category: string;
}

/**
 * Load visual config from the backend API and update the in-memory index.
 * Call this once on app startup. Falls back to static config on failure.
 *
 * @returns true if API load succeeded, false if using static fallback
 */
export async function loadVisualConfigFromAPI(): Promise<boolean> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const response = await fetch(`${apiUrl}/config/visual-config`);
    if (!response.ok) return false;

    const data: Record<string, APIVisualEntry> = await response.json();

    // Convert API format → IndustryVisualConfig[]
    const apiRegistry: IndustryVisualConfig[] = Object.values(data).map(entry => ({
      id: entry.id,
      displayName: entry.name,
      accent: entry.color_primary,
      accentSecondary: entry.color_secondary,
      icon: entry.icon || 'newspaper',
      emoji: entry.emoji || '📰',
      category: entry.category,
    }));

    if (apiRegistry.length > 0) {
      _registry = apiRegistry;
      _index = buildIndex(apiRegistry);
      return true;
    }
    return false;
  } catch {
    // API unreachable — keep using static fallback
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Look up visual config for any industry/specialization/interest key.
 * Handles snake_case, spaces, display names, etc.
 */
export function getIndustryConfig(key?: string): ResolvedVisualConfig {
  if (!key) return _index.get('default')!;
  const exact = _index.get(key);
  if (exact) return exact;
  const normalized = normalizeKey(key);
  return _index.get(normalized) || _index.get('default')!;
}

/**
 * Get just the accent color for a filter context (convenience).
 */
export function getIndustryAccent(key?: string): string {
  return getIndustryConfig(key).accent;
}

/**
 * Get the vector icon name + library for a filter context.
 */
export function getIndustryIcon(key?: string): { name: string; library: 'mci' | 'mi' } {
  const config = getIndustryConfig(key);
  return { name: config.icon, library: config.iconLibrary || 'mci' };
}

/**
 * Get all registered configs (for iteration, e.g. building filter chips).
 */
export function getAllIndustries(): ResolvedVisualConfig[] {
  return _registry.map(e => _index.get(e.id)!).filter(Boolean);
}

/**
 * Get configs filtered by category.
 */
export function getIndustriesByCategory(category: string): ResolvedVisualConfig[] {
  return _registry.filter(e => e.category === category).map(e => _index.get(e.id)!).filter(Boolean);
}

// ── Backward-compatible exports ──────────────────────────────────────

export interface FilterColorConfig {
  bg: string;
  accent: string;
  emoji: string;
  icon: string;
  iconLibrary: 'mci' | 'mi';
}

/**
 * Drop-in replacement for the old getFilterColors() from theme.ts.
 */
export function getFilterColors(filterContext?: string): FilterColorConfig {
  const config = getIndustryConfig(filterContext);
  return {
    bg: config.bgLight,
    accent: config.accent,
    emoji: config.emoji,
    icon: config.icon,
    iconLibrary: config.iconLibrary || 'mci',
  };
}

export interface FilterPalette {
  primary: string;
  gradient: string[];
  glow: string;
  tint: string;
  lightTint: string;
}

/**
 * Drop-in replacement for the old getPalette() from liquidGlass.ts.
 */
export function getFilterPalette(filterKey?: string): FilterPalette {
  const config = getIndustryConfig(filterKey);
  return {
    primary: config.accent,
    gradient: config.gradient,
    glow: config.glow,
    tint: config.tint,
    lightTint: config.lightTint,
  };
}

// ── Annotation type config (Reader Mode) ─────────────────────────────

export const AnnotationTypeConfig = {
  reflection:       { accent: '#10B981', icon: 'thought-bubble-outline', iconLibrary: 'mci' as const, label: 'Reflection' },
  expert_insight:   { accent: '#F59E0B', icon: 'lightbulb-outline',      iconLibrary: 'mci' as const, label: 'Expert Insight' },
  leading_question: { accent: '#38BDF8', icon: 'help-circle-outline',    iconLibrary: 'mci' as const, label: 'Leading Question' },
} as const;
