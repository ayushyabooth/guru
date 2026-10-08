/**
 * Perf panel (admins only, every build). The home screen renders it only when
 * GET /me/access says is_admin; every endpoint it reads checks admin again on
 * the server.
 *
 * Tabs: Agent (traces, the default), Reports (beta bug reports, GUR-242),
 * API (latency + recent calls) and Ingestion. API and Ingestion share one
 * /admin/perf-metrics fetch.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Spacing } from '@/constants/liquidGlass';
import { getPerfMetrics, toAdminError } from '../services/admin-service';
import type { PerfMetrics } from '../services/admin-service';
import { AdminPalette, AdminType, MONO, useAdminPalette, withAlpha } from './admin/adminTheme';
import { Segmented, SegmentOption } from './admin/AdminUI';
import AgentPerfTab from './admin/AgentPerfTab';
import ReportsTab from './admin/ReportsTab';

// --- Helpers ---

function msColor(ms: number, P: AdminPalette): string {
  if (ms < 100) return P.good;
  if (ms < 300) return P.warn;
  if (ms < 1000) return P.orange;
  return P.bad;
}

function statusColor(status: number, P: AdminPalette): string {
  if (status < 300) return P.good;
  if (status < 400) return P.info;
  if (status < 500) return P.warn;
  return P.bad;
}

function runStatusColor(status: string, P: AdminPalette): string {
  if (status === 'completed') return P.good;
  if (status === 'running') return P.info;
  return P.bad;
}

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function shortPath(path: string): string {
  return path.replace('/api/v1/', '/');
}

// --- Layout ---

type PanelTab = 'agent' | 'reports' | 'api' | 'ingestion';

const TAB_OPTIONS: SegmentOption<PanelTab>[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'reports', label: 'Reports' },
  { value: 'api', label: 'API' },
  { value: 'ingestion', label: 'Ingestion' },
];

const PANEL_TOP = 56;
const PANEL_PADDING = 14;
/** Keeps the panel clear of the floating tab bar (72px tall, 12px off the bottom). */
const PANEL_BOTTOM_RESERVE = 100;

// --- Sections ---

type SectionKey = 'api' | 'recent' | 'ingestion' | 'content';

