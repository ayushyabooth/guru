import React, { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

export type BlobState = 'idle' | 'thinking' | 'celebrate';

interface Props {
  size?: number;
  state?: BlobState;
}

/**
 * GuruBlob v3 — "Fusion goo" (final identity, founder-approved Round 6).
 *
 * A metaball organism: four invisible bodies drift on lissajous paths and the
 * rendered silhouette is the level-set of their summed field — so lobes fuse,
 * stretch, nearly split and snap back like alien protoplasm. The triskelion's
 * three ring colors live inside as plasma cores (the brand's three pillars).
 *
 * States: idle (slow drift, compact) · thinking (fast, wide — the organism
 * pulls toward division; cores gather centrally to "concentrate") · celebrate
 * (single 1.25× pulse). Ambient halo + blurred under-glow feather it into
 * dark backgrounds. Honors prefers-reduced-motion (one static frame).
 */
export default function GuruBlob({ size = 28, state = 'idle' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<BlobState>(state);
  stateRef.current = state;

  const PAD = Math.ceil(size * 0.6); // goo lobes + halo need generous margin
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

    const COLS = ['#38BDF8', '#EC4899', '#FB923C'];
    const sc = size / 100;                 // base geometry authored at ~100px
    const N = size >= 80 ? 88 : size >= 40 ? 64 : 44; // silhouette resolution
    const STEPS = size >= 40 ? 16 : 12;    // binary-search depth per ray

    let raf = 0;
    let celebrateT0 = -1;
    let prevState: BlobState = stateRef.current;

    const draw = (now: number) => {
      const t = now / 1000;
      const st = stateRef.current;
      if (st === 'celebrate' && prevState !== 'celebrate') celebrateT0 = now;
      prevState = st;
      const th = st === 'thinking';

      let pulse = 1;
      if (celebrateT0 >= 0) {
        const dt = (now - celebrateT0) / 650;
        if (dt < 1) pulse = 1 + 0.25 * Math.sin(Math.PI * dt);
        else celebrateT0 = -1;
      }

      const cx0 = W / 2;
      const cy0 = W / 2;
      const sp = reduced ? 0.001 : th ? 2.0 : 0.8;
      const spread = (th ? 17 : 9) * sc * pulse;

      const balls = [
        [cx0 + Math.cos(t * 0.9 * sp) * spread, cy0 + Math.sin(t * 0.7 * sp) * spread * 0.8, 15 * sc * pulse],
        [cx0 + Math.cos(t * 0.6 * sp + 2.1) * spread * 1.15, cy0 + Math.sin(t * 1.1 * sp + 1.2) * spread, 12 * sc * pulse],
        [cx0 + Math.cos(t * 1.3 * sp + 4.2) * spread * 0.9, cy0 + Math.sin(t * 0.5 * sp + 3.3) * spread * 1.1, 10.5 * sc * pulse],
        [cx0 + Math.cos(t * 0.45 * sp + 1.0) * spread * 1.3, cy0 + Math.sin(t * 0.85 * sp + 4.8) * spread * 0.7, 8.5 * sc * pulse],
      ];
      const field = (x: number, y: number) => {
        let f = 0;
        for (let b = 0; b < 4; b++) {
          const dx = x - balls[b][0];
          const dy = y - balls[b][1];
          f += (balls[b][2] * balls[b][2]) / (dx * dx + dy * dy + 1);
        }
        return f;
      };
      // weighted centroid = ray origin (keeps the silhouette star-convex enough)
      let mx = 0, my = 0, tw = 0;
      for (let b = 0; b < 4; b++) { mx += balls[b][0] * balls[b][2]; my += balls[b][1] * balls[b][2]; tw += balls[b][2]; }
      mx /= tw; my /= tw;

      const tracePath = (scale: number) => {
        ctx.beginPath();
        const hiMax = W * 0.48;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          let lo = 1, hi = hiMax;
          for (let s = 0; s < STEPS; s++) {
            const mid = (lo + hi) / 2;
            if (field(mx + Math.cos(a) * mid, my + Math.sin(a) * mid) > 1.35) lo = mid;
            else hi = mid;
          }
          const r = lo * scale;
          const x = mx + r * Math.cos(a);
          const y = my + r * Math.sin(a);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };

      ctx.clearRect(0, 0, W, W);

      // ambient halo — feathers the organism into dark backgrounds
      const halo = ctx.createRadialGradient(mx, my, size * 0.18, mx, my, W * 0.55);
      halo.addColorStop(0, `rgba(99,102,241,${th ? 0.18 : 0.13})`);
      halo.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, W);

      // blurred under-glow of the silhouette (skip at tiny sizes for perf)
      if (size >= 26) {
        ctx.save();
        (ctx as any).filter = `blur(${Math.max(2, size * 0.06)}px)`;
        tracePath(1.05);
        ctx.fillStyle = 'rgba(79,70,229,0.5)';
        ctx.fill();
        ctx.restore();
        (ctx as any).filter = 'none';
      }

      // the body
      tracePath(1);
      const body = ctx.createRadialGradient(mx - 7 * sc, my - 8 * sc, 2, mx, my, 42 * sc);
      body.addColorStop(0, 'rgba(129,140,248,0.46)');
      body.addColorStop(0.6, 'rgba(67,56,202,0.42)');
      body.addColorStop(1, 'rgba(30,27,75,0.44)');
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = 'rgba(165,180,252,0.5)';
      ctx.lineWidth = Math.max(0.8, 1.4 * sc);
      ctx.stroke();

      // the three pillar-cores, clipped inside; they gather when thinking
      ctx.save();
      tracePath(1);
      ctx.clip();
      const gather = th ? 0.3 : 0.9;
      for (let k = 0; k < 3; k++) {
        const ox = mx + Math.cos(t * (th ? 1.6 : 0.5) + k * 2.09) * 13 * sc * gather;
        const oy = my + Math.sin(t * (th ? 1.3 : 0.42) + k * 2.7) * 12 * sc * gather;
        const rr = (th ? 10 : 8) * sc;
        const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
        og.addColorStop(0, COLS[k] + (th ? 'EE' : 'BB'));
        og.addColorStop(1, COLS[k] + '00');
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(ox, oy, rr, 0, 7);
        ctx.fill();
      }
      ctx.restore();

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
