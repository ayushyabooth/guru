// ComplexInterlockingRings.tsx
import React from 'react';

interface ComplexInterlockingRingsProps {
  size?: number;
  className?: string;
  progress?: {
    catchUp?: number;  // 0-100
    diveIn?: number;   // 0-100
    recap?: number;    // 0-100
  };
  animated?: boolean;
}

export const ComplexInterlockingRings: React.FC<ComplexInterlockingRingsProps> = ({ 
  size = 400, 
  className = '',
  progress,
  animated = false
}) => {
  // Calculate opacity based on progress (0.3 = dim, 0.95 = bright)
  const getCatchUpOpacity = () => progress?.catchUp ? 0.3 + (progress.catchUp / 100) * 0.65 : 0.95;
  const getDiveInOpacity = () => progress?.diveIn ? 0.3 + (progress.diveIn / 100) * 0.65 : 0.95;
  const getRecapOpacity = () => progress?.recap ? 0.3 + (progress.recap / 100) * 0.65 : 0.95;

  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 400 400" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Complex Interlocking Progress Rings"
    >
      <defs>
        {/* Gradients for each ring */}
        <linearGradient id="catchUpGradientComplex" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#32B8C6', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#2DA6B2', stopOpacity: 1 }} />
        </linearGradient>

        <linearGradient id="diveInGradientComplex" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#E68161', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#F5F5F5', stopOpacity: 1 }} />
        </linearGradient>

        <linearGradient id="recapGradientComplex" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#E6B861', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#D4A857', stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Group 1: Catch Up (Top) - Teal with yin-yang tips */}
      <g 
        id="catch-up-ring" 
        opacity={getCatchUpOpacity()}
        style={{ 
          transition: 'opacity 0.6s ease',
          ...(animated && { animation: 'pulse 3s ease-in-out infinite' })
        }}
      >
        {/* Concentric stroke lines (7 layers for depth) */}
        <path d="M 200 40 C 160 40, 130 60, 130 90 C 130 130, 160 160, 200 160 C 240 160, 270 130, 270 90 C 270 60, 240 40, 200 40"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="20" opacity="0.9"/>
        <path d="M 200 40 C 160 40, 130 60, 130 90 C 130 130, 160 160, 200 160 C 240 160, 270 130, 270 90 C 270 60, 240 40, 200 40"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="18" opacity="0.8"/>
        <path d="M 200 43 C 162 43, 133 62, 133 90 C 133 128, 162 157, 200 157 C 238 157, 267 128, 267 90 C 267 62, 238 43, 200 43"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="16" opacity="0.7"/>
        <path d="M 200 46 C 164 46, 136 64, 136 90 C 136 126, 164 154, 200 154 C 236 154, 264 126, 264 90 C 264 64, 236 46, 200 46"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="14" opacity="0.6"/>
        <path d="M 200 49 C 166 49, 139 66, 139 90 C 139 124, 166 151, 200 151 C 234 151, 261 124, 261 90 C 261 66, 234 49, 200 49"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="12" opacity="0.5"/>
        <path d="M 200 52 C 168 52, 142 68, 142 90 C 142 122, 168 148, 200 148 C 232 148, 258 122, 258 90 C 258 68, 232 52, 200 52"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="10" opacity="0.4"/>
        <path d="M 200 55 C 170 55, 145 70, 145 90 C 145 120, 170 145, 200 145 C 230 145, 255 120, 255 90 C 255 70, 230 55, 200 55"
              fill="none" stroke="url(#catchUpGradientComplex)" strokeWidth="8" opacity="0.3"/>

        {/* Yin-yang tips */}
        <circle cx="130" cy="90" r="20" fill="url(#catchUpGradientComplex)" opacity="0.95"/>
        <circle cx="130" cy="90" r="10" fill="#1f2121"/>
        <circle cx="130" cy="90" r="3" fill="#FCFCF9"/>

        <circle cx="270" cy="90" r="20" fill="#1f2121" opacity="0.9"/>
        <circle cx="270" cy="90" r="10" fill="url(#catchUpGradientComplex)"/>
        <circle cx="270" cy="90" r="3" fill="#1f2121"/>

        <title>Catch Up {progress?.catchUp ? `${progress.catchUp}%` : ''}</title>
      </g>

      {/* Group 2: Dive In (Bottom-left) - Orange/White gradient with yin-yang tips */}
      <g 
        id="dive-in-ring" 
        opacity={getDiveInOpacity()}
        style={{ 
          transition: 'opacity 0.6s ease',
          ...(animated && { animation: 'pulse 3s ease-in-out infinite 1s' })
        }}
      >
        {/* Concentric stroke lines */}
        <path d="M 60 260 C 60 220, 80 190, 110 190 C 150 190, 180 220, 180 260 C 180 300, 150 330, 110 330 C 80 330, 60 300, 60 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="20" opacity="0.9"/>
        <path d="M 60 260 C 60 220, 80 190, 110 190 C 150 190, 180 220, 180 260 C 180 300, 150 330, 110 330 C 80 330, 60 300, 60 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="18" opacity="0.8"/>
        <path d="M 63 260 C 63 222, 82 193, 110 193 C 148 193, 177 222, 177 260 C 177 298, 148 327, 110 327 C 82 327, 63 298, 63 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="16" opacity="0.7"/>
        <path d="M 66 260 C 66 224, 84 196, 110 196 C 146 196, 174 224, 174 260 C 174 296, 146 324, 110 324 C 84 324, 66 296, 66 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="14" opacity="0.6"/>
        <path d="M 69 260 C 69 226, 86 199, 110 199 C 144 199, 171 226, 171 260 C 171 294, 144 321, 110 321 C 86 321, 69 294, 69 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="12" opacity="0.5"/>
        <path d="M 72 260 C 72 228, 88 202, 110 202 C 142 202, 168 228, 168 260 C 168 292, 142 318, 110 318 C 88 318, 72 292, 72 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="10" opacity="0.4"/>
        <path d="M 75 260 C 75 230, 90 205, 110 205 C 140 205, 165 230, 165 260 C 165 290, 140 315, 110 315 C 90 315, 75 290, 75 260"
              fill="none" stroke="url(#diveInGradientComplex)" strokeWidth="8" opacity="0.3"/>

        {/* Yin-yang tips */}
        <circle cx="110" cy="190" r="20" fill="url(#diveInGradientComplex)" opacity="0.95"/>
        <circle cx="110" cy="190" r="10" fill="#1f2121"/>
        <circle cx="110" cy="190" r="3" fill="#FCFCF9"/>

        <circle cx="110" cy="330" r="20" fill="#1f2121" opacity="0.9"/>
        <circle cx="110" cy="330" r="10" fill="url(#diveInGradientComplex)"/>
        <circle cx="110" cy="330" r="3" fill="#1f2121"/>

        <title>Dive In {progress?.diveIn ? `${progress.diveIn}%` : ''}</title>
      </g>

      {/* Group 3: Recap (Bottom-right) - Gold with yin-yang tips */}
      <g 
        id="recap-ring" 
        opacity={getRecapOpacity()}
        style={{ 
          transition: 'opacity 0.6s ease',
          ...(animated && { animation: 'pulse 3s ease-in-out infinite 2s' })
        }}
      >
        {/* Concentric stroke lines */}
        <path d="M 220 260 C 220 220, 240 190, 270 190 C 310 190, 340 220, 340 260 C 340 300, 310 330, 270 330 C 240 330, 220 300, 220 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="20" opacity="0.9"/>
        <path d="M 220 260 C 220 220, 240 190, 270 190 C 310 190, 340 220, 340 260 C 340 300, 310 330, 270 330 C 240 330, 220 300, 220 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="18" opacity="0.8"/>
        <path d="M 223 260 C 223 222, 242 193, 270 193 C 308 193, 337 222, 337 260 C 337 298, 308 327, 270 327 C 242 327, 223 298, 223 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="16" opacity="0.7"/>
        <path d="M 226 260 C 226 224, 244 196, 270 196 C 306 196, 334 224, 334 260 C 334 296, 306 324, 270 324 C 244 324, 226 296, 226 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="14" opacity="0.6"/>
        <path d="M 229 260 C 229 226, 246 199, 270 199 C 304 199, 331 226, 331 260 C 331 294, 304 321, 270 321 C 246 321, 229 294, 229 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="12" opacity="0.5"/>
        <path d="M 232 260 C 232 228, 248 202, 270 202 C 302 202, 328 228, 328 260 C 328 292, 302 318, 270 318 C 248 318, 232 292, 232 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="10" opacity="0.4"/>
        <path d="M 235 260 C 235 230, 250 205, 270 205 C 300 205, 325 230, 325 260 C 325 290, 300 315, 270 315 C 250 315, 235 290, 235 260"
              fill="none" stroke="url(#recapGradientComplex)" strokeWidth="8" opacity="0.3"/>

        {/* Yin-yang tips */}
        <circle cx="270" cy="190" r="20" fill="url(#recapGradientComplex)" opacity="0.95"/>
        <circle cx="270" cy="190" r="10" fill="#1f2121"/>
        <circle cx="270" cy="190" r="3" fill="#FCFCF9"/>

        <circle cx="270" cy="330" r="20" fill="#1f2121" opacity="0.9"/>
        <circle cx="270" cy="330" r="10" fill="url(#recapGradientComplex)"/>
        <circle cx="270" cy="330" r="3" fill="#1f2121"/>

        <title>Recap {progress?.recap ? `${progress.recap}%` : ''}</title>
      </g>

      {/* Center connection point */}
      <circle cx="200" cy="200" r="15" fill="#1f2121" opacity="0.8"/>
      <circle cx="200" cy="200" r="8" fill="#32B8C6" opacity="0.6"/>
    </svg>
  );
};

// USAGE EXAMPLES:

// 1. Basic display
// <ComplexInterlockingRings size={400} />

// 2. With progress tracking
// <ComplexInterlockingRings 
//   size={350} 
//   progress={{
//     catchUp: 80,
//     diveIn: 60,
//     recap: 40
//   }}
// />

// 3. Animated version
// <ComplexInterlockingRings 
//   size={400} 
//   animated={true}
// />

// 4. Responsive in container
// <div style={{ maxWidth: '600px', margin: '0 auto' }}>
//   <ComplexInterlockingRings size={600} />
// </div>