export default function DevMetricsPanel() {
  const P = useAdminPalette();
  const s = useMemo(() => makeStyles(P), [P]);
  const { height: windowHeight } = useWindowDimensions();

  const [isExpanded, setIsExpanded] = useState(false);
  // Once opened, the panel stays mounted (hidden when closed) so the Agent
  // tab keeps its filters, data and scroll position between opens.
  const [hasOpened, setHasOpened] = useState(false);
  const [tab, setTab] = useState<PanelTab>('agent');
  const [agentRefresh, setAgentRefresh] = useState(0);
  // Reports loads on its first view, then stays mounted like Agent.
  const [reportsOpened, setReportsOpened] = useState(false);
  const [reportsRefresh, setReportsRefresh] = useState(0);
  const [chromeHeight, setChromeHeight] = useState(84);
  const isMetricsTab = tab === 'api' || tab === 'ingestion';

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
      const json = await getPerfMetrics();
      setData(json);
    } catch (e) {
      setError(toAdminError(e).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // API and Ingestion load on first view. After an error, Refresh retries.
  useEffect(() => {
    if (isExpanded && isMetricsTab && !data && !loading && !error) {
      fetchMetrics();
    }
  }, [isExpanded, isMetricsTab, data, loading, error, fetchMetrics]);

  const selectTab = (next: PanelTab) => {
    if (next === 'reports') setReportsOpened(true);
    setTab(next);
  };

  const toggleSection = (key: SectionKey) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const onRefresh = () => {
    if (tab === 'agent') setAgentRefresh(n => n + 1);
    else if (tab === 'reports') setReportsRefresh(n => n + 1);
    else fetchMetrics();
  };

  const open = () => {
    setHasOpened(true);
    setIsExpanded(true);
  };

  const panelMaxHeight = Math.max(320, windowHeight - PANEL_TOP - PANEL_BOTTOM_RESERVE);
  const bodyMaxHeight = Math.max(160, panelMaxHeight - chromeHeight - PANEL_PADDING * 2);

  return (
    <>
      {!isExpanded && (
        <TouchableOpacity
          style={s.toggleButton}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel="Open performance panel"
        >
          <Text style={s.toggleText}>Perf</Text>
        </TouchableOpacity>
      )}

      {hasOpened && (
        <View style={[s.panel, { maxHeight: panelMaxHeight }, !isExpanded && s.hidden]}>
          {/* Header + tabs */}
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setChromeHeight(h);
            }}
          >
            <View style={s.header}>
              <Text style={s.title} accessibilityRole="header">Performance</Text>
              <View style={s.headerActions}>
                <TouchableOpacity
                  onPress={onRefresh}
                  style={s.refreshBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh this tab"
                >
                  <Text style={s.refreshText}>Refresh</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setIsExpanded(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close performance panel"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.closeBtn}>X</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.tabsRow}>
              <Segmented
                options={TAB_OPTIONS}
                value={tab}
                onChange={selectTab}
                P={P}
                role="tab"
                accessibilityLabel="Performance sections"
              />
            </View>
          </View>

          {/* Agent: stays mounted so its filters and list survive tab switches */}
          <View style={tab === 'agent' ? null : s.hidden}>
            <AgentPerfTab refreshSignal={agentRefresh} maxHeight={bodyMaxHeight} />
          </View>

          {/* Reports: mounted on first view, then kept like Agent (an open report survives tab switches) */}
          {reportsOpened && (
            <View style={tab === 'reports' ? null : s.hidden}>
              <ReportsTab refreshSignal={reportsRefresh} maxHeight={bodyMaxHeight} />
            </View>
          )}

          {isMetricsTab && (
            <>
              {loading && !data && (
                <ActivityIndicator color={P.accent} style={{ marginVertical: 12 }} />
              )}
              {error && <Text style={s.errorText}>{error}</Text>}

              {data && (
                <ScrollView
                  style={[s.scroll, { maxHeight: bodyMaxHeight }]}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {tab === 'api' ? (
                    <>
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
                          {expandedSections.api ? '▾' : '▸'} API Performance
                        </Text>
                        {data.api.slowest.length > 0 && (
                          <Text style={[s.badge, { backgroundColor: msColor(data.api.slowest[0].p95_ms, P) }]}>
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
                                <Text style={[s.timingVal, { color: msColor(ep.p50_ms, P) }]}>
                                  P50:{Math.round(ep.p50_ms)}
                                </Text>
                                <Text style={[s.timingVal, { color: msColor(ep.p95_ms, P) }]}>
                                  P95:{Math.round(ep.p95_ms)}
                                </Text>
                                <Text style={[s.timingVal, { color: msColor(ep.max_ms, P) }]}>
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
                          {expandedSections.recent ? '▾' : '▸'} Recent Calls ({data.api.recent.length})
                        </Text>
                      </TouchableOpacity>
                      {expandedSections.recent && (
                        <View style={s.sectionContent}>
                          {data.api.recent.slice(0, 15).map((call, i) => (
                            <View key={i} style={s.recentRow}>
                              <View style={s.recentLeft}>
                                <Text style={[s.methodBadge, { color: statusColor(call.status, P) }]}>
                                  {call.method}
                                </Text>
                                <Text style={s.recentPath} numberOfLines={1}>{shortPath(call.path)}</Text>
                              </View>
                              <View style={s.recentRight}>
                                <Text style={[s.recentMs, { color: msColor(call.ms, P) }]}>
                                  {Math.round(call.ms)}ms
                                </Text>
                                <Text style={s.recentAgo}>{formatAgo(call.ago_s)}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Ingestion */}
                      <TouchableOpacity onPress={() => toggleSection('ingestion')} style={s.sectionHeaderFirst}>
                        <Text style={s.sectionTitle}>
                          {expandedSections.ingestion ? '▾' : '▸'} Ingestion
                        </Text>
                      </TouchableOpacity>
                      {expandedSections.ingestion && (
                        <View style={s.sectionContent}>
                          {Object.entries(data.ingestion.last_runs).map(([tier, run]) => {
                            const runColor = runStatusColor(run.status, P);
                            return (
                              <View key={tier} style={s.ingestionTier}>
                                <View style={s.ingestionHeader}>
                                  <Text style={s.tierName}>{tier.replace('tier', 'T').replace('_', ' ')}</Text>
                                  <Text style={[
                                    s.statusBadge,
                                    { backgroundColor: withAlpha(runColor, 0.18), color: runColor },
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
                                        <Text style={[s.stepMs, { color: msColor(ms as number, P) }]}>
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
                            );
                          })}
                          {Object.keys(data.ingestion.last_runs).length === 0 && (
                            <Text style={s.emptyText}>No ingestion runs recorded</Text>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </ScrollView>
              )}
            </>
          )}
        </View>
      )}
    </>
  );
}

// --- Styles (theme-aware: built from the admin palette) ---

function makeStyles(P: AdminPalette) {
  return StyleSheet.create({
    hidden: {
      display: 'none',
    },
    toggleButton: {
      position: 'absolute',
      top: 62,
      right: 70,
      zIndex: 100,
      backgroundColor: P.toggleBg,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: Spacing.sm,
    },
    toggleText: {
      color: P.onSolid,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    panel: {
      position: 'absolute',
      top: PANEL_TOP,
      right: 12,
      left: 12,
      zIndex: 101,
      backgroundColor: P.panelBg,
      borderRadius: Spacing.md,
      padding: PANEL_PADDING,
      borderWidth: 1,
      borderColor: P.panelBorder,
      overflow: 'hidden',
      shadowColor: P.shadow,
      shadowOffset: { width: 0, height: Spacing.sm },
      shadowOpacity: P.isDark ? 0.4 : 0.14,
      shadowRadius: Spacing.md,
      elevation: 25,
      ...Platform.select({
        web: {
          backdropFilter: 'blur(40px) saturate(190%)',
          WebkitBackdropFilter: 'blur(40px) saturate(190%)',
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
      ...AdminType.title,
      color: P.accent,
      letterSpacing: 0.5,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    refreshBtn: {
      backgroundColor: P.accentBg,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderRadius: 6,
    },
    refreshText: {
      color: P.accent,
      fontSize: 11,
      fontWeight: '600',
    },
    closeBtn: {
      color: P.textTertiary,
      fontSize: Spacing.md,
      fontWeight: '700',
      padding: Spacing.xs,
    },
    tabsRow: {
      marginBottom: 10,
    },
    scroll: {
      flexGrow: 0,
    },
    errorText: {
      color: P.bad,
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
      backgroundColor: P.surface,
      borderRadius: 10,
      padding: 10,
      alignItems: 'center',
    },
    statNum: {
      color: P.text,
      fontSize: 18,
      fontWeight: '700',
    },
    statLabel: {
      color: P.textTertiary,
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
      borderTopColor: P.divider,
    },
    sectionHeaderFirst: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    sectionTitle: {
      color: P.text,
      fontSize: 12,
      fontWeight: '700',
    },
    sectionContent: {
      marginBottom: Spacing.sm,
    },
    badge: {
      color: P.onSolid,
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
      backgroundColor: P.surface,
      borderRadius: Spacing.sm,
      padding: Spacing.sm,
    },
    endpointPath: {
      color: P.textSecondary,
      fontSize: 11,
      fontFamily: MONO,
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
      fontFamily: MONO,
    },
    countBadge: {
      color: P.textTertiary,
      fontSize: 10,
      fontWeight: '600',
      marginLeft: 'auto',
    },
    moreText: {
      color: P.textTertiary,
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
      borderBottomColor: P.divider,
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
      color: P.textSecondary,
      fontSize: 10,
      fontFamily: MONO,
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
      fontFamily: MONO,
      width: 45,
      textAlign: 'right',
    },
    recentAgo: {
      color: P.textTertiary,
      fontSize: 9,
      width: Spacing.xxl,
      textAlign: 'right',
    },

    // Ingestion
    ingestionTier: {
      backgroundColor: P.surface,
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
      color: P.text,
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
      color: P.textSecondary,
      fontSize: 10,
      fontWeight: '600',
    },
    stepTimings: {
      borderTopWidth: 1,
      borderTopColor: P.divider,
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
      color: P.textSecondary,
      fontSize: 10,
    },
    stepMs: {
      fontSize: 10,
      fontWeight: '700',
      fontFamily: MONO,
    },
    ingestionTime: {
      color: P.textTertiary,
      fontSize: 9,
      marginTop: Spacing.xs,
    },
    emptyText: {
      color: P.textTertiary,
      fontSize: 11,
      textAlign: 'center',
      paddingVertical: Spacing.sm,
    },
  });
}
