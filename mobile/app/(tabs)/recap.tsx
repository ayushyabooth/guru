import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { OrganicBackground } from '../../components/ui';
import Icon from '../../components/ui/Icon';
import GuruRings from '../../components/ui/GuruRings';
import { useMetrics } from '../../store/metric-context';
import {
  recapService,
  SnapshotData,
  GuidedQuestion,
  KeyInsight,
  SocraticResponse,
  RecapJourney,
  ScriptSegment,
} from '../../services/recap-service';
import {
  RecapRingProgress,
  SnapshotStage,
  QuestionsStage,
  SocraticStage,
  CommitmentScreen,
  CelebrationOverlay,
  InsightConstellation,
  AudioPlayerStage,
  RecapArchive,
  RecapDetail,
} from '../../components/Recap';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getBackdropBlur,
  getDarkBackdropBlur,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');

// Module-level audio polling — avoids React Compiler TDZ inside component
function startAudioPollingImpl(
  journeyId: string,
  pollingRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  setAudioUrl: React.Dispatch<React.SetStateAction<string | null>>,
  setAudioDuration: React.Dispatch<React.SetStateAction<number>>,
  setAudioStatus: React.Dispatch<React.SetStateAction<'idle' | 'generating' | 'ready' | 'failed' | 'text_only'>>,
  setAudioScript: React.Dispatch<React.SetStateAction<ScriptSegment[] | undefined>>,
  setViewState: React.Dispatch<React.SetStateAction<ViewState>>,
) {
  if (pollingRef.current) clearInterval(pollingRef.current);
  pollingRef.current = setInterval(async () => {
    try {
      const status = await recapService.getAudioStatus(journeyId);
      if (status.status === 'ready') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setAudioUrl(recapService.getAudioStreamUrl(journeyId));
        setAudioDuration(status.audio_duration_seconds || 0);
        setAudioStatus('ready');
        setViewState('audio');
      } else if (status.status === 'text_only') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setAudioScript(status.script || []);
        setAudioStatus('text_only');
        setViewState('audio');
      } else if (status.status === 'failed') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setAudioStatus('failed');
        Alert.alert('Audio Generation Failed', status.error || 'Please try again.');
      }
    } catch (err) {
    }
  }, 3000);
}

// ── Journey View States ─────────────────────────────────────────────
type ViewState =
  | 'entry'         // Ghost ring entry screen
  | 'loading'       // Starting journey / loading data
  | 'snapshot'      // Stage 1: Glass Memory Wall
  | 'questions'     // Stage 2: Guided Questions
  | 'socratic'      // Stage 3: Socratic Dialogue
  | 'commitment'    // Commitment prompt
  | 'celebration'   // Level-up celebration
  | 'audio'         // Stage 4: Audio player (Full tier)
  | 'archive'       // Learning journal view
  | 'detail';       // Past recap detail view

// Map stage_progress to ring fill percentage
const STAGE_PROGRESS_MAP: Record<number, number> = {
  0: 0,
  1: 0.25,
  2: 0.5,
  3: 0.75,
  4: 1.0,
};

