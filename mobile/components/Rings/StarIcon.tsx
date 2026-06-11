import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

/**
 * Tab-bar iconography for the constellation identity (GUR-228 identity final).
 * StarIcon: a glowing pillar star wearing its thin progress arc — the per-tab
 * sibling of the Home hero's stars. ConstellationIcon: the three stars joined
 * by faint synapses, for the Home tab.
 */

export function StarIcon({ color, progress, size = 24 }: { color: string; progress: number; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progRef = useRef(progress);
  progRef.current = progress;

  const PAD = Math.ceil(size * 0.3);
  const W = size + PAD * 2;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
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
    const cx = W / 2, cy = W / 2;

    const draw = (now: number) => {
      const t = now / 1000;
      const p = Math.max(0, Math.min(1, progRef.current));
      ctx.clearRect(0, 0, W, W);
      const tw = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 1.6);
      const starR = size * 0.16;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 3);
      glow.addColorStop(0, color + 'FF');
      glow.addColorStop(0.35, color + Math.round(tw * 110).toString(16).padStart(2, '0'));
      glow.addColorStop(1, color + '00');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, starR * 3, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.8 * tw})`;
      ctx.beginPath(); ctx.arc(cx, cy, starR * 0.55, 0, 7); ctx.fill();
      const arcR = size * 0.42;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.6, size * 0.085);
      ctx.strokeStyle = color + '2E';
      ctx.beginPath(); ctx.arc(cx, cy, arcR, 0, Math.PI * 2); ctx.stroke();
      if (p > 0.01) {
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.arc(cx, cy, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, color, W]);

  if (Platform.OS !== 'web') {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
  return (
    <View style={{ width: size, height: size, overflow: 'visible' } as any}>
      <canvas ref={canvasRef} style={{ width: W, height: W, marginLeft: -PAD, marginTop: -PAD, pointerEvents: 'none' } as any} />
    </View>
  );
}

export function ConstellationIcon({ size = 24 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const PAD = Math.ceil(size * 0.25);
  const W = size + PAD * 2;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
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
    const cx = W / 2, cy = W / 2;
    const COLS = ['#38BDF8', '#EC4899', '#FB923C'];
    const R = size * 0.36;

    const draw = (now: number) => {
      const t = now / 1000;
      ctx.clearRect(0, 0, W, W);
      const pts = [0, 1, 2].map(k => {
        const a = -Math.PI / 2 + k * ((Math.PI * 2) / 3);
        return [cx + Math.cos(a) * R, cy + Math.sin(a) * R] as const;
      });
      ctx.strokeStyle = 'rgba(165,180,252,0.35)';
      ctx.lineWidth = Math.max(0.8, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]); ctx.closePath(); ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const tw = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 1.4 + k * 2.1);
        const sr = size * 0.12;
        const g = ctx.createRadialGradient(pts[k][0], pts[k][1], 0, pts[k][0], pts[k][1], sr * 2.4);
        g.addColorStop(0, COLS[k] + 'FF');
        g.addColorStop(0.4, COLS[k] + Math.round(tw * 130).toString(16).padStart(2, '0'));
        g.addColorStop(1, COLS[k] + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(pts[k][0], pts[k][1], sr * 2.4, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.75 * tw})`;
        ctx.beginPath(); ctx.arc(pts[k][0], pts[k][1], sr * 0.45, 0, 7); ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, W]);

  if (Platform.OS !== 'web') {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#6366F1' }} />;
  }
  return (
    <View style={{ width: size, height: size, overflow: 'visible' } as any}>
      <canvas ref={canvasRef} style={{ width: W, height: W, marginLeft: -PAD, marginTop: -PAD, pointerEvents: 'none' } as any} />
    </View>
  );
}
