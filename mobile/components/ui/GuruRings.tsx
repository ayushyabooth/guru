/**
 * GuruRings — Unified ring brand component
 *
 * Three Borromean-style interlocking rings (Catch-up=sky blue, Dive-in=magenta, Recap=coral).
 * One component, 5 size presets, same SVG engine.
 *
 * Size presets:
 *   "hero"      ~200px  Home center, Recap celebration  Full: liquid fill, glow, labels, tap
 *   "logo"      ~40-88px Header brand mark              Static: rings at full fill, no labels
 *   "tab"       ~24px   Tab bar icon (one ring)         Single ring arc with progress fill
 *   "indicator" ~40px   Recap floating progress          Recap ring only, liquid fill
 *   "ghost"     ~200px  Recap entry (E.0)                Two rings filled, recap ghosted
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Stop,
  G,
  Path,
  RadialGradient,
  ClipPath,
  Ellipse,
} from 'react-native-svg';

// ─── Sunset Glass Palette ────────────────────────────────────────

const COLORS = {
  catchup: {
    primary: '#38BDF8', light: '#7DD3FC', mid: '#0EA5E9',
    dark: '#0C4A6E', highlight: '#BAE6FD', glow: '#7DD3FC',
  },
  divein: {
    primary: '#EC4899', light: '#F472B6', mid: '#DB2777',
    dark: '#831843', highlight: '#FBCFE8', glow: '#F472B6',
  },
  recap: {
    primary: '#FB923C', light: '#FDBA74', mid: '#F97316',
    dark: '#9A3412', highlight: '#FED7AA', glow: '#FDBA74',
  },
  blends: {
    catchupDivein: '#A855F7',
    diveinRecap: '#F472B6',
    catchupRecap: '#F59E0B',
  },
  glass: {
    labelBg: 'rgba(15, 20, 35, 0.75)',
    labelBorder: 'rgba(255, 255, 255, 0.08)',
  },
};

const RING_RGB = {
  catchup: [56, 189, 248] as const,
  divein: [236, 72, 153] as const,
  recap: [251, 146, 60] as const,
};

// Tab icon names for distinguishability (MaterialIcons)
const TAB_INNER_ICON: Record<string, React.ComponentProps<typeof MaterialIcons>['name']> = {
  catchup: 'auto-stories',   // book/newspaper feel
  divein: 'explore',          // compass/explore feel
  recap: 'event-note',        // journal/recap feel
};

// ─── Types ───────────────────────────────────────────────────────

export interface RingMetrics {
  catchup: { dailyProgress: number; dailyGoal: number; weeklyTotal: number };
  divein: { dailyProgress?: number; dailyGoal?: number; weeklyProgress: number; weeklyGoal: number };
  recap: { status: 'not_started' | 'in_progress' | 'completed'; weeklyProgress: number; weeklyGoal: number };
}

type RingName = 'catchup' | 'divein' | 'recap';
type SizePreset = 'hero' | 'logo' | 'tab' | 'indicator' | 'ghost';

interface GuruRingsProps {
  size: SizePreset;
  /** Required for hero, ghost, indicator. Drives fill levels. */
  metrics?: RingMetrics;
  /** For tab preset: which single ring to show */
  ring?: RingName;
  /** For tab: 0-1 progress */
  progress?: number;
  /** For tab: whether this tab is active */
  focused?: boolean;
  /** For tab: base color from tab bar */
  color?: string;
  /** Custom pixel dimensions (overrides preset default) */
  dimensions?: number;
  /** Press handler for hero rings */
  onRingPress?: (section: RingName) => void;
  /** Show "Adjust goals" link (hero only) */
  showChangeGoals?: boolean;
  onChangeGoals?: () => void;
}

// ─── Liquid Animation Hook ──────────────────────────────────────

interface AnimValues {
  wobbleA: number; wobbleB: number; wobbleC: number;
  pulseOpacity: number; shimmer: number[];
}

const STATIC_ANIM: AnimValues = {
  wobbleA: 0.30, wobbleB: 0.22, wobbleC: 0.12,
  pulseOpacity: 0.45, shimmer: [0.04, 0.04, 0.04, 0.04],
};