export default function RecapScreen() {
  const { state, fetchMetrics } = useMetrics();
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const displayMetrics = state.metrics;

  // ── Core State ──────────────────────────────────────────────────
  const [viewState, setViewState] = useState<ViewState>('entry');
  const [journey, setJourney] = useState<RecapJourney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);

  // ── Stage Data ──────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [questions, setQuestions] = useState<GuidedQuestion[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [insights, setInsights] = useState<KeyInsight[]>([]);
  const [commitmentText, setCommitmentText] = useState('');
  const [socraticExchanges, setSocraticExchanges] = useState<Array<{ role: string; content: string }>>([]);

  // ── Audio State (Phase 2) ─────────────────────────────────────
  const [audioStatus, setAudioStatus] = useState<'idle' | 'generating' | 'ready' | 'failed' | 'text_only'>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioScript, setAudioScript] = useState<ScriptSegment[] | undefined>(undefined);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Derived Values ──────────────────────────────────────────────
  const ringProgress = journey ? STAGE_PROGRESS_MAP[journey.stage_progress] || 0 : 0;
  // Derive weekly activity summary from metrics
  const weeklyReadMinutes = displayMetrics.catchup.weeklyTotal + (displayMetrics.divein?.weeklyProgress || 0);
  const hasMinimumActivity = weeklyReadMinutes >= 5; // At least 5 minutes of reading
  const filtersExplored = state.profile?.specializations?.length
    ? 1 + state.profile.specializations.length + (state.profile.additionalInterests?.length || 0)
    : 1;

  // Determine recap status from metrics OR journey state
  const recapStatus = displayMetrics.recap.status;
  const hasCompletedRecap = recapStatus === 'completed' || journey?.status === 'completed';
  const isInProgress = recapStatus === 'in_progress' || (journey?.status?.startsWith('stage_') ?? false);

  // Derive stage completion for interactive stages
  const completedStages = hasCompletedRecap ? 4 : (journey?.stage_progress || 0);

  // Get current week date range (Monday–Sunday, matching backend Python weekday())
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  // ── Probe for existing in-progress journey on mount ──────────────
  // Only probe if metrics indicate an in-progress recap (avoids
  // accidentally creating a journey when user has 0 activity).
  useEffect(() => {
    let cancelled = false;
    if (recapStatus === 'in_progress') {
      (async () => {
        try {
          const j = await recapService.startJourney();
          if (!cancelled) {
            setJourney(j);
          }
        } catch {
          // No journey or auth issue — just stay on entry
        }
      })();
    }
    return () => {
      cancelled = true;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [recapStatus]);

  // ── Journey Lifecycle ───────────────────────────────────────────

  const handleBeginJourney = useCallback(async () => {
    setViewState('loading');
    setError(null);

    try {
      const journeyData = await recapService.startJourney();
      setJourney(journeyData);

      // If resumed and already completed, stay on entry — the completed card UI will show
      if (journeyData.resumed && journeyData.status === 'completed') {
        setViewState('entry');
        return;
      }

      // Route to the correct stage based on where user left off
      if (journeyData.resumed) {
        await resumeJourney(journeyData);
      } else {
        // Fresh journey — load snapshot and go to Stage 1
        const snapshotResp = await recapService.getSnapshot(journeyData.journey_id);
        setSnapshot(snapshotResp.snapshot);
        setViewState('snapshot');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start journey');
      setViewState('entry');
      Alert.alert('Error', err.message || 'Failed to start your recap journey. Please try again.');
    }
  }, []);

  const resumeJourney = async (j: RecapJourney) => {
    try {
      // Always load snapshot
      const snapshotResp = await recapService.getSnapshot(j.journey_id);
      setSnapshot(snapshotResp.snapshot);

      const stage = j.stage_progress;
      const status = j.status;

      if (status === 'completed') {
        // Already completed — show celebration with option to re-do
        setViewState('celebration');
        return;
      }

      if (stage >= 2 || status === 'stage_2' || status === 'stage_3' || status === 'commitment') {
        // Load questions data if past stage 1
        try {
          const qData = await recapService.getQuestions(j.journey_id);
          setQuestions(qData.questions);
          setResponses(qData.responses || {});
        } catch { /* questions may not exist yet for lite/early stages */ }
      }

      // Route to the right view
      if (status === 'stage_1') {
        setViewState('snapshot');
      } else if (status === 'stage_2') {
        setViewState('questions');
      } else if (status === 'stage_3') {
        // Load existing Socratic exchanges
        try {
          const summary = await recapService.getSummary(j.journey_id);
          if (summary?.socratic_exchanges) {
            setSocraticExchanges(summary.socratic_exchanges);
          }
        } catch { /* fine */ }
        setViewState('socratic');
      } else if (status === 'commitment') {
        setViewState('commitment');
      } else if (status === 'stage_4') {
        // Check audio status and resume accordingly
        try {
          const audioStatusResp = await recapService.getAudioStatus(j.journey_id);
          if (audioStatusResp.status === 'ready' && audioStatusResp.audio_url) {
            setAudioUrl(recapService.getAudioStreamUrl(j.journey_id));
            setAudioDuration(audioStatusResp.audio_duration_seconds || 0);
            setAudioStatus('ready');
            setViewState('audio');
          } else if (audioStatusResp.status === 'text_only') {
            setAudioScript(audioStatusResp.script || []);
            setAudioStatus('text_only');
            setViewState('audio');
          } else if (audioStatusResp.status === 'generating_script' || audioStatusResp.status === 'generating_audio') {
            setAudioStatus('generating');
            setViewState('celebration');
            startAudioPollingImpl(j.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
          } else {
            setAudioStatus('idle');
            setViewState('celebration');
          }
        } catch {
          setAudioStatus('idle');
          setViewState('celebration');
        }
      } else {
        // Default: start from snapshot
        setViewState('snapshot');
      }
    } catch (err: any) {
      setError(err.message);
      setViewState('entry');
    }
  };

  // ── Stage Transitions ───────────────────────────────────────────

  const handleSnapshotComplete = useCallback(async () => {
    if (!journey) return;
    try {
      // Advance to stage 2
      const result = await recapService.advanceStage(journey.journey_id);
      setJourney(prev => prev ? { ...prev, stage_progress: result.stage_progress, status: result.status } : null);

      // Load questions
      const qData = await recapService.getQuestions(journey.journey_id);
      setQuestions(qData.questions);
      setResponses(qData.responses || {});
      setViewState('questions');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load questions. Please try again.');
    }
  }, [journey]);

  const handleAnswerSubmit = useCallback(async (questionIndex: number, response: string) => {
    if (!journey) return;
    try {
      const result = await recapService.submitAnswer(journey.journey_id, questionIndex, response);
      setResponses(prev => ({ ...prev, [String(questionIndex)]: response }));
      return result.followup || { followup_text: '', referenced_articles: [] };
    } catch (err: any) {
      return { followup_text: '', referenced_articles: [] };
    }
  }, [journey]);

  const handleQuestionsComplete = useCallback(async () => {
    if (!journey) return;
    try {
      // Advance stage
      const result = await recapService.advanceStage(journey.journey_id);
      setJourney(prev => prev ? { ...prev, stage_progress: result.stage_progress, status: result.status } : null);
      setViewState('socratic');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to advance. Please try again.');
    }
  }, [journey]);

  const handleSocraticMessage = useCallback(async (message: string): Promise<SocraticResponse> => {
    if (!journey) throw new Error('No journey');
    const response = await recapService.socraticExchange(journey.journey_id, message);

    // Track exchanges locally
    setSocraticExchanges(prev => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: response.response },
    ]);

    // Track insights
    if (response.insight_extracted) {
      setInsights(prev => [...prev, response.insight_extracted!]);
    }

    return response;
  }, [journey]);

  const handleSocraticComplete = useCallback(async () => {
    if (!journey) return;
    try {
      // Advance to commitment
      const result = await recapService.advanceStage(journey.journey_id);
      setJourney(prev => prev ? { ...prev, stage_progress: result.stage_progress, status: result.status } : null);

      // Load insights
      try {
        const insightData = await recapService.getInsights(journey.journey_id);
        setInsights(insightData.insights);
      } catch { /* fine */ }

      setViewState('commitment');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to advance. Please try again.');
    }
  }, [journey]);

  const handleCommitmentSave = useCallback(async (text: string) => {
    if (!journey) return;
    try {
      await recapService.storeCommitment(journey.journey_id, text);
      setCommitmentText(text);

      // Advance stage: commitment → stage_4 (triggers audio generation on backend)
      const result = await recapService.advanceStage(journey.journey_id);
      setJourney(prev => prev ? { ...prev, stage_progress: result.stage_progress, status: result.status } : null);

      // Load final insights
      try {
        const insightData = await recapService.getInsights(journey.journey_id);
        setInsights(insightData.insights);
      } catch { /* fine */ }

      // Check audio status since backend auto-triggers generation on stage_4
      try {
        const audioStatusResp = await recapService.getAudioStatus(journey.journey_id);
        if (audioStatusResp.status === 'ready' && audioStatusResp.audio_url) {
          setAudioUrl(recapService.getAudioStreamUrl(journey.journey_id));
          setAudioDuration(audioStatusResp.audio_duration_seconds || 0);
          setAudioStatus('ready');
        } else if (audioStatusResp.status === 'text_only') {
          setAudioScript(audioStatusResp.script || []);
          setAudioStatus('text_only');
        } else if (audioStatusResp.status === 'generating_script' || audioStatusResp.status === 'generating_audio') {
          setAudioStatus('generating');
          startAudioPollingImpl(journey.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
        }
      } catch { /* audio not available — celebration will show generate button */ }

      setViewState('celebration');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save commitment. Please try again.');
    }
  }, [journey]);

  const handleRedoRecap = useCallback(async () => {
    setViewState('loading');
    setError(null);
    try {
      const journeyData = await recapService.startJourney({ forceNew: true });
      setJourney(journeyData);
      // Fresh journey — load snapshot and go to Stage 1
      const snapshotResp = await recapService.getSnapshot(journeyData.journey_id);
      setSnapshot(snapshotResp.snapshot);
      setViewState('snapshot');
    } catch (err: any) {
      setError(err.message || 'Failed to start new recap');
      setViewState('entry');
      Alert.alert('Error', err.message || 'Failed to start a new recap. Please try again.');
    }
  }, []);

  const handleCelebrationDismiss = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // Advance journey to completed if still at stage_4
    if (journey && journey.status !== 'completed') {
      try {
        await recapService.advanceStage(journey.journey_id);
      } catch { /* fine if already completed */ }
    }

    // Refresh metrics so tab bar rings update immediately
    fetchMetrics().catch(() => {});

    setViewState('entry');
    // Reset journey state
    setJourney(null);
    setSnapshot(null);
    setQuestions([]);
    setResponses({});
    setInsights([]);
    setSocraticExchanges([]);
    setCommitmentText('');
    setAudioStatus('idle');
    setAudioUrl(null);
    setAudioDuration(0);
    setAudioScript(undefined);
  }, [journey, fetchMetrics]);

  const handleViewConstellation = useCallback(() => {
    // Could show a full-screen constellation view
    // For now, just dismiss celebration
    handleCelebrationDismiss();
  }, [handleCelebrationDismiss]);

  // ── Audio Handlers (Phase 2) ──────────────────────────────────

  const handleGenerateAudio = useCallback(async () => {
    if (!journey) return;
    try {
      setAudioStatus('generating');
      const result = await recapService.generateAudio(journey.journey_id);

      if (result.status === 'already_ready' && result.audio_url) {
        setAudioUrl(recapService.getAudioStreamUrl(journey.journey_id));
        setAudioStatus('ready');
        setViewState('audio');
      } else if (result.status === 'started' || result.status === 'already_generating') {
        startAudioPollingImpl(journey.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
      }
    } catch (err: any) {
      setAudioStatus('failed');
      Alert.alert('Error', err.message || 'Failed to generate audio recap.');
    }
  }, [journey]);

  const handleListenAudio = useCallback(() => {
    if (audioUrl) {
      setViewState('audio');
    }
  }, [audioUrl]);

  const handleAudioDismiss = useCallback(async () => {
    if (!journey) return;
    try {
      // Advance from stage_4 to completed
      const result = await recapService.advanceStage(journey.journey_id);
      setJourney(prev => prev ? { ...prev, stage_progress: result.stage_progress, status: result.status } : null);
    } catch { /* fine if already completed */ }

    // Refresh metrics so tab bar rings update immediately
    fetchMetrics().catch(() => {});

    // Reset all state
    setViewState('entry');
    setJourney(null);
    setSnapshot(null);
    setQuestions([]);
    setResponses({});
    setInsights([]);
    setSocraticExchanges([]);
    setCommitmentText('');
    setAudioStatus('idle');
    setAudioUrl(null);
    setAudioDuration(0);
    setAudioScript(undefined);
  }, [journey, fetchMetrics]);

  // ── Render Journey Stages ───────────────────────────────────────

  // Loading state
  if (viewState === 'loading') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="recap" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={RingColors.recap.primary} />
          <Text style={styles.loadingText}>Preparing your weekly recap...</Text>
          <Text style={styles.loadingSubtext}>Gathering your articles and insights</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Archive view
  if (viewState === 'archive') {
    return (
      <RecapArchive
        onClose={() => setViewState('entry')}
        onSelectJourney={(id) => {
          setSelectedJourneyId(id);
          setViewState('detail');
        }}
      />
    );
  }

  if (viewState === 'detail' && selectedJourneyId) {
    return (
      <RecapDetail
        journeyId={selectedJourneyId}
        onClose={() => {
          setSelectedJourneyId(null);
          setViewState('archive');
        }}
      />
    );
  }

  // Stage 1: Snapshot / Glass Memory Wall
  if (viewState === 'snapshot' && snapshot) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="recap" />
        {/* Floating ring progress */}
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        <SnapshotStage snapshot={snapshot} onContinue={handleSnapshotComplete} />
      </SafeAreaView>
    );
  }

  // Stage 2: Guided Questions
  if (viewState === 'questions' && questions.length > 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="recap" />
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        <QuestionsStage
          questions={questions}
          responses={responses}
          onAnswer={handleAnswerSubmit}
          onComplete={handleQuestionsComplete}
          onSkipToSocratic={handleQuestionsComplete}
        />
      </SafeAreaView>
    );
  }

  // Stage 3: Socratic Dialogue
  if (viewState === 'socratic') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="recap" />
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        <SocraticStage
          onSendMessage={handleSocraticMessage}
          onComplete={handleSocraticComplete}
          initialExchanges={socraticExchanges}
        />
      </SafeAreaView>
    );
  }

  // Commitment Screen
  if (viewState === 'commitment') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="recap" />
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        <CommitmentScreen
          onSave={handleCommitmentSave}
          tier={journey?.tier || 'standard'}
        />
      </SafeAreaView>
    );
  }

  // Celebration Overlay
  if (viewState === 'celebration') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="recap" />
        <CelebrationOverlay
          insightCount={insights.length}
          questionCount={questions.length}
          commitment={commitmentText}
          streak={1}
          isFullTier={true}
          audioStatus={audioStatus}
          onGenerateAudio={handleGenerateAudio}
          onListenAudio={handleListenAudio}
          onReadRecap={audioStatus === 'text_only' ? () => setViewState('audio') : undefined}
          onViewConstellation={insights.length > 0 ? handleViewConstellation : undefined}
          onBackToHome={handleCelebrationDismiss}
        />
      </SafeAreaView>
    );
  }

  // Stage 4: Audio Player / Text Recap (Full tier)
  if (viewState === 'audio' && journey && (audioUrl || audioStatus === 'text_only')) {
    return (
      <AudioPlayerStage
        journeyId={journey.journey_id}
        audioUrl={audioUrl || ''}
        audioDuration={audioDuration}
        script={audioScript}
        textOnly={audioStatus === 'text_only'}
        onDismiss={handleAudioDismiss}
      />
    );
  }

  // ── Default: Entry Screen ───────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <OrganicBackground variant="recap" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, {
          backgroundColor: isDark ? 'rgba(15, 20, 35, 0.75)' : 'rgba(255, 255, 255, 0.65)',
          borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.7)',
        }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.recap }]}>Recap</Text>
            <TouchableOpacity style={styles.archiveButton} onPress={() => setViewState('archive')}>
              <Text style={styles.archiveButtonText}>Journal</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Your weekly learning studio</Text>
        </View>

        {/* Ghost Ring Entry Area */}
        <View style={styles.entrySection}>
          <Text style={styles.weekLabel}>{weekLabel}</Text>

          <GuruRings size="ghost" metrics={displayMetrics} dimensions={220} />
          {/* Tier badge removed — no tiers in the app */}

          {/* Activity summary pills */}
          <View style={styles.activityPills}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{weeklyReadMinutes}m reading</Text>
            </View>
            <View style={styles.pillDot} />
            <View style={styles.pill}>
              <Text style={styles.pillText}>{filtersExplored} filters</Text>
            </View>
            <View style={styles.pillDot} />
            <View style={styles.pill}>
              <Text style={styles.pillText}>{displayMetrics.divein?.weeklyProgress || 0}m deep dives</Text>
            </View>
          </View>

          {/* CTA */}
          {hasCompletedRecap ? (
            <View style={styles.completedCard}>
              <Icon name="star-four-points" size={32} color={RingColors.recap.primary} style={{ marginBottom: Spacing.sm }} />
              <Text style={styles.completedTitle}>Recap Complete</Text>
              <Text style={styles.completedSubtitle}>
                You've completed your weekly learning recap.
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs }}>
                <TouchableOpacity style={styles.viewRecapButton} onPress={() => setViewState('archive')}>
                  <Text style={styles.viewRecapText}>View Recap</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.redoButton} onPress={handleRedoRecap}>
                  <Text style={styles.redoButtonText}>Start New Recap</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : !hasMinimumActivity && !isInProgress ? (
            <View style={styles.ctaSection}>
              <Text style={styles.ctaText}>
                Read some articles in Catch-up or Dive-in first to unlock your weekly recap.
              </Text>
              <View style={[styles.beginButton, { opacity: 0.4 }]}>
                <Text style={styles.beginButtonText}>Begin Journey</Text>
              </View>
            </View>
          ) : (
            <View style={styles.ctaSection}>
              <Text style={styles.ctaText}>
                {isInProgress
                  ? 'Continue where you left off'
                  : 'Fill your last ring \u2014 consolidate what you learned this week'
                }
              </Text>
              <TouchableOpacity style={styles.beginButton} onPress={handleBeginJourney}>
                <Text style={styles.beginButtonText}>
                  {isInProgress ? 'Continue Journey' : 'Begin Journey'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Journey Stages — interactive */}
        <View style={styles.stagesPreview}>
          <Text style={styles.stagesTitle}>Journey Stages</Text>

          {[
            { num: 1, name: 'Your Week', desc: 'Review the articles and insights you explored', lockHint: '' },
            { num: 2, name: 'Reflect', desc: 'Answer guided questions to strengthen recall', lockHint: '' },
            { num: 3, name: 'Explore', desc: 'Deep Socratic dialogue to find connections', lockHint: '' },
            { num: 4, name: 'Listen', desc: 'NotebookLM-style audio recap of your week', lockHint: '' },
          ].map(stage => {
            const isCompleted = stage.num <= completedStages;
            const isCurrent = isInProgress && stage.num === completedStages + 1;
            const isLocked = !isCompleted && !isCurrent;
            const tierLocked = false; // No tier gating

            return (
              <TouchableOpacity
                key={stage.num}
                style={[
                  styles.stageItem,
                  isCurrent && styles.stageItemCurrent,
                  isLocked && { opacity: 0.4 },
                ]}
                disabled={isLocked && !hasCompletedRecap}
                onPress={() => {
                  if (isCompleted || isCurrent) {
                    handleBeginJourney();
                  }
                }}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.stageNumber,
                  { backgroundColor: isCompleted
                    ? 'rgba(251, 146, 60, 0.5)'
                    : isCurrent
                      ? 'rgba(251, 146, 60, 0.25)'
                      : 'rgba(251, 146, 60, 0.10)' },
                  isCurrent && {
                    borderWidth: 2,
                    borderColor: '#FB923C',
                  },
                ]}>
                  {isCompleted ? (
                    <Icon name="check" size={18} color="#FB923C" />
                  ) : tierLocked ? (
                    <Icon name="lock" size={16} color="#64748B" />
                  ) : (
                    <Text style={styles.stageNumberText}>{stage.num}</Text>
                  )}
                </View>
                <View style={styles.stageContent}>
                  <Text style={styles.stageName}>{stage.name}</Text>
                  <Text style={styles.stageDescription}>
                    {tierLocked && stage.lockHint ? stage.lockHint : stage.desc}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Error display */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Past recaps link */}
        <TouchableOpacity style={styles.archiveLink} onPress={() => setViewState('archive')}>
          <Text style={styles.archiveLinkText}>View past recaps & learning journal</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Floating ring progress indicator (top-right during journey)
  floatingRing: {
    position: 'absolute',
    top: 56,
    right: Spacing.lg,
    zIndex: 100,
  },
  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.headlineSmall,
    color: RingColors.recap.primary,
  },
  loadingSubtext: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
  },
  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  // Header
  header: {
    padding: Spacing.lg,
    paddingTop: 60,
    backgroundColor: 'rgba(15, 20, 35, 0.75)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    ...getBackdropBlur(24),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    ...Typography.displaySmall,
    color: RingColors.recap.primary,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
  },
  archiveButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
  },
  archiveButtonText: {
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  // Entry section
  entrySection: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  weekLabel: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textSecondary,
    marginBottom: Spacing.lg,
  },
  // Activity pills
  activityPills: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  pill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  pillText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: DarkThemeColors.textTertiary,
    marginHorizontal: Spacing.sm,
  },
  // CTA
  ctaSection: {
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  ctaText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    maxWidth: 280,
  },
  beginButton: {
    backgroundColor: 'rgba(251, 146, 60, 0.30)',
    borderWidth: 1.5,
    borderColor: 'rgba(253, 186, 116, 0.40)',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 999,
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20,
    shadowRadius: 12,
    elevation: 4,
  },
  beginButtonText: {
    ...Typography.labelLarge,
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Completed
  completedCard: {
    backgroundColor: 'rgba(15, 20, 35, 0.55)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
    marginTop: Spacing.md,
    width: '100%',
    ...getBackdropBlur(16),
  },
  completedSparkle: {
    marginBottom: Spacing.sm,
  },
  completedTitle: {
    ...Typography.headlineSmall,
    color: RingColors.recap.primary,
    marginBottom: Spacing.xs,
  },
  completedSubtitle: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  viewRecapButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: RingColors.recap.primary,
  },
  viewRecapText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  redoButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.3)',
  },
  redoButtonText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  tierBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  tierBadgeText: {
    ...Typography.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Stages preview
  stagesPreview: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: 'rgba(15, 20, 35, 0.55)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    ...getBackdropBlur(16),
  },
  stagesTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.lg,
  },
  stageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  stageItemCurrent: {
    backgroundColor: 'rgba(251, 146, 60, 0.06)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginHorizontal: -8,
  },
  stageNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  stageNumberText: {
    ...Typography.labelLarge,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  stageContent: {
    flex: 1,
  },
  stageName: {
    ...Typography.labelLarge,
    color: DarkThemeColors.textPrimary,
    marginBottom: 2,
  },
  stageDescription: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
  },
  // Error
  errorCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    ...Typography.bodySmall,
    color: DarkThemeColors.error,
    textAlign: 'center',
  },
  // Archive link
  archiveLink: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    marginTop: Spacing.md,
  },
  archiveLinkText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    textDecorationLine: 'underline',
  },
});
