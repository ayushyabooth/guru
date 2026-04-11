/**
 * OrganicBackground - Immersive 3D liquid glass blob backgrounds
 *
 * Creates flowing, organic 3D-looking glass blob shapes matching the design mockups.
 * Uses multiple overlapping layers with different opacities to create depth.
 * Each blob has: base layer, mid layer, highlight layer, and edge glow.
 */

import React from 'react';
import { View, StyleSheet, Dimensions, Platform, Image } from 'react-native';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  G,
  Filter,
  FeGaussianBlur,
  Ellipse,
} from 'react-native-svg';
import { getPalette } from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import MatrixBackground from './MatrixBackground';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Extended variant type: original light variants + dark-specific variants
type OrganicVariant = 'login' | 'onboarding' | 'home' | 'minimal' | 'catchup' | 'divein' | 'recap' | 'auth';

// Map OrganicBackground variants → MatrixBackground variants
const DARK_VARIANT_MAP: Record<OrganicVariant, 'home' | 'catchup' | 'divein' | 'recap' | 'auth'> = {
  login: 'auth',
  onboarding: 'auth',
  home: 'home',
  minimal: 'home',
  catchup: 'catchup',
  divein: 'divein',
  recap: 'recap',
  auth: 'auth',
};

interface OrganicBackgroundProps {
  filterContext?: string;
  variant?: OrganicVariant;
}

// Organic flowing blob paths - more complex curves for natural look
const BLOBS = {
  // Large flowing teal blob - top-left sweeping right
  tealMain: 'M-120,-80 Q-60,-150 60,-130 Q180,-110 240,-40 Q300,30 280,120 Q260,210 160,260 Q60,310 -40,260 Q-140,210 -180,120 Q-220,30 -180,-40 Q-140,-110 -120,-80 Z',

  // Purple blob - right side
  purpleMain: 'M40,-100 Q140,-160 240,-120 Q340,-80 380,20 Q420,120 380,220 Q340,320 240,340 Q140,360 60,300 Q-20,240 -40,140 Q-60,40 0,-40 Q60,-100 40,-100 Z',

  // Amber/gold blob - bottom
  amberMain: 'M-60,-40 Q60,-100 180,-60 Q300,-20 340,80 Q380,180 320,260 Q260,340 140,360 Q20,380 -80,320 Q-180,260 -200,160 Q-220,60 -140,0 Q-60,-60 -60,-40 Z',

  // Secondary teal - bottom left
  tealSecondary: 'M-40,-60 Q40,-100 120,-80 Q200,-60 240,20 Q280,100 240,180 Q200,260 100,280 Q0,300 -80,240 Q-160,180 -160,100 Q-160,20 -100,-20 Q-40,-60 -40,-60 Z',

  // Small accent shapes
  accent1: 'M0,-50 Q50,-70 80,-40 Q110,-10 90,40 Q70,90 20,100 Q-30,110 -60,70 Q-90,30 -70,-10 Q-50,-50 0,-50 Z',
};

