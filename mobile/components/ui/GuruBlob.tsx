import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

export type BlobState = 'idle' | 'thinking' | 'celebrate';

interface Props {
  size?: number;
  state?: BlobState;
}

/**
 * GuruBlob — the living logo (Epic H / GUR-228, Figma "Living Blob — states spec").
 *
 * An organic plasma blob that looks alive: radius(θ) = R · (1 + Σ sin(kθ + φt)·a)
 * over 3 octaves, filled with the brand sky→indigo→pink radial. States:
 *  - idle:      slow 3s breathe, gentle ±8% morph
 *  - thinking:  fast agitation, deeper morph, indigo brightens
 *  - celebrate: a single 1.25× pulse, then settles back to idle motion
 * Honors prefers-reduced-motion (renders one static frame). Canvas is padded
 * 25% so the morph never clips; the View keeps the layout footprint at `size`.
 */
export default function GuruBlob({ size = 28, state = 'idle' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<BlobState>(state);
  stateRef.current = state;

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
    let celebrateT0 = -1;
    let prevState: BlobState = stateRef.current;

    const draw = (now: number) => {
      const t = now / 1000;
      const st = stateRef.current;
      if (st === 'celebrate' && prevState !== 'celebrate') celebrateT0 = now;
      prevState = st;

      const speed = st === 'thinking' ? 3.2 : 1.0;
      const amp = reduced ? 0 : st === 'thinking' ? 0.15 : 0.08;

      let scale = 1 + (st === 'thinking' ? 0.02 * Math.sin(t * 6) : 0.05 * Math.sin((t * 2 * Math.PI) / 3));
      if (celebrateT0 >= 0) {
        const dt = (now - celebrateT0) / 650;
        if (dt < 1) scale *= 1 + 0.25 * Math.sin(Math.PI * dt);
        else celebrateT0 = -1;
      }

      ctx.clearRect(0, 0, W, W);
      const cx = W / 2;
      const cy = W / 2;
      const R = (size / 2) * 0.9 * scale;

      ctx.beginPath();
      const N = 60;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const w =
          amp * Math.sin(3 * th + t * 1.7 * speed) +
          amp * 0.6 * Math.sin(5 * th - t * 2.3 * speed) +
          amp * 0.35 * Math.sin(8 * th + t * 3.1 * speed);
        const r = R * (1 + w);
        const x = cx + r * Math.cos(th);
        const y = cy + r * Math.sin(th);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const mid = st === 'thinking' ? '#818CF8' : '#6366F1';
      const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.3);
      g.addColorStop(0, '#7DD3FC');
      g.addColorStop(0.55, mid);
      g.addColorStop(1, 'rgba(236,72,153,0.92)');
      ctx.fillStyle = g;
      ctx.fill();

      // specular highlight — the "wet glass" life in the eye
      ctx.beginPath();
      ctx.ellipse(cx - R * 0.32, cy - R * 0.38, R * 0.26, R * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, W]);

  if (Platform.OS !== 'web') {
    // Native fallback: static brand dot (web is the deployed target).
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#6366F1' }} />;
  }

  return (
    <View style={{ width: size, height: size, overflow: 'visible' } as any}>
      <canvas
        ref={canvasRef}
        style={{ width: W, height: W, marginLeft: -PAD, marginTop: -PAD, pointerEvents: 'none' } as any}
      />
    </View>
  );
}
