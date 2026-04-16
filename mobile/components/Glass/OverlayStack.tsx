/**
 * OverlayStack — context provider that tracks how many glass overlays are
 * currently stacked, so each child can auto-bump its material tier and the
 * base surface dims after 3 stacks.
 *
 * Topic-1 rule:
 *   Each stacked layer auto-bumps to the next tier above its parent
 *   (thin → regular → thick → chrome). After 3 stacks, the base auto-dims
 *   12% to preserve legibility.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { GlassTier } from '../../constants/liquidGlass';

const TIER_ORDER: GlassTier[] = ['ultraThin', 'thin', 'regular', 'thick', 'chrome'];

interface StackContext {
  /** Stack depth. 0 = no overlays on top. */
  depth: number;
  /** Given a desired tier, return the tier bumped by current depth. */
  resolveTier: (preferred: GlassTier) => GlassTier;
  /** Whether the BASE content should be auto-dimmed (depth ≥ 3). */
  baseDimmed: boolean;
}

const Ctx = createContext<StackContext>({
  depth: 0,
  resolveTier: (p) => p,
  baseDimmed: false,
});

export function OverlayStackProvider({
  depth,
  children,
}: {
  depth: number;
  children: React.ReactNode;
}) {
  const value = useMemo<StackContext>(() => {
    const resolveTier = (preferred: GlassTier): GlassTier => {
      const idx = TIER_ORDER.indexOf(preferred);
      const bumped = Math.min(TIER_ORDER.length - 1, idx + Math.max(0, depth - 1));
      return TIER_ORDER[bumped];
    };
    return {
      depth,
      resolveTier,
      baseDimmed: depth >= 3,
    };
  }, [depth]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOverlayStack() {
  return useContext(Ctx);
}
