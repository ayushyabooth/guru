import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { API_BASE_URL } from '../constants/config';
import { getAuthToken } from '../utils/auth';
import { Spacing } from '@/constants/liquidGlass';

// --- Types matching /admin/perf-metrics response ---

interface EndpointStats {
  count: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  avg_ms: number;
}

interface RecentCall {
  method: string;
  path: string;
  status: number;
  ms: number;
  ago_s: number;
}

interface SlowestEndpoint extends EndpointStats {
  path: string;
}

interface IngestionRun {
  status: string;
  started_at: string | null;
  completed_at: string | null;
  articles_found: number;
  articles_ingested: number;
  articles_rejected: number;
  step_timings: Record<string, number> | null;
}

interface PerfMetrics {
  api: {
    endpoints: Record<string, EndpointStats>;
    recent: RecentCall[];
    slowest: SlowestEndpoint[];
    total_requests: number;
  };
  ingestion: {
    tiers: Record<string, Array<{ step: string; ms: number; detail: string; ago_s: number }>>;
    total_steps: number;
    last_runs: Record<string, IngestionRun>;
  };
  content: {
    total_articles: number;
    total_storyboards: number;
  };
}

// --- Helpers ---

function msColor(ms: number): string {
  if (ms < 100) return '#22C55E';   // green
  if (ms < 300) return '#F59E0B';   // amber
  if (ms < 1000) return '#F97316';  // orange
  return '#EF4444';                  // red
}

function statusColor(status: number): string {
  if (status < 300) return '#22C55E';
  if (status < 400) return '#3B82F6';
  if (status < 500) return '#F59E0B';
  return '#EF4444';
}

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function shortPath(path: string): string {
  return path.replace('/api/v1/', '/');
}

// --- Sections ---

type SectionKey = 'api' | 'recent' | 'ingestion' | 'content';

