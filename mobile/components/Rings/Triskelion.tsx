/**
 * Triskelion v2 — B2a "Intense Bloom" 3-ring composition.
 *
 * On web: renders ALL rings into a single <canvas> for proper compositing
 * of glow layers, Borromean weave, nexus, and celebration halo.
 *
 * On native: uses positioned PlasmaBlobRing views with CausticOverlap + NexusSphere.
 *
 * Borromean paint order: Orange (back) → Pink (mid) → Blue (front)
 * Nexus: white radial gradient when all 3 rings > 0%
 * Celebration: outward halo pulse when all 3 ≥ 100%
 *
 * Source: B2a spec, Figma P8PHHnUNHwwCMXMLpVADns
 */

import React, { useEffect, useRef } from 'react';
import { Platform, View, Pressable } from 'react-native';
import { PlasmaBlobRing } from './PlasmaBlobRing';
import { NexusSphere } from './NexusSphere';

export interface TriskelionProgress {
  c: number; // Catch-up (blue)
  d: number; // Dive-in (pink)
  r: number; // Recap (orange)
}

export interface TriskelionProps {
  size?: number;
  progress: TriskelionProgress;
  mode?: 'logo' | 'progress';
  volumetric?: boolean;
  celebrate?: boolean;
  reducedMotion?: boolean;
  colors?: { catchup?: string; divein?: string; recap?: string };
  /** Tap a ring to navigate to its section. Zones: top→catchup, bottom-left→recap, bottom-right→divein. */
  onRingPress?: (section: 'catchup' | 'divein' | 'recap') => void;
}

const DEFAULT_COLORS = { catchup: '#38BDF8', divein: '#EC4899', recap: '#FB923C' };

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

// ─── Canvas ring painter (shared by web Triskelion) ──────────────

function paintPlasmaRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  SW: number,
  color: string,
  fill: number,
  minimal: boolean,
) {
  const p = Math.max(0, Math.min(1, fill));
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + 2 * Math.PI * p;
  const GM = 1.6;

  // L1: Wide diffuse aura
  if (p > 0 && !minimal) {
    ctx.save();
    ctx.globalAlpha = 0.15 * GM;
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = SW + 50 * GM;
    ctx.lineCap = 'round';
    ctx.filter = `blur(${30 * GM}px)`;
    ctx.stroke();
    ctx.restore();
  }

  // L2: Track
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(color, p > 0 ? 0.06 : 0.09);
  ctx.lineWidth = SW;
  ctx.lineCap = 'round';
  ctx.stroke();
  if (!minimal) {
    ctx.beginPath();
    ctx.arc(cx, cy, R - SW / 2 + 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.restore();

  if (p <= 0) return;

  // L3: Medium glow halo
  if (!minimal) {
    ctx.save();
    ctx.globalAlpha = 0.45 * GM;
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = SW + 14;
    ctx.lineCap = 'round';
    ctx.filter = `blur(${12 * GM}px)`;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = SW + 4;
    ctx.lineCap = 'round';
    ctx.filter = 'blur(3px)';
    ctx.stroke();
    ctx.restore();
  }

  // L4: Plasma body
  ctx.save();
  const grad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  grad.addColorStop(0, rgba(color, 0.85));
  grad.addColorStop(0.3, lighten(color, 40));
  grad.addColorStop(0.7, rgba(color, 0.9));
  grad.addColorStop(1, darken(color, 30));
  ctx.beginPath();
  ctx.arc(cx, cy, R, startAngle, endAngle);
  ctx.strokeStyle = grad;
  ctx.lineWidth = SW;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  if (!minimal) {
    // L5: Specular highlight
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - SW / 2 + 1, startAngle, startAngle + (endAngle - startAngle) * 0.55);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // L6: Inner shadow
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + SW / 2 - 0.5, startAngle + 0.4, endAngle);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // L7: Hot white core
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, startAngle, endAngle);
  ctx.strokeStyle = `rgba(255,255,255,${minimal ? 0.35 : 0.45})`;
  ctx.lineWidth = minimal ? 1 : 3;
  ctx.lineCap = 'round';
  ctx.filter = minimal ? 'blur(0.5px)' : 'blur(1.5px)';
  ctx.stroke();
  ctx.restore();

  if (!minimal) {
    // L8: Leading edge flare
    const ex = cx + Math.cos(endAngle) * R;
    const ey = cy + Math.sin(endAngle) * R;
    const flareR = 24;
    const flare = ctx.createRadialGradient(ex, ey, 0, ex, ey, flareR);
    flare.addColorStop(0, 'rgba(255,255,255,0.9)');
    flare.addColorStop(0.2, lighten(color, 80));
    flare.addColorStop(0.5, rgba(color, 0.3));
    flare.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = flare;
    ctx.fillRect(ex - flareR, ey - flareR, flareR * 2, flareR * 2);

    // L9: Particle wake
    for (let i = 0; i < 3; i++) {
      const pa = endAngle + 0.04 + i * 0.05;
      const pr = R + (i === 1 ? 4 : -3);
      const px = cx + Math.cos(pa) * pr;
      const py = cy + Math.sin(pa) * pr;
      ctx.save();
      ctx.globalAlpha = 0.5 - i * 0.15;
      ctx.filter = 'blur(1.5px)';
      ctx.fillStyle = lighten(color, 60);
      ctx.beginPath();
      ctx.arc(px, py, 3 - i * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function paintNexus(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, bright: number) {
  const n = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  n.addColorStop(0, `rgba(255,255,255,${bright})`);
  n.addColorStop(0.08, `rgba(240,245,255,${bright * 0.7})`);
  n.addColorStop(0.25, `rgba(180,200,255,${bright * 0.3})`);
  n.addColorStop(0.5, `rgba(120,150,255,${bright * 0.08})`);
  n.addColorStop(1, 'rgba(80,100,200,0)');
  ctx.fillStyle = n;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Web Canvas Triskelion ───────────────────────────────────────

function TriskelionCanvas({
  size = 220,
  progress,
  celebrate = false,
  colors,
  onRingPress,
}: TriskelionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cc = { ...DEFAULT_COLORS, ...(colors ?? {}) };

  const p = {
    c: Math.max(0, progress.c),
    d: Math.max(0, progress.d),
    r: Math.max(0, progress.r),
  };
  const render = { c: Math.min(1, p.c), d: Math.min(1, p.d), r: Math.min(1, p.r) };
  const allFilled = p.c >= 1 && p.d >= 1 && p.r >= 1;
  const anyOver = p.c > 1 || p.d > 1 || p.r > 1;
  const anyProgress = p.c > 0 || p.d > 0 || p.r > 0;

  // Geometry — B2a spec
  const minimal = size <= 50;
  // Add padding so glow blur filters don't clip at canvas edges. At minimal
  // (tab) size this was 10, which made the canvas 48px for a 28px icon — 14px
  // taller than the single-ring tabs (PlasmaBlobRing PAD 4), so the top ring's
  // glow leaked above the floating tab bar. Match PlasmaBlobRing's PAD=4 so the
  // Home triskelion canvas footprint equals the other tab icons and centers
  // cleanly inside the bar.
  const PAD = minimal ? 4 : Math.round(size * 0.35);
  const canvasSize = size + PAD * 2;
  // At tab (minimal) size the triskelion is rendered a touch smaller AND shifted
  // DOWN inside its canvas. The canvas top sits flush with the active pill's top
  // edge, so a full-size, top-anchored top ring (Catch-up) spilled its glow out
  // of the pill — flagged repeatedly. Compacting + nudging down gives the top
  // ring clear margin below the pill edge while keeping the cluster centred.
  const R = size * (minimal ? 0.30 : 0.32);       // ring radius
  const offset = size * (minimal ? 0.16 : 0.175); // center-to-ring-center distance
  const yShift = minimal ? size * 0.12 : 0;       // push cluster down inside canvas
  const SW = Math.max(2.5, R * 0.2); // 16px at 200px size
  const CX = canvasSize / 2;
  const CY = canvasSize / 2 + yShift;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Background ambient
    const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, canvasSize * 0.6);
    bg.addColorStop(0, 'rgba(30,35,65,0.2)');
    bg.addColorStop(1, 'rgba(6,10,18,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Celebration halo
    if ((allFilled && celebrate) || anyOver) {
      const haloMult = anyOver ? 1.5 : 1.0;
      const h = ctx.createRadialGradient(CX, CY, R * 0.8, CX, CY, R * 2.2 * haloMult);
      h.addColorStop(0, 'rgba(200,210,255,0)');
      h.addColorStop(0.5, `rgba(180,200,255,${0.06 * haloMult})`);
      h.addColorStop(0.8, `rgba(150,170,255,${0.12 * haloMult})`);
      h.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = h;
      ctx.fillRect(0, 0, canvasSize, canvasSize);
    }

    // Ring positions
    const rings = [
      { color: cc.recap,   cx: CX - offset * 0.866, cy: CY + offset * 0.5, fill: render.r },
      { color: cc.divein,  cx: CX + offset * 0.866, cy: CY + offset * 0.5, fill: render.d },
      { color: cc.catchup, cx: CX, cy: CY - offset, fill: render.c },
    ];

    // Paint in Borromean order: Orange → Pink → Blue
    for (const ring of rings) {
      paintPlasmaRing(ctx, ring.cx, ring.cy, R, SW, ring.color, ring.fill, minimal);
    }

    // Nexus — when all 3 have any progress
    if (anyProgress) {
      const nexusBright = allFilled ? 0.95 : 0.5;
      const nexusR = allFilled ? size * 0.15 : size * 0.08;
      paintNexus(ctx, CX, CY, nexusR, nexusBright);
    }
  }, [progress.c, progress.d, progress.r, size, celebrate, colors]);

  // The rendered ring cluster is centred in the size×size box (canvas is
  // PAD-offset). Map a tap to its ring by zone: top→catchup, bottom-left→recap,
  // bottom-right→divein. Tolerant by design — the rings overlap in the centre.
  const handlePress = onRingPress
    ? (e: any) => {
        const { locationX = 0, locationY = 0 } = e?.nativeEvent ?? {};
        const fx = locationX / size;
        const fy = locationY / size;
        onRingPress(fy < 0.45 ? 'catchup' : fx < 0.5 ? 'recap' : 'divein');
      }
    : undefined;

  return (
    <Pressable
      onPress={handlePress}
      disabled={!onRingPress}
      accessibilityRole={onRingPress ? 'button' : undefined}
      accessibilityLabel={onRingPress ? 'Activity rings — tap a ring to open its section' : undefined}
      style={{ width: size, height: size, overflow: 'visible' } as any}
    >
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
    </Pressable>
  );
}

// ─── Native SVG Triskelion ───────────────────────────────────────

function TriskelionNative({
  size = 220,
  progress,
  volumetric = false,
  celebrate = false,
  reducedMotion,
  colors,
}: TriskelionProps) {
  const cc = { ...DEFAULT_COLORS, ...(colors ?? {}) };
  const ringSize = Math.round(size * 0.58);
  const offset = Math.round(size * 0.18);
  const center = size / 2;
  const minimal = size <= 50;

  const cu = { x: center, y: center - offset * 0.92 };
  const dv = { x: center + offset * 0.92, y: center + offset * 0.55 };
  const rc = { x: center - offset * 0.92, y: center + offset * 0.55 };

  const p = {
    c: Math.max(0, Math.min(1, progress.c)),
    d: Math.max(0, Math.min(1, progress.d)),
    r: Math.max(0, Math.min(1, progress.r)),
  };
  const allFilled = progress.c >= 1 && progress.d >= 1 && progress.r >= 1;
  const anyOver = progress.c > 1 || progress.d > 1 || progress.r > 1;

  const ringWrap = (cx: number, cy: number, key: string, children: React.ReactNode) => (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: cx - ringSize / 2,
        top: cy - ringSize / 2,
        width: ringSize,
        height: ringSize,
      }}
    >
      {children}
    </View>
  );

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Orange → Pink → Blue paint order */}
      {ringWrap(rc.x, rc.y, 'recap',
        <PlasmaBlobRing progress={p.r} color={cc.recap} size={ringSize} minimal={minimal} reducedMotion={reducedMotion} />
      )}
      {ringWrap(dv.x, dv.y, 'divein',
        <PlasmaBlobRing progress={p.d} color={cc.divein} size={ringSize} minimal={minimal} reducedMotion={reducedMotion} />
      )}
      {ringWrap(cu.x, cu.y, 'catchup',
        <PlasmaBlobRing progress={p.c} color={cc.catchup} size={ringSize} minimal={minimal} reducedMotion={reducedMotion} />
      )}

      {allFilled && (
        <View style={{ position: 'absolute', left: center - size * 0.1, top: center - size * 0.1, width: size * 0.2, height: size * 0.2 }}>
          <NexusSphere size={size * 0.2} celebrate={celebrate || anyOver} reducedMotion={reducedMotion} />
        </View>
      )}
    </View>
  );
}

// ─── Platform-aware export ───────────────────────────────────────

export function Triskelion(props: TriskelionProps) {
  const resolvedProps = props.mode === 'logo'
    ? { ...props, progress: { c: 1, d: 1, r: 1 } }
    : props;

  if (Platform.OS === 'web') {
    return <TriskelionCanvas {...resolvedProps} />;
  }
  return <TriskelionNative {...resolvedProps} />;
}

export default Triskelion;