// Create a single blob with multiple depth layers for true 3D glass effect
const GlassBlob = ({
  path,
  baseColor,
  size,
  position,
  rotation = 0,
  opacity = 1,
  id
}: {
  path: string;
  baseColor: { light: string; mid: string; dark: string; highlight: string; rim?: string };
  size: number;
  position: { top?: number | string; left?: number | string; right?: number | string; bottom?: number | string };
  rotation?: number;
  opacity?: number;
  id: string;
}) => {
  const rimColor = baseColor.rim || baseColor.light;

  return (
    <View style={[styles.blobContainer, position, { opacity }]}>
      <Svg width={size} height={size} viewBox="-250 -250 500 500">
        <Defs>
          {/* Primary 3D sphere gradient - creates main volume */}
          <RadialGradient id={`${id}MainGrad`} cx="30%" cy="25%" r="75%" fx="20%" fy="15%">
            <Stop offset="0%" stopColor={baseColor.highlight} stopOpacity={1} />
            <Stop offset="15%" stopColor={baseColor.light} stopOpacity={0.95} />
            <Stop offset="40%" stopColor={baseColor.mid} stopOpacity={0.85} />
            <Stop offset="70%" stopColor={baseColor.dark} stopOpacity={0.7} />
            <Stop offset="100%" stopColor={baseColor.dark} stopOpacity={0.4} />
          </RadialGradient>

          {/* Specular highlight - bright white spot */}
          <RadialGradient id={`${id}Specular`} cx="25%" cy="20%" r="35%" fx="15%" fy="10%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.95} />
            <Stop offset="30%" stopColor="#FFFFFF" stopOpacity={0.7} />
            <Stop offset="60%" stopColor="#FFFFFF" stopOpacity={0.3} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>

          {/* Secondary specular - softer reflection */}
          <RadialGradient id={`${id}Specular2`} cx="35%" cy="30%" r="45%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.5} />
            <Stop offset="50%" stopColor={baseColor.light} stopOpacity={0.2} />
            <Stop offset="100%" stopColor={baseColor.mid} stopOpacity={0} />
          </RadialGradient>

          {/* Rim light - edge glow effect */}
          <RadialGradient id={`${id}Rim`} cx="70%" cy="70%" r="50%">
            <Stop offset="0%" stopColor={rimColor} stopOpacity={0} />
            <Stop offset="60%" stopColor={rimColor} stopOpacity={0.3} />
            <Stop offset="85%" stopColor={rimColor} stopOpacity={0.6} />
            <Stop offset="100%" stopColor={baseColor.light} stopOpacity={0.8} />
          </RadialGradient>

          {/* Bottom ambient shadow */}
          <RadialGradient id={`${id}Shadow`} cx="55%" cy="65%" r="55%">
            <Stop offset="0%" stopColor={baseColor.dark} stopOpacity={0.4} />
            <Stop offset="70%" stopColor={baseColor.dark} stopOpacity={0.15} />
            <Stop offset="100%" stopColor={baseColor.dark} stopOpacity={0} />
          </RadialGradient>

          {/* Fresnel rim - subtle edge highlight */}
          <LinearGradient id={`${id}Fresnel`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.6} />
            <Stop offset="20%" stopColor="#FFFFFF" stopOpacity={0.3} />
            <Stop offset="50%" stopColor={baseColor.light} stopOpacity={0.1} />
            <Stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <G transform={`rotate(${rotation})`}>
          {/* Layer 1: Shadow base (bottom layer) */}
          <Path
            d={path}
            fill={`url(#${id}Shadow)`}
            transform="scale(1.02) translate(5, 15)"
          />

          {/* Layer 2: Main 3D body with gradient */}
          <Path
            d={path}
            fill={`url(#${id}MainGrad)`}
            transform="scale(1.0)"
          />

          {/* Layer 3: Rim light effect */}
          <Path
            d={path}
            fill={`url(#${id}Rim)`}
            transform="scale(0.98)"
          />

          {/* Layer 4: Secondary specular (softer) */}
          <Path
            d={path}
            fill={`url(#${id}Specular2)`}
            transform="scale(0.9) translate(10, -15)"
          />

          {/* Layer 5: Primary specular highlight (brightest) */}
          <Path
            d={path}
            fill={`url(#${id}Specular)`}
            transform="scale(0.75) translate(25, -35)"
          />

          {/* Layer 6: Fresnel edge highlight */}
          <Path
            d={path}
            fill={`url(#${id}Fresnel)`}
            transform="scale(0.95) translate(8, -12)"
          />
        </G>
      </Svg>
    </View>
  );
};

