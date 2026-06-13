import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { setTabBarHidden } from './_layout';
import { OrganicBackground } from '../../components/ui';
import Icon from '../../components/ui/Icon';
import GlassButton from '../../components/ui/GlassButton';
import GuruBlob from '../../components/ui/GuruBlob';
import { cleanGuruResponse } from '../../components/ui/GuruFormattedText';
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
  AudioPlayerStage,
  TextPodcastStage,
  RecapArchive,
  RecapDetail,
  RecapHero,
} from '../../components/Recap';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  DarkGlassMaterials,
  getBackdropBlur,
} from '../../constants/liquidGlass';
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
  | 'audio'         // Stage 4: Audio player
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
  // GUR-232: Recap is decoupled from the calendar week \u2014 it reflects reading
  // "since your last recap". Prefer the backend journey's week_start (date of
  // the last recap, or ~7 days ago for the first); render as "Since <Mon D>".
  const periodStart = journey?.week_start ? new Date(journey.week_start) : weekStart;
  const sinceLabel = `Since ${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  // ── GUR-211: Immersive full-screen stages hide the floating tab bar ──
  // The Recap journey stages must be full-screen per BRD F.2. The floating
  // glass tab bar (position:absolute, bottom:12 in _layout) otherwise overlaps
  // the stage CTAs (e.g. "Continue to Questions →") and intercepts taps,
  // navigating to another tab instead of advancing the journey.
  //
  // Immersive = any active stage view. NOT the entry/landing screen, NOT the
  // archive/journal, NOT the transient loading spinner.
  const isImmersiveStage =
    viewState === 'snapshot' ||
    viewState === 'questions' ||
    viewState === 'socratic' ||
    viewState === 'commitment' ||
    viewState === 'celebration' ||
    viewState === 'audio';

  useEffect(() => {
    // Flip the shared signal owned by _layout. _layout keeps the full themed
    // glass-island tabBarStyle and only toggles `display`, so restoring the bar
    // returns it IDENTICAL to before.
    setTabBarHidden(isImmersiveStage);
    // Always restore on unmount (e.g. leaving the Recap tab mid-journey).
    return () => setTabBarHidden(false);
  }, [isImmersiveStage]);

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
  // NOTE: resumeJourney is declared BEFORE handleBeginJourney (which references
  // it) to avoid React Compiler TDZ — same pattern that required
  // startAudioPollingImpl to move to module level.

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
        // GUR-192: Stage 4 is the text podcast screen. Always route to the
        // 'audio' view; TextPodcastStage renders loading/error/ready states.
        setViewState('audio');
        try {
          const audioStatusResp = await recapService.getAudioStatus(j.journey_id);
          if (audioStatusResp.status === 'ready' && audioStatusResp.audio_url) {
            setAudioUrl(recapService.getAudioStreamUrl(j.journey_id));
            setAudioDuration(audioStatusResp.audio_duration_seconds || 0);
            setAudioStatus('ready');
          } else if (audioStatusResp.status === 'text_only') {
            setAudioScript(audioStatusResp.script || []);
            setAudioStatus('text_only');
          } else if (audioStatusResp.status === 'generating_script' || audioStatusResp.status === 'generating_audio') {
            setAudioStatus('generating');
            startAudioPollingImpl(j.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
          } else {
            // No status yet — kick off generation and poll for the script.
            setAudioStatus('generating');
            try { await recapService.generateAudio(j.journey_id); } catch { /* already queued */ }
            startAudioPollingImpl(j.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
          }
        } catch {
          setAudioStatus('generating');
          try { await recapService.generateAudio(j.journey_id); } catch { /* fine */ }
          startAudioPollingImpl(j.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
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
      { role: 'assistant', content: cleanGuruResponse(response.response) },
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

      // GUR-192: After commitment, transition to Stage 4 (text podcast).
      // TextPodcastStage renders loading/error/ready states itself, so we
      // can switch views immediately and poll in the background.
      setViewState('audio');
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
        } else {
          // No status yet — explicitly request generation before polling.
          setAudioStatus('generating');
          try { await recapService.generateAudio(journey.journey_id); } catch { /* already queued */ }
          startAudioPollingImpl(journey.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
        }
      } catch {
        setAudioStatus('generating');
        try { await recapService.generateAudio(journey.journey_id); } catch { /* fine */ }
        startAudioPollingImpl(journey.journey_id, pollingRef, setAudioUrl, setAudioDuration, setAudioStatus, setAudioScript, setViewState);
      }
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

  // GUR-192: Finishing Stage 4 transitions to the Celebration overlay.
  // Keeps audio/script state around so the overlay can still reference it
  // (e.g., insights, commitment). `handleCelebrationDismiss` clears state
  // when the user exits celebration.
  const handleTextRecapFinish = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setViewState('celebration');
  }, []);

  // ── Render Journey Stages ───────────────────────────────────────

  // In light mode, let AppBackground show through instead of a solid fill
  const containerBg = isDark ? colors.background : 'transparent';

  // Theme-aware glass card style for light/dark surfaces
  const glassCard = isDark
    ? { backgroundColor: 'rgba(15,20,35,0.42)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 32, shadowOffset: { width: 0, height: 8 }, elevation: 8 }
    : { backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 };

  const glassPill = isDark
    ? { backgroundColor: 'rgba(15,20,35,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }
    : { backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.07)', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 };

  // Loading state
  if (viewState === 'loading') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        {OrganicBackground ? <OrganicBackground variant="recap" /> : null}
        <View style={styles.loadingContainer}>
          <GuruBlob size={40} state="thinking" />
          <Text style={styles.loadingText}>Preparing your recap...</Text>
          <Text style={[styles.loadingSubtext, { color: colors.textSecondary }]}>Gathering your articles and insights</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Archive view
  if (viewState === 'archive') {
    if (!RecapArchive) return null;
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
    if (!RecapDetail) return null;
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

  // GUR-237: a Pause control on every immersive stage. It exits to the Recap
  // entry; the journey stays in-progress server-side, so reopening Recap resumes
  // exactly where you left off.
  const renderPauseControl = () => (
    <TouchableOpacity
      style={styles.pauseButton}
      onPress={() => setViewState('entry')}
      accessibilityRole="button"
      accessibilityLabel="Pause recap and continue later"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon name="pause" size={13} color="#E2E8F0" />
      <Text style={styles.pauseText}>Pause</Text>
    </TouchableOpacity>
  );

  // Stage 1: Snapshot / Glass Memory Wall
  if (viewState === 'snapshot' && snapshot) {
    if (!RecapRingProgress || !SnapshotStage) return null;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        {OrganicBackground ? <OrganicBackground variant="recap" /> : null}
        {/* Floating ring progress */}
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        {renderPauseControl()}
        <SnapshotStage snapshot={snapshot} onContinue={handleSnapshotComplete} />
      </SafeAreaView>
    );
  }

  // Stage 2: Guided Questions
  if (viewState === 'questions' && questions.length > 0) {
    if (!RecapRingProgress || !QuestionsStage) return null;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        {OrganicBackground ? <OrganicBackground variant="recap" /> : null}
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        {renderPauseControl()}
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
    if (!RecapRingProgress || !SocraticStage) return null;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        {OrganicBackground ? <OrganicBackground variant="recap" /> : null}
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        {renderPauseControl()}
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
    if (!RecapRingProgress || !CommitmentScreen) return null;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        {OrganicBackground ? <OrganicBackground variant="recap" /> : null}
        <View style={styles.floatingRing}>
          <RecapRingProgress
            progress={ringProgress}
            insightCount={insights.length}
          />
        </View>
        {renderPauseControl()}
        <CommitmentScreen
          onSave={handleCommitmentSave}
        />
      </SafeAreaView>
    );
  }

  // Celebration Overlay
  if (viewState === 'celebration') {
    if (!CelebrationOverlay) return null;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
        {OrganicBackground ? <OrganicBackground variant="recap" /> : null}
        <CelebrationOverlay
          insightCount={insights.length}
          questionCount={questions.length}
          commitment={commitmentText}
          streak={1}
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

  // Stage 4: Text Podcast (GUR-192). For text-only, loading, and error states
  // we render the new TextPodcastStage. If real audio ever lands we fall
  // through to AudioPlayerStage. "Finish Recap" dismisses to the Celebration
  // overlay rather than returning straight to the entry screen.
  if (viewState === 'audio' && journey) {
    const showTextPodcast =
      audioStatus === 'text_only' ||
      audioStatus === 'generating' ||
      audioStatus === 'failed' ||
      (audioStatus === 'idle' && !audioUrl);

    if (showTextPodcast) {
      if (!TextPodcastStage) return null;
      const hasScript = !!audioScript && audioScript.length > 0;
      return (
        <TextPodcastStage
          script={audioScript || []}
          isLoading={!hasScript && audioStatus !== 'failed'}
          error={audioStatus === 'failed' ? "We couldn't generate your conversation right now." : null}
          onFinish={handleTextRecapFinish}
          onDismiss={handleTextRecapFinish}
        />
      );
    }

    if (audioUrl) {
      if (!AudioPlayerStage) return null;
      return (
        <AudioPlayerStage
          journeyId={journey.journey_id}
          audioUrl={audioUrl}
          audioDuration={audioDuration}
          script={audioScript}
          textOnly={false}
          onDismiss={handleTextRecapFinish}
        />
      );
    }
  }

  // ── Default: Entry Screen ───────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: containerBg }]}>
      <OrganicBackground variant="recap" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, {
          backgroundColor: isDark ? 'rgba(15, 20, 35, 0.75)' : 'rgba(255, 255, 255, 0.85)',
          borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
        }]}>
          <View style={styles.headerRow}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.recap }]}>Recap</Text>
            <TouchableOpacity
              style={styles.archiveButton}
              onPress={() => setViewState('archive')}
              accessibilityRole="button"
              accessibilityLabel="Open learning journal"
            >
              <Text style={styles.archiveButtonText}>Journal</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Reflect on your reading since your last recap</Text>
        </View>

        {/* Ghost Ring Entry Area */}
        <View style={styles.entrySection}>
          <Text style={[styles.weekLabel, { color: colors.textSecondary }]}>{sinceLabel}</Text>

          {/* Recap hero — living organism in a gold progress arc (GUR-228
              identity language; replaces the legacy PlasmaBlobRing) */}
          <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <RecapHero
              progress={ringProgress}
              size={240}
              state={hasCompletedRecap ? 'completed' : isInProgress ? 'in_progress' : 'not_started'}
            />
          </View>
          {/* Tier badge removed — no tiers in the app */}

          {/* Activity summary pills */}
          <View style={styles.activityPills}>
            <View style={[styles.pill, glassPill]}>
              <Text style={[styles.pillText, { color: colors.textSecondary }]}>{weeklyReadMinutes}m reading</Text>
            </View>
            <View style={[styles.pillDot, { backgroundColor: colors.textTertiary }]} />
            <View style={[styles.pill, glassPill]}>
              <Text style={[styles.pillText, { color: colors.textSecondary }]}>{filtersExplored} topics</Text>
            </View>
            <View style={[styles.pillDot, { backgroundColor: colors.textTertiary }]} />
            <View style={[styles.pill, glassPill]}>
              <Text style={[styles.pillText, { color: colors.textSecondary }]}>{displayMetrics.divein?.weeklyProgress || 0}m deep dives</Text>
            </View>
          </View>

          {/* CTA */}
          {hasCompletedRecap ? (
            <View style={[styles.completedCard, glassCard, {
              borderColor: isDark ? 'rgba(251,146,60,0.2)' : 'rgba(251,146,60,0.3)',
            }]}>
              <Icon name="star-four-points" size={32} color={RingColors.recap.primary} style={{ marginBottom: Spacing.sm }} />
              <Text style={styles.completedTitle}>Recap Complete</Text>
              <Text style={[styles.completedSubtitle, { color: colors.textSecondary }]}>
                You've completed your learning recap.
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs }}>
                <TouchableOpacity
                  style={styles.viewRecapButton}
                  onPress={() => setViewState('archive')}
                  accessibilityRole="button"
                  accessibilityLabel="View completed recap"
                >
                  <Text style={styles.viewRecapText}>View Recap</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.redoButton}
                  onPress={handleRedoRecap}
                  accessibilityRole="button"
                  accessibilityLabel="Start a new recap journey"
                >
                  <Text style={styles.redoButtonText}>Start New Recap</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : !hasMinimumActivity && !isInProgress ? (
            // Low-activity / first-week empty state (GUR-197 + GUR-191): instead
            // of a silent disabled "Begin Journey", explain what a Recap is, show
            // progress toward the unlock threshold, and link straight to reading.
            <View style={styles.ctaSection}>
              <View style={[styles.unlockCard, glassCard, { borderColor: isDark ? 'rgba(251,146,60,0.25)' : 'rgba(251,146,60,0.18)' }]}>
                <View style={styles.unlockHeader}>
                  <Icon name="sparkle" size={18} color="#FB923C" />
                  <Text style={[styles.unlockTitle, { color: colors.textPrimary }]}>Unlock your first Recap</Text>
                </View>
                <Text style={[styles.unlockBody, { color: colors.textSecondary }]}>
                  Your Recap turns this week's reading into a personalized reflection — key insights, guided Socratic questions, and a commitment for next week. The more you read, highlight, and ask, the richer it gets.
                </Text>

                {/* Progress toward the 5-min unlock threshold */}
                <View style={styles.unlockProgressRow}>
                  <View style={[styles.unlockTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)' }]}>
                    <View style={[styles.unlockFill, { width: `${Math.min(100, Math.max(4, (weeklyReadMinutes / 5) * 100))}%` }]} />
                  </View>
                  <Text style={[styles.unlockProgressLabel, { color: colors.textSecondary }]}>
                    {Math.round(weeklyReadMinutes)} / 5 min
                  </Text>
                </View>
                <Text style={[styles.unlockHint, { color: colors.textTertiary }]}>
                  {weeklyReadMinutes <= 0
                    ? 'Read about 5 minutes this week to unlock your Recap.'
                    : `About ${Math.max(1, Math.ceil(5 - weeklyReadMinutes))} more min of reading to unlock.`}
                </Text>

                <View style={styles.unlockCtaRow}>
                  <TouchableOpacity
                    style={[styles.unlockCta, { borderColor: 'rgba(56,189,248,0.4)' }]}
                    onPress={() => router.push('/catchup')}
                    accessibilityRole="button"
                    accessibilityLabel="Go to Catch-up to read articles"
                  >
                    <Icon name="lightning-bolt" size={14} color="#38BDF8" />
                    <Text style={[styles.unlockCtaText, { color: '#38BDF8' }]}>Catch-up</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.unlockCta, { borderColor: 'rgba(236,72,153,0.4)' }]}
                    onPress={() => router.push('/divein')}
                    accessibilityRole="button"
                    accessibilityLabel="Go to Dive-in to read articles"
                  >
                    <Icon name="book-open-variant" size={14} color="#EC4899" />
                    <Text style={[styles.unlockCtaText, { color: '#EC4899' }]}>Dive-in</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.ctaSection}>
              <Text style={[styles.ctaText, { color: colors.textSecondary }]}>
                {isInProgress
                  ? 'Continue where you left off'
                  : 'Fill your last ring \u2014 consolidate what you learned since your last recap'
                }
              </Text>
              <GlassButton
                title={isInProgress ? 'Continue Journey' : 'Begin Journey'}
                onPress={handleBeginJourney}
                accentColor="#FB923C"
                icon="play-circle"
                fullWidth={false}
                size="lg"
                style={{ paddingHorizontal: 32 }}
              />
            </View>
          )}
        </View>

        {/* Journey Stages — interactive */}
        <View style={[styles.stagesPreview, glassCard, { borderColor: isDark ? 'rgba(251,146,60,0.2)' : 'rgba(251,146,60,0.15)' }]}>
          <Text style={[styles.stagesTitle, { color: colors.textPrimary }]}>Journey Stages</Text>

          {[
            { num: 1, name: 'Your Reading', desc: 'Review the articles and insights you explored' },
            { num: 2, name: 'Reflect', desc: 'Answer guided questions to strengthen recall' },
            { num: 3, name: 'Explore', desc: 'Deep Socratic dialogue to find connections' },
            { num: 4, name: 'Listen', desc: 'NotebookLM-style audio recap of your reading' },
          ].map((stage, index, arr) => {
            const isCompleted = stage.num <= completedStages;
            const isCurrent = isInProgress && stage.num === completedStages + 1;
            const isLocked = !isCompleted && !isCurrent;

            return (
              <React.Fragment key={stage.num}>
                <TouchableOpacity
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
                  accessibilityRole="button"
                  accessibilityLabel={`Stage ${stage.num}: ${stage.name}`}
                  accessibilityHint={stage.desc}
                  accessibilityState={{ disabled: isLocked && !hasCompletedRecap, selected: isCurrent }}
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
                    ) : (
                      <Text style={styles.stageNumberText}>{stage.num}</Text>
                    )}
                  </View>
                  <View style={styles.stageContent}>
                    {/* Theme-aware stage title: the static stageName style
                        used a faint peach (`RingColors.recap.light`) which
                        rendered almost invisible on a white card in light
                        mode. Override to the theme's primary text token. */}
                    <Text style={[styles.stageName, { color: colors.textPrimary }]}>{stage.name}</Text>
                    <Text style={[styles.stageDescription, { color: colors.textSecondary }]}>
                      {stage.desc}
                    </Text>
                  </View>
                </TouchableOpacity>
                {index < arr.length - 1 && (
                  <View style={styles.stageConnector} />
                )}
              </React.Fragment>
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
        <TouchableOpacity
          style={styles.archiveLink}
          onPress={() => setViewState('archive')}
          accessibilityRole="link"
          accessibilityLabel="View past recaps and learning journal"
        >
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
  pauseButton: {
    position: 'absolute',
    top: 56,
    left: Spacing.lg,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pauseText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
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
  },
  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
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
    ...DarkGlassMaterials.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  pillText: {
    ...Typography.labelSmall,
  },
  pillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginHorizontal: Spacing.sm,
  },
  // CTA
  ctaSection: {
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  ctaText: {
    ...Typography.bodyMedium,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    maxWidth: 280,
  },
  unlockCard: {
    width: '100%',
    maxWidth: 360,
    padding: Spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
  },
  unlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  unlockTitle: {
    ...Typography.headlineSmall,
    fontSize: 16,
    fontWeight: '700',
  },
  unlockBody: {
    ...Typography.bodySmall,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  unlockProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginBottom: 6,
  },
  unlockTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  unlockFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#FB923C',
  },
  unlockProgressLabel: {
    ...Typography.labelSmall,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  unlockHint: {
    ...Typography.labelSmall,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  unlockCtaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  unlockCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  unlockCtaText: {
    ...Typography.labelMedium,
    fontSize: 13,
    fontWeight: '700',
  },
  beginButton: {
    // Opaque recap-orange for AA white-text contrast in both themes
    // (GUR-100 systemic-contrast-sweep follow-up). Previously 30%-alpha
    // on white card yielded ~1.9:1.
    backgroundColor: '#FB923C',
    borderWidth: 1.5,
    borderColor: '#EA580C',
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
    ...DarkGlassMaterials.card,
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
  // Stages preview
  stagesPreview: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    ...DarkGlassMaterials.card,
    padding: Spacing.lg,
    ...getBackdropBlur(16),
  },
  stagesTitle: {
    ...Typography.headlineSmall,
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
  stageConnector: {
    width: 2,
    height: 20,
    backgroundColor: 'rgba(251,146,60,0.2)',
    marginLeft: 23, // centered under the 36px numbered circle (36/2 - 2/2 = 17, but visually 23 aligns with center considering marginRight on stageNumber)
  },
  stageContent: {
    flex: 1,
  },
  stageName: {
    ...Typography.labelLarge,
    marginBottom: 2,
  },
  stageDescription: {
    ...Typography.bodySmall,
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
    color: '#DC2626',
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