function useLiquidAnimation(enabled: boolean): AnimValues {
  const [values, setValues] = useState<AnimValues>(STATIC_ANIM);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled) { setValues(STATIC_ANIM); return; }
    const tick = () => {
      const t = (Date.now() - startRef.current) / 1000;
      const wA = 0.15 + 0.175 * (1 + Math.sin(t * 2 * Math.PI / 3.5));
      const wB = 0.10 + 0.15 * (1 + Math.sin(t * 2 * Math.PI / 4.0 + 2.094));
      const wC = 0.05 + 0.125 * (1 + Math.sin(t * 2 * Math.PI / 4.5 + 4.189));
      const pulse = 0.30 + 0.175 * (1 + Math.sin(t * 2 * Math.PI / 4.0));
      const shimmerPhase = (t % 5.0) / 5.0;
      const shimmers = [0, 1, 2, 3].map(i => {
        const center = (i + 0.5) / 4;
        const dist = Math.abs(shimmerPhase - center);
        const wrapped = Math.min(dist, 1 - dist);
        return 0.02 + 0.10 * Math.max(0, 1 - wrapped * 8);
      });
      setValues({ wobbleA: wA, wobbleB: wB, wobbleC: wC, pulseOpacity: pulse, shimmer: shimmers });
    };
    tick();
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [enabled]);

  return values;
}

// ─── Organic Ring Generator ─────────────────────────────────────
// Creates a smooth closed path with controlled irregularity using cubic beziers.
// Each ring has a deterministic seed so it looks the same every render.

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateOrganicRingPath(
  cx: number, cy: number, baseRadius: number,
  seed: number, points: number = 12, irregularity: number = 0.12,
): string {
  const rng = seededRandom(seed);
  const angleStep = (Math.PI * 2) / points;

  // Generate control points with radius variation
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < points; i++) {
    const angle = i * angleStep;
    const r = baseRadius + (rng() - 0.5) * baseRadius * irregularity * 2;
    pts.push({
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  }

  // Build smooth closed cubic bezier path
  const path: string[] = [`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`];
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const p3 = pts[(i + 2) % points];

    // Catmull-Rom to cubic bezier control points (tension 0.35)
    const tension = 0.35;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    path.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`);
  }
  path.push('Z');
  return path.join(' ');
}

// Deterministic seeds for each ring (never changes)
const RING_SEEDS = { catchup: 42, divein: 137, recap: 293 };

// ─── SVG Path Helpers ────────────────────────────────────────────

function annulusPath(cx: number, cy: number, outerR: number, innerR: number): string {
  return [
    `M ${cx + outerR} ${cy}`, `A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy}`,
    `A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy}`, `Z`,
    `M ${cx + innerR} ${cy}`, `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
    `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`, `Z`,
  ].join(' ');
}

function annulusArcPath(
  cx: number, cy: number, outerR: number, innerR: number,
  startDeg: number, endDeg: number,
): string {
  const toRad = (deg: number) => (deg - 90) * Math.PI / 180;
  const s = toRad(startDeg), e = toRad(endDeg);
  let sweep = endDeg - startDeg;
  if (sweep < 0) sweep += 360;
  const largeArc = sweep > 180 ? 1 : 0;
  const ox1 = cx + outerR * Math.cos(s), oy1 = cy + outerR * Math.sin(s);
  const ox2 = cx + outerR * Math.cos(e), oy2 = cy + outerR * Math.sin(e);
  const ix1 = cx + innerR * Math.cos(s), iy1 = cy + innerR * Math.sin(s);
  const ix2 = cx + innerR * Math.cos(e), iy2 = cy + innerR * Math.sin(e);
  return [
    `M ${ox1} ${oy1}`, `A ${outerR} ${outerR} 0 ${largeArc} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`, `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`, `Z`,
  ].join(' ');
}

function arcStrokePath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (deg: number) => (deg - 90) * Math.PI / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg)), y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg)), y2 = cy + r * Math.sin(toRad(endDeg));
  let sweep = endDeg - startDeg;
  if (sweep < 0) sweep += 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function circleIntersectionAngles(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): [number, number] | null {
  const dx = bx - ax, dy = by - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > ar + br || d < Math.abs(ar - br) || d === 0) return null;
  const a = (ar * ar - br * br + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ar * ar - a * a));
  const px = ax + a * dx / d, py = ay + a * dy / d;
  const ix1 = px + h * dy / d, iy1 = py - h * dx / d;
  const ix2 = px - h * dy / d, iy2 = py + h * dx / d;
  let angle1 = Math.atan2(iy1 - ay, ix1 - ax) * 180 / Math.PI + 90;
  let angle2 = Math.atan2(iy2 - ay, ix2 - ax) * 180 / Math.PI + 90;
  if (angle1 < 0) angle1 += 360;
  if (angle2 < 0) angle2 += 360;
  return [angle1, angle2];
}

