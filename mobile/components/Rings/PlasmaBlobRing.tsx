/**
 * PlasmaBlobRing v2 — B2a "Intense Bloom" single ring component.
 *
 * 9-layer rendering pipeline (back to front):
 *   1. Wide diffuse aura     — color 24%, blur 48px, width = SW + 80
 *   2. Track                 — ring color 7%, full circle
 *   3. Medium glow halo      — color 72%, blur 19px, width = SW + 14
 *   4. Plasma body            — linear gradient (light→sat→dark)
 *   5. Specular highlight     — white 35% on inner rim, first 55% of arc
 *   6. Inner shadow           — black 30% on outer rim
 *   7. Hot white core         — white 45%, 3px, blur 1.5px
 *   8. Leading edge flare     — radial white→color gradient
 *   9. Particle wake          — 3 descending-opacity dots
 *
 * `minimal` mode (for ≤40px) drops layers 1, 3, 5, 6, 8, 9 for performance.
 *
 * Source of truth: B2a Intense Bloom spec (ring-hero-only.html), Figma P8PHHnUNHwwCMXMLpVADns
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, View, StyleSheet } from 'react-native';

export interface PlasmaBlobRingProps {
  /** 0..1+ (values > 1 accepted for over-goal) */
  progress: number;
  /** Hex color (e.g. "#38BDF8") */
  color: string;
  /** Outer diameter in px. Default 200. */
  size?: number;
  /** Stroke width. Default calculated from size. */
  stroke?: number;
  /** Minimal mode — drops heavy layers. Auto-enabled when size ≤ 40. */
  minimal?: boolean;
  /** Suppress all animations. */
  reducedMotion?: boolean;
  /** Optional center X. Default size/2. */
  cx?: number;
  /** Optional center Y. Default size/2. */
  cy?: number;
}

// ─── Color helpers ───────────────────────────────────────────────

function hex2rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

const lighten = (hex: string, amt: number) => {
  const [r, g, b] = hex2rgb(hex);
  return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
};

const darken = (hex: string, amt: number) => {
  const [r, g, b] = hex2rgb(hex);
  return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
};

function hashColor(hex: string): string {
  return hex.startsWith('#') ? hex : `#${hex}`;
}

// ─── Web-only Canvas renderer ────────────────────────────────────

