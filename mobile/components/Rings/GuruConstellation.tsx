import React, { useEffect, useRef } from 'react';
import { Platform, View, Pressable } from 'react-native';
import GuruBlob from '../ui/GuruBlob';

interface Progress { c: number; d: number; r: number; }

interface Props {
  size?: number;
  progress: Progress;
  /** Tap a star to open its pillar; tap the center nucleus to open the agent. */
  onStarPress?: (section: 'catchup' | 'divein' | 'recap') => void;
  onCenterPress?: () => void;
}

/**
 * GuruConstellation — the Home hero (final identity, founder-approved R6:
 * "goo agent + constellation Home"). The three pillars are stars in a
 * breathing nebula, joined by firing synapses — learning as connecting the
 * dots. Each star wears a thin progress arc (the old rings' DNA), and the
 * fusion-goo agent sits at the center as the nucleus feeding the network.
 * Honors prefers-reduced-motion (static frame).
 */
export default function GuruConstellation({ size = 240, progress, onStarPress, onCenterPress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progRef = useRef<Progress>(progress);
  progRef.current = progress;

  const PAD = Math.ceil(size * 0.18);
  const W = size + PAD * 2;

  // Fixed star anchor angles (slow orbit around them), matching pillar order.
  const COLS = ['#38BDF8', '#EC4899', '#FB923C'];
  const KEYS: Array<'catchup' | 'divein' | 'recap'> = ['catchup', 'divein', 'recap'];

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
    const cx = W / 2;
    const cy = W / 2;
    const ORBIT = size * 0.33;

    const starPos = (k: number, t: number) => {
      const a = -Math.PI / 2 + k * ((Math.PI * 2) / 3) + (reduced ? 0 : Math.sin(t * 0.25 + k) * 0.07);
      const wob = reduced ? 0 : Math.sin(t * 0.4 + k * 2) * size * 0.012;
      return [cx + Math.cos(a) * (ORBIT + wob), cy + Math.sin(a) * (ORBIT + wob)] as const;
    };

    const draw = (now: number) => {
      const t = now / 1000;
      const p = [
        Math.max(0, Math.min(1, progRef.current.c)),
        Math.max(0, Math.min(1, progRef.current.d)),
        Math.max(0, Math.min(1, progRef.current.r)),
      ];
      ctx.clearRect(0, 0, W, W);

      // breathing nebula
      for (let n = 0; n < 3; n++) {
        const nx = cx + Math.cos(t * 0.18 + n * 2.1) * size * 0.05;
        const ny = cy + Math.sin(t * 0.14 + n * 2.1) * size * 0.045;
        const neb = ctx.createRadialGradient(nx, ny, 0, nx, ny, size * 0.52);
        neb.addColorStop(0, 'rgba(79,70,229,0.16)');
        neb.addColorStop(1, 'rgba(79,70,229,0)');
        ctx.fillStyle = neb;
        ctx.fillRect(0, 0, W, W);
      }

      const pts = [0, 1, 2].map(k => starPos(k, t));

      // synapses: star↔star + star↔nucleus, with traveling firing dots
      ctx.lineWidth = Math.max(1, size * 0.005);
      for (let i = 0; i < 3; i++) {
        const a = pts[i], b = pts[(i + 1) % 3];
        ctx.strokeStyle = 'rgba(165,180,252,0.22)';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(165,180,252,0.14)';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(cx, cy); ctx.stroke();
        if (!reduced) {
          const f = (t * 0.45 + i * 0.33) % 1;
          const fx = a[0] + (b[0] - a[0]) * f;
          const fy = a[1] + (b[1] - a[1]) * f;
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          ctx.beginPath(); ctx.arc(fx, fy, Math.max(1.2, size * 0.008), 0, 7); ctx.fill();
          const g = (t * 0.3 + i * 0.45) % 1;
          ctx.fillStyle = 'rgba(199,210,254,0.5)';
          ctx.beginPath(); ctx.arc(a[0] + (cx - a[0]) * g, a[1] + (cy - a[1]) * g, Math.max(1, size * 0.006), 0, 7); ctx.fill();
        }
      }

      // stars + progress arcs
      for (let k = 0; k < 3; k++) {
        const [sx, sy] = pts[k];
        const starR = size * (0.055 + 0.02 * p[k]);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, starR * 3.2);
        glow.addColorStop(0, COLS[k] + 'FF');
        glow.addColorStop(0.3, COLS[k] + '77');
        glow.addColorStop(1, COLS[k] + '00');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(sx, sy, starR * 3.2, 0, 7); ctx.fill();
        // progress arc — the rings' DNA, worn by each star
        const arcR = starR * 4.1;
        ctx.lineCap = 'round';
        ctx.strokeStyle = COLS[k] + '30';
        ctx.lineWidth = Math.max(2, size * 0.013);
        ctx.beginPath(); ctx.arc(sx, sy, arcR, 0, Math.PI * 2); ctx.stroke();
        if (p[k] > 0.005) {
          ctx.strokeStyle = COLS[k];
          ctx.beginPath(); ctx.arc(sx, sy, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p[k]); ctx.stroke();
        }
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, W]);

  // Tap routing: nearest star zone (top / bottom-right / bottom-left), or center.
  const handlePress = (e: any) => {
    const { locationX = 0, locationY = 0 } = e?.nativeEvent ?? {};
    const fx = locationX / size - 0.5;
    const fy = locationY / size - 0.5;
    const dist = Math.sqrt(fx * fx + fy * fy);
    if (dist < 0.18) { onCenterPress?.(); return; }
    if (!onStarPress) return;
    // star anchors: catchup top, divein lower-right, recap lower-left
    if (fy < -0.08) onStarPress('catchup');
    else if (fx >= 0) onStarPress('divein');
    else onStarPress('recap');
  };

  if (Platform.OS !== 'web') {
    return <View style={{ width: size, height: size }} />;
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Learning constellation — tap a star to open its section, tap the center to open Guru"
      style={{ width: size, height: size, overflow: 'visible', alignItems: 'center', justifyContent: 'center' } as any}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: -PAD, top: -PAD, width: W, height: W, pointerEvents: 'none' } as any}
      />
      {/* the agent nucleus — the goo lives at the heart of the network */}
      <View pointerEvents="none">
        <GuruBlob size={Math.round(size * 0.21)} state="idle" />
      </View>
    </Pressable>
  );
}