function computeNexusColor(cp: number, dp: number, rp: number) {
  const total = cp + dp + rp;
  if (total === 0) return { color: 'rgba(180,180,180,0.3)', opacity: 0.12 };
  const r = (RING_RGB.catchup[0] * cp + RING_RGB.divein[0] * dp + RING_RGB.recap[0] * rp) / total;
  const g = (RING_RGB.catchup[1] * cp + RING_RGB.divein[1] * dp + RING_RGB.recap[1] * rp) / total;
  const b = (RING_RGB.catchup[2] * cp + RING_RGB.divein[2] * dp + RING_RGB.recap[2] * rp) / total;
  return { color: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`, opacity: 0.2 + (total / 3) * 0.65 };
}

// ─── Progress calculation ────────────────────────────────────────

function computeProgress(metrics: RingMetrics) {
  const catchup = Math.min(metrics.catchup.dailyProgress / Math.max(metrics.catchup.dailyGoal, 1), 1);
  const divein = Math.min(
    (metrics.divein.dailyProgress || metrics.divein.weeklyProgress) /
    Math.max(metrics.divein.dailyGoal || metrics.divein.weeklyGoal, 1), 1);
  const recap = metrics.recap.status === 'completed' ? 1 : metrics.recap.status === 'in_progress' ? 0.5 : 0;
  return { catchup, divein, recap };
}

// ═══════════════════════════════════════════════════════════════════
// HERO PRESET — Triskelion stroked rings matching Figma EDL specs
// Specs: R=70, SW=9, offset=35, fill clockwise from 12 o'clock
// Borromean weave: Blue OVER Pink, Pink OVER Orange, Orange OVER Blue
// ═══════════════════════════════════════════════════════════════════

function HeroRings({ metrics, onRingPress, showChangeGoals, onChangeGoals, dimensions }: {
  metrics: RingMetrics;
  onRingPress?: (s: RingName) => void;
  showChangeGoals?: boolean;
  onChangeGoals?: () => void;
  dimensions: number;
}) {
  const [activeRing, setActiveRing] = useState<RingName | null>(null);
  const prog = computeProgress(metrics);
  const hasProgress = prog.catchup > 0 || prog.divein > 0 || prog.recap > 0;
  const anim = useLiquidAnimation(hasProgress);
  const { isDark } = useTheme();

  // Figma spec: viewBox 200, ring radius 70, stroke 9, center offset 35
  const vb = 200;
  const cx = 100, cy = 98;
  const R = 70;     // ring radius
  const SW = 9;     // stroke width
  const offset = 35; // center-to-center offset

  // Triangle layout: Catch-up top, Dive-in bottom-left, Recap bottom-right
  const tCx = cx, tCy = cy - offset;
  const pCx = cx - offset * 0.866, pCy = cy + offset * 0.5;
  const gCx = cx + offset * 0.866, gCy = cy + offset * 0.5;

  const nexusCx = (tCx + pCx + gCx) / 3;
  const nexusCy = (tCy + pCy + gCy) / 3;
  const avgProgress = (prog.catchup + prog.divein + prog.recap) / 3;

  const RING_COLORS_MAP: Record<RingName, string> = {
    catchup: '#38BDF8',
    divein: '#EC4899',
    recap: '#FB923C',
  };
  const DIM = isDark ? '#2A2E37' : '#D1D5DB'; // unfilled track: dark gray in dark mode, light gray in light mode

  // Circumference for stroke-dasharray progress
  const circumference = 2 * Math.PI * R;

  // Render a single ring with liquid glass fill effects
  const renderRing = (rCx: number, rCy: number, key: RingName, progress: number) => {
    const color = RING_COLORS_MAP[key];
    const fillLength = circumference * Math.min(progress, 1);
    const gapLength = circumference - fillLength;

    return (
      <G>
        {/* Unfilled track — clean circle */}
        <Circle cx={rCx} cy={rCy} r={R} fill="none" stroke={DIM} strokeWidth={SW} />

        {/* Liquid glass fill — gradient-tinted arc */}
        {progress > 0 && (
          <Circle cx={rCx} cy={rCy} r={R} fill="none"
            stroke={color} strokeWidth={SW} strokeLinecap="round"
            strokeDasharray={`${fillLength} ${gapLength}`}
            strokeDashoffset={0}
            transform={`rotate(-90 ${rCx} ${rCy})`}
            opacity={0.9}
          />
        )}

        {/* Inner glow layer — brighter, slightly thinner */}
        {progress > 0 && (
          <Circle cx={rCx} cy={rCy} r={R} fill="none"
            stroke="rgba(255,255,255,0.3)" strokeWidth={SW - 4}
            strokeDasharray={`${fillLength} ${gapLength}`}
            strokeDashoffset={0}
            transform={`rotate(-90 ${rCx} ${rCy})`}
            opacity={anim.pulseOpacity * 0.5}
          />
        )}

        {/* Shimmer sweep — bright highlight moving along fill */}
        {progress > 0.1 && hasProgress && (
          <Circle cx={rCx} cy={rCy} r={R} fill="none"
            stroke="rgba(255,255,255,0.6)" strokeWidth={SW - 2}
            strokeDasharray={`${fillLength * 0.12} ${circumference - fillLength * 0.12}`}
            strokeDashoffset={-fillLength * anim.shimmer[0] * 10}
            transform={`rotate(-90 ${rCx} ${rCy})`}
            opacity={anim.pulseOpacity * 0.8}
          />
        )}

        {/* Meniscus glow at fill edge — bright wobbling line */}
        {progress > 0.05 && progress < 1 && (
          <Circle cx={rCx} cy={rCy} r={R} fill="none"
            stroke="rgba(255,255,255,0.5)" strokeWidth={SW + 2}
            strokeDasharray={`${3 + anim.wobbleA * 4} ${circumference}`}
            strokeDashoffset={-fillLength + 1}
            transform={`rotate(-90 ${rCx} ${rCy})`}
            opacity={0.7}
          />
        )}

        {/* Outer glow behind filled portion */}
        {progress > 0.2 && (
          <Circle cx={rCx} cy={rCy} r={R} fill="none"
            stroke={color} strokeWidth={SW + 6}
            strokeDasharray={`${fillLength} ${gapLength}`}
            strokeDashoffset={0}
            transform={`rotate(-90 ${rCx} ${rCy})`}
            opacity={0.12}
          />
        )}
      </G>
    );
  };

  // Borromean weave: repaint a short arc of the FRONT ring OVER the BACK ring
  // at their intersection point
  const renderWeave = (
    frontCx: number, frontCy: number, frontKey: RingName, frontProg: number,
    startDeg: number, endDeg: number,
  ) => {
    const color = RING_COLORS_MAP[frontKey];
    const fillAngle = frontProg * 360;
    // Only paint the weave arc if the front ring's fill covers this region
    return (
      <G>
        {/* Always paint the track over the back ring */}
        <Path d={arcStrokePath(frontCx, frontCy, R, startDeg, endDeg)}
          fill="none" stroke={DIM} strokeWidth={SW} strokeLinecap="round" />
        {/* Paint filled color if progress covers this arc */}
        {fillAngle > startDeg && (
          <Path d={arcStrokePath(frontCx, frontCy, R, startDeg, Math.min(endDeg, fillAngle))}
            fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />
        )}
      </G>
    );
  };

  return (
    <View style={[styles.container, { paddingVertical: 16, paddingHorizontal: 20 }]}>
      <View style={[styles.ringsWrapper, { width: dimensions, height: dimensions }]}>
        <Svg width={dimensions} height={dimensions} viewBox={`0 0 ${vb} ${vb}`}>
          {/* Ambient glow behind rings (subtle, scales with progress) */}
          {prog.catchup > 0.2 && (
            <Circle cx={tCx} cy={tCy} r={R + 15} fill="#38BDF8" opacity={prog.catchup * 0.08} />
          )}
          {prog.divein > 0.2 && (
            <Circle cx={pCx} cy={pCy} r={R + 15} fill="#EC4899" opacity={prog.divein * 0.08} />
          )}
          {prog.recap > 0.2 && (
            <Circle cx={gCx} cy={gCy} r={R + 15} fill="#FB923C" opacity={prog.recap * 0.08} />
          )}

          {/* Z-order: Dive-in (back) → Recap (mid) → Catch-up (front) */}
          {renderRing(pCx, pCy, 'divein', prog.divein)}
          {renderRing(gCx, gCy, 'recap', prog.recap)}
          {renderRing(tCx, tCy, 'catchup', prog.catchup)}

          {/* Borromean weaves — each ring passes OVER one and UNDER another */}
          {/* Blue over Orange (right intersection) */}
          {renderWeave(tCx, tCy, 'catchup', prog.catchup, 60, 120)}
          {/* Pink over Blue (left intersection) */}
          {renderWeave(pCx, pCy, 'divein', prog.divein, 300, 360)}
          {/* Orange over Pink (bottom intersection) */}
          {renderWeave(gCx, gCy, 'recap', prog.recap, 180, 240)}

          {/* Nexus glow — white point when all three have progress */}
          {avgProgress > 0.2 && (
            <G>
              <Circle cx={nexusCx} cy={nexusCy} r={5 + avgProgress * 10}
                fill="white" opacity={avgProgress * 0.15} />
              {avgProgress > 0.8 && (
                <Circle cx={nexusCx} cy={nexusCy} r={5}
                  fill="white" opacity={0.95} />
              )}
            </G>
          )}

          {/* Over-goal green glow */}
          {prog.catchup >= 1 && metrics.catchup.dailyProgress > metrics.catchup.dailyGoal && (
            <Circle cx={tCx} cy={tCy} r={R + 8} fill="#10B981" opacity={0.12} />
          )}
          {prog.divein >= 1 && (
            <Circle cx={pCx} cy={pCy} r={R + 8} fill="#10B981" opacity={0.12} />
          )}
          {prog.recap >= 1 && (
            <Circle cx={gCx} cy={gCy} r={R + 8} fill="#10B981" opacity={0.12} />
          )}
        </Svg>

        {/* Touch-activated labels */}
        {activeRing === 'catchup' && (
          <View style={[styles.ringLabel, { top: '8%', left: '50%', transform: [{ translateX: -50 }] }]}>
            <Text style={[styles.labelTitle, { color: COLORS.catchup.primary }]}>Catch-up</Text>
            <Text style={styles.labelProgress}>{metrics.catchup.dailyProgress}m / {metrics.catchup.dailyGoal}m today</Text>
          </View>
        )}
        {activeRing === 'divein' && (
          <View style={[styles.ringLabel, { bottom: '22%', left: '5%' }]}>
            <Text style={[styles.labelTitle, { color: COLORS.divein.primary }]}>Dive-in</Text>
            <Text style={styles.labelProgress}>
              {metrics.divein.dailyProgress || metrics.divein.weeklyProgress}m / {metrics.divein.dailyGoal || metrics.divein.weeklyGoal}m
            </Text>
          </View>
        )}
        {activeRing === 'recap' && (
          <View style={[styles.ringLabel, { bottom: '22%', right: '5%' }]}>
            <Text style={[styles.labelTitle, { color: COLORS.recap.primary }]}>Recap</Text>
            <Text style={styles.labelProgress}>
              {metrics.recap.status === 'completed' ? 'Complete!' :
               metrics.recap.status === 'in_progress' ? 'In Progress' : 'Not Started'}
            </Text>
          </View>
        )}

        {/* Touch zones */}
        <Pressable style={[styles.touchZone, { top: '5%', left: '50%', marginLeft: -55 }]}
          onPressIn={() => { setActiveRing('catchup'); onRingPress?.('catchup'); }}
          onPressOut={() => setActiveRing(null)}
          onLongPress={() => router.push('/(tabs)/catchup')} />
        <Pressable style={[styles.touchZone, { bottom: '18%', left: '5%' }]}
          onPressIn={() => { setActiveRing('divein'); onRingPress?.('divein'); }}
          onPressOut={() => setActiveRing(null)}
          onLongPress={() => router.push('/(tabs)/divein')} />
        <Pressable style={[styles.touchZone, { bottom: '18%', right: '5%' }]}
          onPressIn={() => { setActiveRing('recap'); onRingPress?.('recap'); }}
          onPressOut={() => setActiveRing(null)}
          onLongPress={() => router.push('/(tabs)/recap')} />
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {(['catchup', 'divein', 'recap'] as const).map(k => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS[k].primary }]} />
            <Text style={[styles.legendLabel, { color: COLORS[k].primary }]}>
              {k === 'catchup' ? 'Catch-up' : k === 'divein' ? 'Dive-in' : 'Recap'}
            </Text>
          </View>
        ))}
      </View>

      {showChangeGoals && (
        <TouchableOpacity style={styles.changeGoalsLink} onPress={onChangeGoals}>
          <Text style={styles.changeGoalsText}>Adjust goals</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOGO PRESET — Static filled rings, no labels, no animation
// ═══════════════════════════════════════════════════════════════════

function LogoRings({ dimensions }: { dimensions: number }) {
  // Matches Figma EDL Option 2: three simple stroked ring outlines, overlapping.
  // Blue top, pink bottom-left, orange bottom-right. No fills, just clean strokes.
  const vb = 100;
  const r = 18; // ring radius
  const sw = 3; // stroke width
  const offset = 12;

  // Triangle layout: top, bottom-left, bottom-right
  const cx = 50, cy = 48;
  const tCx = cx, tCy = cy - offset;
  const pCx = cx - offset * 0.866, pCy = cy + offset * 0.5;
  const gCx = cx + offset * 0.866, gCy = cy + offset * 0.5;

  return (
    <View style={[styles.centerBox, { width: dimensions, height: dimensions }]}>
      <Svg width={dimensions} height={dimensions} viewBox={`0 0 ${vb} ${vb}`}>
        {/* Blue ring (Catch-up) — top */}
        <Circle cx={tCx} cy={tCy} r={r} fill="none" stroke="#38BDF8" strokeWidth={sw} />
        {/* Pink ring (Dive-in) — bottom-left */}
        <Circle cx={pCx} cy={pCy} r={r} fill="none" stroke="#EC4899" strokeWidth={sw} />
        {/* Orange ring (Recap) — bottom-right */}
        <Circle cx={gCx} cy={gCy} r={r} fill="none" stroke="#FB923C" strokeWidth={sw} />

        {/* Borromean weave: blue passes OVER orange on the right side */}
        <Path
          d={arcStrokePath(tCx, tCy, r, 60, 120)}
          fill="none" stroke="#38BDF8" strokeWidth={sw} strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB PRESET — Single ring arc with progress fill
// ═══════════════════════════════════════════════════════════════════

function TabRing({ ring, progress = 0, focused = false, color = '#64748B', dimensions }: {
  ring: RingName;
  progress: number;
  focused: boolean;
  color: string;
  dimensions: number;
}) {
  const containerSize = dimensions + 8;
  const r = dimensions * 0.36;
  const cx = containerSize / 2, cy = containerSize / 2;
  const strokeW = dimensions * 0.14;

  const ringColor = COLORS[ring].primary;
  const gradientEnd = COLORS[ring].dark;
  const fillDeg = Math.max(0, Math.min(progress, 1)) * 360;
  const displayColor = focused ? ringColor : color;
  const displayEnd = focused ? gradientEnd : color;

  const gradId = `tabRing_${ring}`;
  const gradFillId = `tabFill_${ring}`;

  return (
    <View style={[styles.centerBox, { width: containerSize, height: containerSize }]}>
      {/* Glass halo */}
      <View style={[
        styles.glassHalo,
        {
          width: containerSize, height: containerSize,
          borderRadius: containerSize / 2,
          backgroundColor: focused ? `${ringColor}18` : 'rgba(255,255,255,0.08)',
          borderColor: focused ? `${ringColor}30` : 'rgba(255,255,255,0.12)',
        },
      ]} />

      <Svg width={containerSize} height={containerSize} viewBox={`0 0 ${containerSize} ${containerSize}`}>
        <Defs>
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={displayColor} stopOpacity={0.15} />
            <Stop offset="100%" stopColor={displayEnd} stopOpacity={0.08} />
          </LinearGradient>
          <LinearGradient id={gradFillId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={displayColor} stopOpacity={0.95} />
            <Stop offset="100%" stopColor={displayEnd} stopOpacity={0.75} />
          </LinearGradient>
        </Defs>

        {/* Background ring track */}
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={`url(#${gradId})`} strokeWidth={strokeW} />

        {/* Progress fill arc */}
        {fillDeg > 1 && (
          <Path d={arcStrokePath(cx, cy, r, 0, Math.min(fillDeg, 359.9))}
            fill="none" stroke={`url(#${gradFillId})`} strokeWidth={strokeW} strokeLinecap="round" />
        )}

        {/* Specular highlight */}
        {fillDeg > 30 && (
          <Path d={arcStrokePath(cx, cy, r, 0, Math.min(fillDeg * 0.4, 120))}
            fill="none" stroke={focused ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)'}
            strokeWidth={strokeW * 0.35} strokeLinecap="round" />
        )}
      </Svg>

      {/* Inner icon for distinguishability */}
      <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center', width: containerSize, height: containerSize }}>
        <MaterialIcons
          name={TAB_INNER_ICON[ring]}
          size={Math.round(dimensions * 0.38)}
          color={focused ? ringColor : color}
        />
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INDICATOR PRESET — Recap ring only with liquid fill
// ═══════════════════════════════════════════════════════════════════

function IndicatorRing({ progress = 0, dimensions }: { progress: number; dimensions: number }) {
  const vb = 100;
  const cx = 50, cy = 50;
  const outerR = 42, innerR = 28;
  const fillAngle = progress * 360;
  const anim = useLiquidAnimation(progress > 0);

  return (
    <View style={[styles.centerBox, { width: dimensions, height: dimensions }]}>
      <Svg width={dimensions} height={dimensions} viewBox={`0 0 ${vb} ${vb}`}>
        <Defs>
          <RadialGradient id="indGlass" cx="38%" cy="35%" r="65%">
            <Stop offset="0%" stopColor="#FED7AA" stopOpacity={0.25} />
            <Stop offset="50%" stopColor="#FDBA74" stopOpacity={0.17} />
            <Stop offset="100%" stopColor="#FB923C" stopOpacity={0.12} />
          </RadialGradient>
          <RadialGradient id="indLiquid" cx="38%" cy="35%" r="65%">
            <Stop offset="0%" stopColor="#FED7AA" stopOpacity={0.90} />
            <Stop offset="40%" stopColor="#FDBA74" stopOpacity={0.82} />
            <Stop offset="75%" stopColor="#FB923C" stopOpacity={0.75} />
            <Stop offset="100%" stopColor="#9A3412" stopOpacity={0.68} />
          </RadialGradient>
          <LinearGradient id="indSpec" x1="15%" y1="10%" x2="85%" y2="90%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.35} />
            <Stop offset="35%" stopColor="#FFFFFF" stopOpacity={0.06} />
            <Stop offset="65%" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0.10} />
          </LinearGradient>
        </Defs>

        {/* Ambient glow */}
        <Circle cx={cx} cy={cy} r={outerR + 6} fill="#FB923C" opacity={0.12} />

        {/* Glass body */}
        <Path d={annulusPath(cx, cy, outerR, innerR)} fill="url(#indGlass)" />

        {/* Liquid fill */}
        {progress > 0 && progress < 1 && (
          <G>
            <Path d={annulusArcPath(cx, cy, outerR, innerR, 0, fillAngle)} fill="url(#indLiquid)" />
            <Path d={annulusArcPath(cx, cy, outerR - 1, innerR + 1, 0, Math.min(fillAngle, 359.9))}
              fill="url(#indSpec)" opacity={anim.pulseOpacity} />
          </G>
        )}
        {progress >= 1 && (
          <G>
            <Path d={annulusPath(cx, cy, outerR, innerR)} fill="url(#indLiquid)" />
            <Path d={annulusPath(cx, cy, outerR, innerR)} fill="url(#indSpec)" opacity={anim.pulseOpacity} />
          </G>
        )}

        {/* Rim */}
        <Circle cx={cx} cy={cy} r={outerR} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
        <Circle cx={cx} cy={cy} r={innerR} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.8} />

        {/* Specular crescent */}
        <Path d={annulusArcPath(cx, cy, outerR - 2, innerR + 4, 220, 320)}
          fill="rgba(255,255,255,0.3)" />
      </Svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GHOST PRESET — Two rings filled, recap ring ghosted outline
// ═══════════════════════════════════════════════════════════════════

function GhostRings({ metrics, dimensions }: { metrics: RingMetrics; dimensions: number }) {
  const prog = computeProgress(metrics);
  const anim = useLiquidAnimation(prog.catchup > 0 || prog.divein > 0);

  const vb = 400;
  const cx = vb / 2, cy = vb / 2;
  const outerR = 105, innerR = 55, midR = (outerR + innerR) / 2;
  const offset = 58;

  const tCx = cx, tCy = cy - offset - 2;
  const pCx = cx - offset * 0.866, pCy = cy + offset * 0.5 - 2;
  const gCx = cx + offset * 0.866, gCy = cy + offset * 0.5 - 2;

  const tFill = prog.catchup * 360;
  const pFill = prog.divein * 360;

  const renderSolidRing = (rCx: number, rCy: number, key: RingName, progress: number, fillAngle: number) => {
    const full = annulusPath(rCx, rCy, outerR, innerR);
    return (
      <G>
        {/* Glass body — only on filled portion when partial */}
        {progress > 0 && progress < 1 ? (
          <Path d={annulusArcPath(rCx, rCy, outerR, innerR, 0, fillAngle)}
            fill={`url(#${key}Glass)`} />
        ) : (
          <Path d={full} fill={`url(#${key}Glass)`} />
        )}
        {/* Liquid fill */}
        {progress > 0 && progress < 1 && (
          <Path d={annulusArcPath(rCx, rCy, outerR, innerR, 0, fillAngle)}
            fill={`url(#${key}Liquid)`} />
        )}
        {progress >= 1 && <Path d={full} fill={`url(#${key}Liquid)`} />}
        {/* Rim — bright on filled, dim on unfilled */}
        {progress > 0 && progress < 1 ? (
          <G>
            <Path d={arcStrokePath(rCx, rCy, outerR, 0, fillAngle)}
              fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} strokeLinecap="round" />
            <Path d={arcStrokePath(rCx, rCy, outerR, fillAngle, 359.9)}
              fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.0} strokeLinecap="round" />
          </G>
        ) : (
          <Circle cx={rCx} cy={rCy} r={outerR} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} />
        )}
        <Circle cx={rCx} cy={rCy} r={innerR} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={0.8} />
      </G>
    );
  };

  return (
    <View style={[styles.centerBox, { width: dimensions, height: dimensions }]}>
      <Svg width={dimensions} height={dimensions} viewBox={`0 0 ${vb} ${vb}`}>
        <Defs>
          {/* Glass body — near-invisible tint (matches hero) */}
          <RadialGradient id="catchupGlass" cx="38%" cy="30%" r="65%">
            <Stop offset="0%" stopColor="#BAE6FD" stopOpacity={0.04} />
            <Stop offset="50%" stopColor="#7DD3FC" stopOpacity={0.02} />
            <Stop offset="100%" stopColor="#38BDF8" stopOpacity={0.01} />
          </RadialGradient>
          <RadialGradient id="diveinGlass" cx="62%" cy="30%" r="65%">
            <Stop offset="0%" stopColor="#FBCFE8" stopOpacity={0.04} />
            <Stop offset="50%" stopColor="#F472B6" stopOpacity={0.02} />
            <Stop offset="100%" stopColor="#EC4899" stopOpacity={0.01} />
          </RadialGradient>
          <RadialGradient id="catchupLiquid" cx="38%" cy="30%" r="65%">
            <Stop offset="0%" stopColor="#7DD3FC" stopOpacity={0.90} />
            <Stop offset="50%" stopColor="#38BDF8" stopOpacity={0.75} />
            <Stop offset="100%" stopColor="#0C4A6E" stopOpacity={0.68} />
          </RadialGradient>
          <RadialGradient id="diveinLiquid" cx="62%" cy="30%" r="65%">
            <Stop offset="0%" stopColor="#FBCFE8" stopOpacity={0.90} />
            <Stop offset="50%" stopColor="#EC4899" stopOpacity={0.75} />
            <Stop offset="100%" stopColor="#831843" stopOpacity={0.68} />
          </RadialGradient>
          <RadialGradient id="recapGlass" cx="50%" cy="30%" r="65%">
            <Stop offset="0%" stopColor="#FED7AA" stopOpacity={0.04} />
            <Stop offset="50%" stopColor="#FB923C" stopOpacity={0.02} />
            <Stop offset="100%" stopColor="#EA580C" stopOpacity={0.01} />
          </RadialGradient>
          <RadialGradient id="recapLiquid" cx="50%" cy="30%" r="65%">
            <Stop offset="0%" stopColor="#FED7AA" stopOpacity={0.90} />
            <Stop offset="50%" stopColor="#FB923C" stopOpacity={0.75} />
            <Stop offset="100%" stopColor="#9A3412" stopOpacity={0.68} />
          </RadialGradient>
        </Defs>

        {/* Ambient glow */}
        <Circle cx={tCx} cy={tCy} r={outerR + 25} fill="#38BDF8" opacity={0.10} />
        <Circle cx={pCx} cy={pCy} r={outerR + 25} fill="#EC4899" opacity={0.10} />
        <Circle cx={gCx} cy={gCy} r={outerR + 25} fill="#FB923C" opacity={0.05} />

        {/* Catchup + Divein filled */}
        {renderSolidRing(tCx, tCy, 'catchup', prog.catchup, tFill)}
        {renderSolidRing(pCx, pCy, 'divein', prog.divein, pFill)}

        {/* Recap ring — filled when completed/in-progress, ghosted outline otherwise */}
        {prog.recap > 0 ? (
          renderSolidRing(gCx, gCy, 'recap', prog.recap, prog.recap * 360)
        ) : (
          <G>
            <Path d={annulusPath(gCx, gCy, outerR, innerR)}
              fill="rgba(251, 146, 60, 0.06)" />
            <Circle cx={gCx} cy={gCy} r={outerR}
              fill="none" stroke="rgba(251, 146, 60, 0.20)" strokeWidth={1.5} strokeDasharray="8,6" />
            <Circle cx={gCx} cy={gCy} r={innerR}
              fill="none" stroke="rgba(251, 146, 60, 0.10)" strokeWidth={1} strokeDasharray="6,4" />
          </G>
        )}
      </Svg>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT — Routes to correct preset
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_DIMENSIONS: Record<SizePreset, number> = {
  hero: 160,
  logo: 80,
  tab: 24,
  indicator: 40,
  ghost: 300,
};

export default function GuruRings(props: GuruRingsProps) {
  const dim = props.dimensions ?? DEFAULT_DIMENSIONS[props.size];

  switch (props.size) {
    case 'hero':
      return (
        <HeroRings
          metrics={props.metrics!}
          onRingPress={props.onRingPress}
          showChangeGoals={props.showChangeGoals}
          onChangeGoals={props.onChangeGoals}
          dimensions={dim}
        />
      );

    case 'logo':
      return <LogoRings dimensions={dim} />;

    case 'tab':
      return (
        <TabRing
          ring={props.ring || 'catchup'}
          progress={props.progress ?? 0}
          focused={props.focused ?? false}
          color={props.color ?? '#64748B'}
          dimensions={dim}
        />
      );

    case 'indicator':
      return <IndicatorRing progress={props.progress ?? 0} dimensions={dim} />;

    case 'ghost':
      return <GhostRings metrics={props.metrics!} dimensions={dim} />;

    default:
      return <LogoRings dimensions={dim} />;
  }
}

// ─── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  centerBox: { justifyContent: 'center', alignItems: 'center' },
  ringsWrapper: {
    position: 'relative', alignItems: 'center', justifyContent: 'center',
  },
  ringLabel: {
    position: 'absolute', alignItems: 'center',
    backgroundColor: COLORS.glass.labelBg,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.glass.labelBorder,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  labelTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  labelProgress: { fontSize: 11, fontWeight: '500', color: '#94A3B8' },
  touchZone: { position: 'absolute', width: 110, height: 110, borderRadius: 55 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  changeGoalsLink: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 16 },
  changeGoalsText: { fontSize: 14, color: '#38BDF8', fontWeight: '600', textDecorationLine: 'underline' as const, textDecorationColor: 'rgba(56, 189, 248, 0.5)' },
  glassHalo: { position: 'absolute', borderWidth: 1 },
});
