import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { panelVisible } from '../state';
import { SNAP_HEIGHTS } from '../../shared/constants';

interface GuruFABProps {
  count: number;
  visible: boolean;
  onClick: () => void;
}

/**
 * The FAB carries the Guru organism (identity final, GUR-228 R8): the same
 * fusion-goo metaball creature as the app — 4 lissajous bodies, silhouette
 * ray-marched from the summed-field level-set, tri-color pillar cores inside.
 * Honors prefers-reduced-motion (static frame).
 */
function GooCanvas({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const PAD = Math.ceil(size * 0.4);
    const W = size + PAD * 2;
    canvas.width = W * dpr;
    canvas.height = W * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${W}px`;
    canvas.style.margin = `-${PAD}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const COLS = ['#38BDF8', '#EC4899', '#FB923C'];
    const sc = size / 100;
    let raf = 0;

    const draw = (now: number) => {
      const t = now / 1000;
      const cx = W / 2, cy = W / 2;
      const sp = reduced ? 0.001 : 0.8;
      const spread = 9 * sc;
      const balls = [
        [cx + Math.cos(t * 0.9 * sp) * spread, cy + Math.sin(t * 0.7 * sp) * spread * 0.8, 15 * sc],
        [cx + Math.cos(t * 0.6 * sp + 2.1) * spread * 1.15, cy + Math.sin(t * 1.1 * sp + 1.2) * spread, 12 * sc],
        [cx + Math.cos(t * 1.3 * sp + 4.2) * spread * 0.9, cy + Math.sin(t * 0.5 * sp + 3.3) * spread * 1.1, 10.5 * sc],
        [cx + Math.cos(t * 0.45 * sp + 1.0) * spread * 1.3, cy + Math.sin(t * 0.85 * sp + 4.8) * spread * 0.7, 8.5 * sc],
      ];
      const field = (x: number, y: number) => {
        let f = 0;
        for (let b = 0; b < 4; b++) {
          const dx = x - balls[b][0], dy = y - balls[b][1];
          f += (balls[b][2] * balls[b][2]) / (dx * dx + dy * dy + 1);
        }
        return f;
      };
      let mx = 0, my = 0, tw = 0;
      for (let b = 0; b < 4; b++) { mx += balls[b][0] * balls[b][2]; my += balls[b][1] * balls[b][2]; tw += balls[b][2]; }
      mx /= tw; my /= tw;
      const trace = () => {
        ctx.beginPath();
        for (let i = 0; i <= 44; i++) {
          const a = (i / 44) * Math.PI * 2;
          let lo = 1, hi = W * 0.48;
          for (let s = 0; s < 12; s++) {
            const mid = (lo + hi) / 2;
            if (field(mx + Math.cos(a) * mid, my + Math.sin(a) * mid) > 1.35) lo = mid; else hi = mid;
          }
          const x = mx + lo * Math.cos(a), y = my + lo * Math.sin(a);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      ctx.clearRect(0, 0, W, W);
      trace();
      const body = ctx.createRadialGradient(mx - 7 * sc, my - 8 * sc, 2, mx, my, 42 * sc);
      body.addColorStop(0, 'rgba(129,140,248,0.55)');
      body.addColorStop(0.6, 'rgba(67,56,202,0.5)');
      body.addColorStop(1, 'rgba(30,27,75,0.52)');
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = 'rgba(165,180,252,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      trace();
      ctx.clip();
      for (let k = 0; k < 3; k++) {
        const ox = mx + Math.cos(t * 0.5 + k * 2.09) * 12 * sc;
        const oy = my + Math.sin(t * 0.42 + k * 2.7) * 11 * sc;
        const rr = 9 * sc;
        const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
        og.addColorStop(0, COLS[k] + 'CC');
        og.addColorStop(1, COLS[k] + '00');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(ox, oy, rr, 0, 7); ctx.fill();
      }
      ctx.restore();
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ pointerEvents: 'none' }} />;
}

export default function GuruFAB({ count, visible, onClick }: GuruFABProps) {
  if (!visible) return null;

  // Move FAB above the panel when it's open
  const isPanelOpen = panelVisible.value;
  const bottomPx = isPanelOpen
    ? SNAP_HEIGHTS.default * window.innerHeight + 16
    : 32;

  return (
    <button
      class="guru-fab guru-interactive"
      onClick={onClick}
      title={isPanelOpen ? 'Close Guru panel' : 'Open Guru insights'}
      style={{ bottom: `${bottomPx}px` }}
    >
      {/* The living organism IS the brand mark (GUR-228 identity final R8) */}
      <GooCanvas size={34} />
      {count > 0 && <span class="guru-fab-badge">{count}</span>}
    </button>
  );
}