function PlasmaBlobRingCanvas({
  progress,
  color,
  size = 200,
  stroke,
  minimal: minimalProp,
  reducedMotion,
  cx: cxProp,
  cy: cyProp,
}: PlasmaBlobRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  const c = hashColor(color);
  const r = size / 2 - (stroke ?? size * 0.04);
  const sw = stroke ?? Math.max(2.5, Math.round(r * 0.12));
  const p = Math.max(0, Math.min(1, progress));
  const minimal = minimalProp ?? size <= 40;
  const GM = 1.6; // Glow multiplier — B2a "intense"
  // Add padding so glow blur doesn't clip at canvas edges
  const PAD = minimal ? 4 : Math.round(size * 0.35);
  const canvasSize = size + PAD * 2;
  const centerX = cxProp ?? canvasSize / 2;
  const centerY = cyProp ?? canvasSize / 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvasSize, canvasSize);

      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + 2 * Math.PI * p;

      // ── Layer 1: Wide diffuse aura ──
      if (p > 0 && !minimal) {
        ctx.save();
        ctx.globalAlpha = 0.15 * GM;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, startAngle, endAngle);
        ctx.strokeStyle = rgba(c, 1);
        ctx.lineWidth = sw + 50 * GM;
        ctx.lineCap = 'round';
        ctx.filter = `blur(${30 * GM}px)`;
        ctx.stroke();
        ctx.restore();
      }

      // ── Layer 2: Track ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      // GUR-24: stronger track in minimal (tab-icon) mode so low-progress
      // icons read as a full ring, not a stray crescent.
      ctx.strokeStyle = rgba(c, minimal ? 0.22 : (p > 0 ? 0.06 : 0.09));
      ctx.lineWidth = sw;
      ctx.lineCap = 'round';
      ctx.stroke();
      if (!minimal) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r - sw / 2 + 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      ctx.restore();

      if (p <= 0) return;

      // ── Layer 3: Medium glow halo ──
      if (!minimal) {
        ctx.save();
        ctx.globalAlpha = 0.45 * GM;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, startAngle, endAngle);
        ctx.strokeStyle = rgba(c, 1);
        ctx.lineWidth = sw + 14;
        ctx.lineCap = 'round';
        ctx.filter = `blur(${12 * GM}px)`;
        ctx.stroke();
        ctx.restore();
      } else {
        // Minimal glow for small sizes
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, startAngle, endAngle);
        ctx.strokeStyle = rgba(c, 1);
        ctx.lineWidth = sw + 4;
        ctx.lineCap = 'round';
        ctx.filter = 'blur(3px)';
        ctx.stroke();
        ctx.restore();
      }

      // ── Layer 4: Plasma body ──
      ctx.save();
      const grad = ctx.createLinearGradient(
        centerX - r, centerY - r,
        centerX + r, centerY + r,
      );
      grad.addColorStop(0, rgba(c, 0.85));
      grad.addColorStop(0.3, lighten(c, 40) + '');
      grad.addColorStop(0.7, rgba(c, 0.9));
      grad.addColorStop(1, darken(c, 30) + '');
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, startAngle, endAngle);
      ctx.strokeStyle = grad;
      ctx.lineWidth = sw;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      if (!minimal) {
        // ── Layer 5: Specular highlight ──
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, r - sw / 2 + 1, startAngle, startAngle + (endAngle - startAngle) * 0.55);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        // ── Layer 6: Inner shadow ──
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, r + sw / 2 - 0.5, startAngle + 0.4, endAngle);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }

      // ── Layer 7: Hot white core ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, startAngle, endAngle);
      ctx.strokeStyle = `rgba(255,255,255,${minimal ? 0.35 : 0.45})`;
      ctx.lineWidth = minimal ? 1 : 3;
      ctx.lineCap = 'round';
      ctx.filter = minimal ? 'blur(0.5px)' : 'blur(1.5px)';
      ctx.stroke();
      ctx.restore();

      if (!minimal) {
        // ── Layer 8: Leading edge flare ──
        const ex = centerX + Math.cos(endAngle) * r;
        const ey = centerY + Math.sin(endAngle) * r;
        const flareR = 24;
        const flare = ctx.createRadialGradient(ex, ey, 0, ex, ey, flareR);
        flare.addColorStop(0, 'rgba(255,255,255,0.9)');
        flare.addColorStop(0.2, lighten(c, 80));
        flare.addColorStop(0.5, rgba(c, 0.3));
        flare.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = flare;
        ctx.fillRect(ex - flareR, ey - flareR, flareR * 2, flareR * 2);

        // ── Layer 9: Particle wake ──
        for (let i = 0; i < 3; i++) {
          const pa = endAngle + 0.04 + i * 0.05;
          const pr = r + (i === 1 ? 4 : -3);
          const px = centerX + Math.cos(pa) * pr;
          const py = centerY + Math.sin(pa) * pr;
          ctx.save();
          ctx.globalAlpha = 0.5 - i * 0.15;
          ctx.filter = 'blur(1.5px)';
          ctx.fillStyle = lighten(c, 60);
          ctx.beginPath();
          ctx.arc(px, py, 3 - i * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    draw();

    // No animation loop for now — static render (animation polish in GUR-130)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [progress, color, size, stroke, minimal, centerX, centerY, canvasSize]);

  return (
    <View style={{ width: size, height: size, overflow: 'visible' } as any}>
      <canvas
        ref={canvasRef}
        width={canvasSize}
        height={canvasSize}
        style={{
          width: canvasSize,
          height: canvasSize,
          marginLeft: -PAD,
          marginTop: -PAD,
          pointerEvents: 'none',
        } as any}
      />
    </View>
  );
}

// ─── SVG fallback for native platforms ───────────────────────────

import Svg, { Circle, Defs, RadialGradient, Stop, G } from 'react-native-svg';

function PlasmaBlobRingSvg({
  progress,
  color,
  size = 200,
  stroke,
  minimal: minimalProp,
  reducedMotion,
  cx: cxProp,
  cy: cyProp,
}: PlasmaBlobRingProps) {
  const c = hashColor(color);
  const r = size / 2 - (stroke ?? size * 0.04);
  const sw = stroke ?? Math.max(2.5, Math.round(r * 0.12));
  const centerX = cxProp ?? size / 2;
  const centerY = cyProp ?? size / 2;
  const p = Math.max(0, Math.min(1, progress));
  const circumference = 2 * Math.PI * r;
  const filled = circumference * p;
  const minimal = minimalProp ?? size <= 40;

  return (
    <Svg width={size} height={size}>
      {/* Track */}
      <Circle
        cx={centerX}
        cy={centerY}
        r={r}
        stroke={rgba(c, minimal ? 0.22 : (p > 0 ? 0.07 : 0.12))}
        strokeWidth={sw}
        fill="none"
      />

      {/* Glow halo */}
      {p > 0 && (
        <Circle
          cx={centerX}
          cy={centerY}
          r={r}
          stroke={rgba(c, 0.35)}
          strokeWidth={sw + (minimal ? 4 : 14)}
          fill="none"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${centerX} ${centerY})`}
          opacity={0.7}
        />
      )}

      {/* Plasma body */}
      {p > 0 && (
        <Circle
          cx={centerX}
          cy={centerY}
          r={r}
          stroke={c}
          strokeWidth={sw}
          fill="none"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${centerX} ${centerY})`}
        />
      )}

      {/* Hot white core */}
      {p > 0 && (
        <Circle
          cx={centerX}
          cy={centerY}
          r={r}
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={minimal ? 1 : 2.5}
          fill="none"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${centerX} ${centerY})`}
        />
      )}

      {/* Leading edge flare (simplified for native) */}
      {p > 0 && p < 1 && !minimal && (
        <>
          <Defs>
            <RadialGradient id={`flare-${c.replace('#','')}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
              <Stop offset="30%" stopColor={c} stopOpacity={0.6} />
              <Stop offset="100%" stopColor={c} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle
            cx={centerX + Math.cos(-Math.PI / 2 + 2 * Math.PI * p) * r}
            cy={centerY + Math.sin(-Math.PI / 2 + 2 * Math.PI * p) * r}
            r={16}
            fill={`url(#flare-${c.replace('#','')})`}
          />
        </>
      )}
    </Svg>
  );
}

// ─── Platform-aware export ───────────────────────────────────────

export function PlasmaBlobRing(props: PlasmaBlobRingProps) {
  if (Platform.OS === 'web') {
    return <PlasmaBlobRingCanvas {...props} />;
  }
  return <PlasmaBlobRingSvg {...props} />;
}

export default PlasmaBlobRing;
