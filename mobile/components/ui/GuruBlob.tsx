import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

export type BlobState = 'idle' | 'thinking' | 'celebrate';

interface Props {
  size?: number;
  state?: BlobState;
}

/**
 * GuruBlob v2 — the living logo (Epic H / GUR-228).
 *
 * Brand DNA: the triskelion's three rings (sky #38BDF8 / pink #EC4899 /
 * orange #FB923C) melted into ONE living organism — three plasma cores slowly
 * orbiting inside an organic morphing blob on a deep-indigo base. The static
 * logo is the three rings; the agent is those rings fused alive.
 *
 * Blending: a soft ambient halo + a blurred under-glow pass feather the blob
 * into dark backgrounds (no hard "sticker" edge). States: idle (slow breathe,
 * lazy orbit) / thinking (fast morph + orbit, brighter cores) / celebrate
 * (single 1.25× pulse). Honors prefers-reduced-motion (one static frame).
 */
export default function GuruBlob({ size = 28, state = 'idle' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<BlobState>(state);
  stateRef.current = state;

  const PAD = Math.ceil(size * 0.55); // room for halo + morph
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

    const CORES = [
      { hex: '#38BDF8', phase: 0 },                  // catch-up sky
      { hex: '#EC4899', phase: (Math.PI * 2) / 3 },  // dive-in pink
      { hex: '#FB923C', phase: (Math.PI * 4) / 3 },  // recap orange
    ];

    const blobPath = (cx: number, cy: number, R: number, t: number, amp: number, speed: number) => {
      ctx.beginPath();
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const w =
          amp * Math.sin(3 * th + t * 1.5 * speed) +
          amp * 0.55 * Math.sin(5 * th - t * 2.1 * speed) +
          amp * 0.3 * Math.sin(8 * th + t * 2.9 * speed);
        const r = R * (1 + w);
        const x = cx + r * Math.cos(th);
        const y = cy + r * Math.sin(th);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = (now: number) => {
      const t = now / 1000;
      const st = stateRef.current;
      if (st === 'celebrate' && prevState !== 'celebrate') celebrateT0 = now;
      prevState = st;

      const speed = st === 'thinking' ? 3.0 : 1.0;
      const amp = reduced ? 0.04 : st === 'thinking' ? 0.13 : 0.075;
      const orbit = t * (st === 'thinking' ? 1.6 : 0.45);

      let scale = 1 + (reduced ? 0 : st === 'thinking' ? 0.02 * Math.sin(t * 6) : 0.045 * Math.sin((t * 2 * Math.PI) / 3));
      if (celebrateT0 >= 0) {
        const dt = (now - celebrateT0) / 650;
        if (dt < 1) scale *= 1 + 0.25 * Math.sin(Math.PI * dt);
        else celebrateT0 = -1;
      }

      ctx.clearRect(0, 0, W, W);
      const cx = W / 2;
      const cy = W / 2;
      const R = (size / 2) * 0.88 * scale;

      // 1) Ambient halo — eases the blob into the dark, no hard cutoff.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.1);
      halo.addColorStop(0, 'rgba(99,102,241,0.20)');
      halo.addColorStop(0.55, 'rgba(99,102,241,0.07)');
      halo.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, W);

      // 2) Blurred under-glow of the blob shape — feathers the silhouette.
      ctx.save();
      (ctx as any).filter = `blur(${Math.max(2, size * 0.07)}px)`;
      blobPath(cx, cy, R * 1.02, t, amp, speed);
      ctx.fillStyle = 'rgba(79,70,229,0.55)';
      ctx.fill();
      ctx.restore();
      (ctx as any).filter = 'none';

      // 3) The blob body — deep indigo base, slightly translucent at the rim.
      blobPath(cx, cy, R, t, amp, speed);
      const base = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.15);
      base.addColorStop(0, '#4F46E5');
      base.addColorStop(0.75, '#3B3690');
      base.addColorStop(1, 'rgba(35,32,90,0.85)');
      ctx.fillStyle = base;
      ctx.fill();

      // 4) The three ring-colors as plasma cores orbiting inside (clipped).
      ctx.save();
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const coreAlpha = st === 'thinking' ? 0.5 : 0.38;
      for (const c of CORES) {
        const a = orbit + c.phase;
        const ox = cx + Math.cos(a) * R * 0.42;
        const oy = cy + Math.sin(a) * R * 0.42;
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 0.85);
        const n = parseInt(c.hex.slice(1), 16);
        const rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
        g.addColorStop(0, `rgba(${rr},${gg},${bb},${coreAlpha})`);
        g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      }
      ctx.restore();

      // 5) Small specular — life in the eye, kept subtle.
      ctx.beginPath();
      ctx.ellipse(cx - R * 0.3, cy - R * 0.36, R * 0.2, R * 0.12, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fill();

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, W]);

  if (Platform.OS !== 'web') {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#4F46E5' }} />;
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