export default function DevMetricsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [data, setData] = useState<PerfMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<SectionKey, boolean>>({
    api: true,
    recent: false,
    ingestion: true,
    content: true,
  });

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE_URL}/admin/perf-metrics`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isExpanded && !data) {
      fetchMetrics();
    }
  }, [isExpanded, data, fetchMetrics]);

  const toggleSection = (key: SectionKey) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!isExpanded) {
    return (
      <TouchableOpacity
        style={s.toggleButton}
        onPress={() => setIsExpanded(true)}
      >
        <Text style={s.toggleText}>Perf</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.panel}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Dev Metrics</Text>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={fetchMetrics} style={s.refreshBtn}>
            <Text style={s.refreshText}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsExpanded(false)}>
            <Text style={s.closeBtn}>X</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && !data && (
        <ActivityIndicator color="#38BDF8" style={{ marginVertical: 12 }} />
      )}
      {error && <Text style={s.errorText}>{error}</Text>}

      {data && (
        <ScrollView style={s.scroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {/* Content Stats (quick numbers at top) */}
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Text style={s.statNum}>{data.content.total_articles}</Text>
              <Text style={s.statLabel}>Articles</Text>
            </View>
            <View style={s.statBox}>
              <Text style={s.statNum}>{data.content.total_storyboards}</Text>
              <Text style={s.statLabel}>Storyboards</Text>
            </View>
            <View style={s.statBox}>
              <Text style={s.statNum}>{data.api.total_requests}</Text>
              <Text style={s.statLabel}>API Calls</Text>
            </View>
          </View>

          {/* API Performance */}
          <TouchableOpacity onPress={() => toggleSection('api')} style={s.sectionHeader}>
            <Text style={s.sectionTitle}>
              {expandedSections.api ? '>' : '>'} API Performance
            </Text>
            {data.api.slowest.length > 0 && (
              <Text style={[s.badge, { backgroundColor: msColor(data.api.slowest[0].p95_ms) }]}>
                P95: {Math.round(data.api.slowest[0].p95_ms)}ms
              </Text>
            )}
          </TouchableOpacity>
          {expandedSections.api && (
            <View style={s.sectionContent}>
              {data.api.slowest.map((ep, i) => (
                <View key={i} style={s.endpointRow}>
                  <Text style={s.endpointPath} numberOfLines={1}>{shortPath(ep.path)}</Text>
                  <View style={s.timingRow}>
                    <Text style={[s.timingVal, { color: msColor(ep.p50_ms) }]}>
                      P50:{Math.round(ep.p50_ms)}
                    </Text>
                    <Text style={[s.timingVal, { color: msColor(ep.p95_ms) }]}>
                      P95:{Math.round(ep.p95_ms)}
                    </Text>
                    <Text style={[s.timingVal, { color: msColor(ep.max_ms) }]}>
                      Max:{Math.round(ep.max_ms)}
                    </Text>
                    <Text style={s.countBadge}>{ep.count}x</Text>
                  </View>
                </View>
              ))}
              {Object.keys(data.api.endpoints).length > 5 && (
                <Text style={s.moreText}>
                  +{Object.keys(data.api.endpoints).length - 5} more endpoints
                </Text>
              )}
            </View>
          )}

          {/* Recent API Calls */}
          <TouchableOpacity onPress={() => toggleSection('recent')} style={s.sectionHeader}>
            <Text style={s.sectionTitle}>
              {expandedSections.recent ? '>' : '>'} Recent Calls ({data.api.recent.length})
            </Text>
          </TouchableOpacity>
          {expandedSections.recent && (
            <View style={s.sectionContent}>
              {data.api.recent.slice(0, 15).map((call, i) => (
                <View key={i} style={s.recentRow}>
                  <View style={s.recentLeft}>
                    <Text style={[s.methodBadge, { color: statusColor(call.status) }]}>
                      {call.method}
                    </Text>
                    <Text style={s.recentPath} numberOfLines={1}>{shortPath(call.path)}</Text>
                  </View>
                  <View style={s.recentRight}>
                    <Text style={[s.recentMs, { color: msColor(call.ms) }]}>
                      {Math.round(call.ms)}ms
                    </Text>
                    <Text style={s.recentAgo}>{formatAgo(call.ago_s)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Ingestion */}
          <TouchableOpacity onPress={() => toggleSection('ingestion')} style={s.sectionHeader}>
            <Text style={s.sectionTitle}>
              {expandedSections.ingestion ? '>' : '>'} Ingestion
            </Text>
          </TouchableOpacity>
          {expandedSections.ingestion && (
            <View style={s.sectionContent}>
              {Object.entries(data.ingestion.last_runs).map(([tier, run]) => (
                <View key={tier} style={s.ingestionTier}>
                  <View style={s.ingestionHeader}>
                    <Text style={s.tierName}>{tier.replace('tier', 'T').replace('_', ' ')}</Text>
                    <Text style={[
                      s.statusBadge,
                      { backgroundColor: run.status === 'completed' ? 'rgba(34,197,94,0.2)' : run.status === 'running' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)' },
                      { color: run.status === 'completed' ? '#22C55E' : run.status === 'running' ? '#3B82F6' : '#EF4444' },
                    ]}>
                      {run.status}
                    </Text>
                  </View>
                  <View style={s.ingestionStats}>
                    <Text style={s.ingestionStat}>Found: {run.articles_found}</Text>
                    <Text style={s.ingestionStat}>In: {run.articles_ingested}</Text>
                    <Text style={s.ingestionStat}>Out: {run.articles_rejected}</Text>
                  </View>
                  {run.step_timings && (
                    <View style={s.stepTimings}>
                      {Object.entries(run.step_timings).map(([step, ms]) => (
                        <View key={step} style={s.stepRow}>
                          <Text style={s.stepName}>{step.replace(/_ms$/, '')}</Text>
                          <Text style={[s.stepMs, { color: msColor(ms as number) }]}>
                            {ms >= 1000 ? `${((ms as number) / 1000).toFixed(1)}s` : `${Math.round(ms as number)}ms`}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {run.started_at && (
                    <Text style={s.ingestionTime}>
                      {new Date(run.started_at).toLocaleString()}
                    </Text>
                  )}
                </View>
              ))}
              {Object.keys(data.ingestion.last_runs).length === 0 && (
                <Text style={s.emptyText}>No ingestion runs recorded</Text>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// --- Styles ---

const s = StyleSheet.create({
  toggleButton: {
    position: 'absolute',
    top: 62,
    right: 70,
    zIndex: 100,
    backgroundColor: 'rgba(56, 189, 248, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Spacing.sm,
  },
  toggleText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  panel: {
    position: 'absolute',
    top: 56,
    right: 12,
    left: 12,
    zIndex: 101,
    backgroundColor: 'rgba(15, 15, 20, 0.95)',
    borderRadius: Spacing.md,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    maxHeight: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: Spacing.sm },
    shadowOpacity: 0.4,
    shadowRadius: Spacing.md,
    elevation: 25,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      } as any,
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  refreshBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 6,
  },
  refreshText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  closeBtn: {
    color: '#64748B',
    fontSize: Spacing.md,
    fontWeight: '700',
    padding: Spacing.xs,
  },
  scroll: {
    maxHeight: 420,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 11,
    textAlign: 'center',
    marginVertical: Spacing.sm,
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  statNum: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },

  // Sections
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionContent: {
    marginBottom: Spacing.sm,
  },
  badge: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Spacing.xs,
    overflow: 'hidden',
  },

  // Endpoint rows
  endpointRow: {
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: Spacing.sm,
    padding: Spacing.sm,
  },
  endpointPath: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    marginBottom: Spacing.xs,
  },
  timingRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  timingVal: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  countBadge: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  moreText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },

  // Recent calls
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  recentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  methodBadge: {
    fontSize: 9,
    fontWeight: '800',
    width: 30,
  },
  recentPath: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    flex: 1,
  },
  recentRight: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  recentMs: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    width: 45,
    textAlign: 'right',
  },
  recentAgo: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    width: Spacing.xxl,
    textAlign: 'right',
  },

  // Ingestion
  ingestionTier: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: Spacing.sm,
    padding: Spacing.sm,
    marginBottom: 6,
  },
  ingestionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  tierName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  statusBadge: {
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Spacing.xs,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  ingestionStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: Spacing.xs,
  },
  ingestionStat: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '600',
  },
  stepTimings: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: Spacing.xs,
    marginTop: Spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  stepName: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
  },
  stepMs: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  ingestionTime: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    marginTop: Spacing.xs,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
});