// Color palettes for the 3D glass blobs - enhanced for more vibrant 3D effect
const BLOB_COLORS = {
  teal: {
    highlight: '#FFFFFF', // Pure white for specular
    light: '#7FFFFF',     // Very bright cyan
    mid: '#2DD4BF',       // Rich teal
    dark: '#0F766E',      // Deep teal
    rim: '#5EEAD4',       // Rim light color
  },
  purple: {
    highlight: '#FFFFFF', // Pure white for specular
    light: '#E9D5FF',     // Light lavender
    mid: '#A855F7',       // Vibrant purple
    dark: '#6B21A8',      // Deep purple
    rim: '#C4B5FD',       // Rim light color
  },
  amber: {
    highlight: '#FFFFFF', // Pure white for specular
    light: '#FDE68A',     // Bright gold
    mid: '#D97706',       // Rich amber
    dark: '#78350F',      // Deep brown
    rim: '#FCD34D',       // Rim light color
  },
  pink: {
    highlight: '#FFFFFF', // Pure white for specular
    light: '#FBCFE8',     // Light pink
    mid: '#EC4899',       // Vibrant pink
    dark: '#831843',      // Deep magenta
    rim: '#F9A8D4',       // Rim light color
  },
};

export default function OrganicBackground({
  filterContext,
  variant = 'login',
}: OrganicBackgroundProps) {
  const { isDark } = useTheme();

  // In dark mode, render MatrixBackground instead
  if (isDark) {
    const matrixVariant = DARK_VARIANT_MAP[variant] || 'home';
    return <MatrixBackground variant={matrixVariant} />;
  }

  const palette = getPalette(filterContext);

  const renderLoginVariant = () => (
    <>
      {/* MAIN teal blob - sweeps from top-left across to center-right (like mockup) */}
      <GlassBlob
        id="tealMain"
        path={BLOBS.tealMain}
        baseColor={BLOB_COLORS.teal}
        size={950}
        position={{ top: -150, left: -180 }}
        rotation={-15}
      />

      {/* Purple blob - overlaps with teal, positioned upper-right flowing down */}
      <GlassBlob
        id="purpleMain"
        path={BLOBS.purpleMain}
        baseColor={BLOB_COLORS.purple}
        size={850}
        position={{ top: -80, right: -280 }}
        rotation={20}
      />

      {/* Secondary purple - small blob on left side (adds depth like mockup) */}
      <GlassBlob
        id="purpleLeft"
        path={BLOBS.tealSecondary}
        baseColor={BLOB_COLORS.purple}
        size={500}
        position={{ top: '35%', left: -280 }}
        rotation={-30}
        opacity={0.85}
      />

      {/* Amber/gold blob - bottom right, sweeping up */}
      <GlassBlob
        id="amberMain"
        path={BLOBS.amberMain}
        baseColor={BLOB_COLORS.amber}
        size={750}
        position={{ bottom: -180, right: -150 }}
        rotation={10}
      />

      {/* Secondary teal - bottom left corner */}
      <GlassBlob
        id="tealSecondary"
        path={BLOBS.tealSecondary}
        baseColor={BLOB_COLORS.teal}
        size={600}
        position={{ bottom: -200, left: -250 }}
        rotation={-20}
        opacity={0.75}
      />

      {/* Small purple accent - mid right for depth */}
      <GlassBlob
        id="purpleAccent"
        path={BLOBS.accent1}
        baseColor={BLOB_COLORS.purple}
        size={400}
        position={{ top: '45%', right: -100 }}
        rotation={35}
        opacity={0.6}
      />

      {/* Subtle wave pattern at bottom */}
      <View style={styles.waveContainer}>
        <Svg width={SCREEN_WIDTH + 100} height={180} viewBox="0 0 500 120">
          <Defs>
            <LinearGradient id="waveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#5DE8E8" stopOpacity={0.12} />
              <Stop offset="50%" stopColor="#A855F7" stopOpacity={0.05} />
              <Stop offset="100%" stopColor="#FCD34D" stopOpacity={0.02} />
            </LinearGradient>
          </Defs>
          <Path
            d="M0,40 Q80,20 160,40 T320,35 T480,45 T500,40 L500,120 L0,120 Z"
            fill="url(#waveGrad)"
          />
          <Path
            d="M0,60 Q100,35 200,55 T400,50 T500,60 L500,120 L0,120 Z"
            fill="url(#waveGrad)"
            opacity={0.6}
          />
          <Path
            d="M0,80 Q120,60 240,75 T480,70 T500,80 L500,120 L0,120 Z"
            fill="url(#waveGrad)"
            opacity={0.3}
          />
        </Svg>
      </View>
    </>
  );

  const renderOnboardingVariant = () => (
    <>
      {/* Pink/rose blob - top */}
      <GlassBlob
        id="pinkOnboard"
        path={BLOBS.accent1}
        baseColor={BLOB_COLORS.pink}
        size={500}
        position={{ top: -200, left: -50 }}
        rotation={-15}
        opacity={0.8}
      />

      {/* Large purple blob - right */}
      <GlassBlob
        id="purpleOnboard"
        path={BLOBS.purpleMain}
        baseColor={BLOB_COLORS.purple}
        size={700}
        position={{ top: '15%', right: -350 }}
        rotation={10}
      />

      {/* Teal blob - bottom left */}
      <GlassBlob
        id="tealOnboard"
        path={BLOBS.tealSecondary}
        baseColor={BLOB_COLORS.teal}
        size={600}
        position={{ bottom: -200, left: -280 }}
        rotation={-20}
      />

      {/* Filter-colored accent */}
      <View style={[styles.blobContainer, { top: '50%', right: -100 }]}>
        <Svg width={400} height={400} viewBox="-200 -200 400 400">
          <Defs>
            <RadialGradient id="filterOnboardGrad" cx="40%" cy="40%" r="60%">
              <Stop offset="0%" stopColor={palette.primary} stopOpacity={0.5} />
              <Stop offset="60%" stopColor={palette.primary} stopOpacity={0.2} />
              <Stop offset="100%" stopColor={palette.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Path d={BLOBS.accent1} fill="url(#filterOnboardGrad)" transform="scale(1.5) rotate(25)" />
        </Svg>
      </View>
    </>
  );

  const renderHomeVariant = () => (
    <>
      {/* Subtle teal - top */}
      <GlassBlob
        id="tealHome"
        path={BLOBS.tealMain}
        baseColor={BLOB_COLORS.teal}
        size={600}
        position={{ top: -300, left: -200 }}
        rotation={-5}
        opacity={0.55}
      />

      {/* Purple accent - right */}
      <GlassBlob
        id="purpleHome"
        path={BLOBS.accent1}
        baseColor={BLOB_COLORS.purple}
        size={450}
        position={{ top: '25%', right: -250 }}
        rotation={20}
        opacity={0.5}
      />

      {/* Amber accent - bottom */}
      <GlassBlob
        id="amberHome"
        path={BLOBS.accent1}
        baseColor={BLOB_COLORS.amber}
        size={400}
        position={{ bottom: -200, left: '20%' }}
        rotation={-10}
        opacity={0.45}
      />
    </>
  );

  const renderMinimalVariant = () => (
    <GlassBlob
      id="minimalBlob"
      path={BLOBS.accent1}
      baseColor={{
        highlight: '#F0F0FF',
        light: palette.primary,
        mid: palette.primary,
        dark: palette.primary,
      }}
      size={450}
      position={{ top: -150, right: -200 }}
      rotation={10}
      opacity={0.55}
    />
  );

  const renderBlobs = () => {
    switch (variant) {
      case 'login':
        return renderLoginVariant();
      case 'onboarding':
        return renderOnboardingVariant();
      case 'home':
        return renderHomeVariant();
      case 'minimal':
      default:
        return renderMinimalVariant();
    }
  };

  return (
    <View style={styles.container} pointerEvents="none">
      {renderBlobs()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  blobContainer: {
    position: 'absolute',
  },
  waveContainer: {
    position: 'absolute',
    bottom: 0,
    left: -50,
    right: 0,
  },
});
