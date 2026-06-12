import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import GuruBlob from '../ui/GuruBlob';

/**
 * RecapHero — the Recap tab's weekly hero in the constellation identity
 * (GUR-228). Replaces the legacy PlasmaBlobRing entry ring.
 *
 * The living organism (GuruBlob) sits centered in a dark clearing, wearing
 * ONE large circular progress arc in recap gold — the same arc language as
 * StarIcon (thin low-alpha track + solid progress fill + bright end-dot),
 * scaled up to hero size, with a soft ambient gold glow breathing behind.
 *
 * Web renders on a 2D canvas (matching StarIcon/GuruBlob's approach) and
 * honors prefers-reduced-motion by drawing a single static frame. Native
 * falls back to a react-native-svg arc (same fallback strategy as
 * PlasmaBlobRing) around GuruBlob's own native fallback.
 */

const GOLD = '#FB923C'; // recap accent

export type RecapHeroState = 'not_started' | 'in_progress' | 'completed';

interface RecapHeroProps {
  /** Outer diameter in px. Default 240 (legacy hero size). */
  size?: number;
  /** Ring fill, 0..1. */
  progress: number;
  /** Journey state — 'completed' makes the organism celebrate. */
  state?: RecapHeroState;
}

function RecapHeroCanvas({ size, progress, state }: Required<RecapHeroProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progRef = useRef(progress);
  progRef.current = progress;

  // Overscan so the ambient glow + end-dot bloom never clip at the edges.
  const PAD = Math.ceil(size * 0.14);
  const W = size + PAD * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = W * dpr;
    canvas.height = W * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduced =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let raf = 0;
    const cx = W / 2;
    const cy = W / 2;
    // Arc geometry — StarIcon's treatment scaled up: thin relative stroke.
    const arcR = size * 0.44;
    const lw = Math.max(3, size * 0.035);

    const draw = (now: number) => {
      const t = now / 1000;
      const p = Math.max(0, Math.min(1, progRef.current));
      ctx.clearRect(0, 0, W, W);

      // gentle breath on the ambient glow (static when reduced)
      const breathe = reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 1.2);

      // 1 — soft ambient gold glow behind everything
      const ambient = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, W * 0.52);
      ambient.addColorStop(0, `rgba(251,146,60,${0.16 * breathe})`);
      ambient.addColorStop(0.55, `rgba(251,146,60,${0.07 * breathe})`);
      ambient.addColorStop(1, 'rgba(251,146,60,0)');
      ctx.fillStyle = ambient;
      ctx.fillRect(0, 0, W, W);

      // 2 — dark clearing the organism sits in (seats the blob on any bg)
      const clearing = ctx.createRadialGradient(cx, cy, 0, cx, cy, arcR * 0.96);
      clearing.addColorStop(0, 'rgba(15,20,35,0.62)');
      clearing.addColorStop(0.7, 'rgba(15,20,35,0.45)');
      clearing.addColorStop(1, 'rgba(15,20,35,0)');
      ctx.fillStyle = clearing;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR * 0.96, 0, Math.PI * 2);
      ctx.fill();

      // 3 — thin track at low alpha (StarIcon's '2E')
      ctx.lineCap = 'round';
      ctx.lineWidth = lw;
      ctx.strokeStyle = GOLD + '2E';
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, 0, Math.PI * 2);
      ctx.stroke();

      // 4 — progress fill + bright end-dot marker
      if (p > 0.01) {
        const a0 = -Math.PI / 2;
        const a1 = a0 + Math.PI * 2 * p;

        // soft under-glow of the fill itself
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = lw + size * 0.03;
        ctx.strokeStyle = GOLD;
        (ctx as any).filter = `blur(${Math.max(3, size * 0.03)}px)`;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, a0, a1);
        ctx.stroke();
        ctx.restore();
        (ctx as any).filter = 'none';

        ctx.lineWidth = lw;
        ctx.strokeStyle = GOLD;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, a0, a1);
        ctx.stroke();

        // bright end-dot: gold bloom + white-hot core
        const ex = cx + Math.cos(a1) * arcR;
        const ey = cy + Math.sin(a1) * arcR;
        const bloomR = lw * 2.6;
        const bloom = ctx.createRadialGradient(ex, ey, 0, ex, ey, bloomR);
        bloom.addColorStop(0, GOLD + 'FF');
        bloom.addColorStop(0.45, GOLD + '88');
        bloom.addColorStop(1, GOLD + '00');
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(ex, ey, bloomR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(ex, ey, lw * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // `progress` in deps so reduced-motion users still get a fresh static
    // frame when the ring advances (the rAF loop tracks it via progRef).
  }, [size, W, progress]);

  const blobSize = Math.round(size * 0.34);
  const celebrating = state === 'completed' || progress >= 1;

  return (
    <View style={{ width: size, height: size, overflow: 'visible' } as any}>
      <canvas
        ref={canvasRef}
        style={{ width: W, height: W, marginLeft: -PAD, marginTop: -PAD, pointerEvents: 'none' } as any}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        <GuruBlob size={blobSize} state={celebrating ? 'celebrate' : 'idle'} />
      </View>
    </View>
  );
}

function RecapHeroSvg({ size, progress, state }: Required<RecapHeroProps>) {
  const arcR = size * 0.44;
  const lw = Math.max(3, size * 0.035);
  const p = Math.max(0, Math.min(1, progress));
  const circumference = 2 * Math.PI * arcR;
  const endAngle = -Math.PI / 2 + Math.PI * 2 * p;
  const cx = size / 2;
  const cy = size / 2;
  const blobSize = Math.round(size * 0.34);
  const celebrating = state === 'completed' || p >= 1;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* dark clearing */}
        <Circle cx={cx} cy={cy} r={arcR * 0.9} fill="rgba(15,20,35,0.5)" />
        {/* thin low-alpha track */}
        <Circle cx={cx} cy={cy} r={arcR} stroke="rgba(251,146,60,0.18)" strokeWidth={lw} fill="none" />
        {/* progress fill */}
        {p > 0.01 && (
          <Circle
            cx={cx}
            cy={cy}
            r={arcR}
            stroke={GOLD}
            strokeWidth={lw}
            fill="none"
            strokeDasharray={`${circumference * p} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
        {/* bright end-dot marker */}
        {p > 0.01 && (
          <>
            <Circle
              cx={cx + Math.cos(endAngle) * arcR}
              cy={cy + Math.sin(endAngle) * arcR}
              r={lw * 1.6}
              fill="rgba(251,146,60,0.45)"
            />
            <Circle
              cx={cx + Math.cos(endAngle) * arcR}
              cy={cy + Math.sin(endAngle) * arcR}
              r={lw * 0.6}
              fill="rgba(255,255,255,0.95)"
            />
          </>
        )}
      </Svg>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        <GuruBlob size={blobSize} state={celebrating ? 'celebrate' : 'idle'} />
      </View>
    </View>
  );
}

export default function RecapHero({ size = 240, progress, state = 'not_started' }: RecapHeroProps) {
  if (Platform.OS === 'web') {
    return <RecapHeroCanvas size={size} progress={progress} state={state} />;
  }
  return <RecapHeroSvg size={size} progress={progress} state={state} />;
}
