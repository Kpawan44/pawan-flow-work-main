import React from 'react';

interface AppLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export default function AppLogo({ className = '', size = 'md' }: AppLogoProps) {
  // Define dimensions based on size prop
  const dimensions = {
    xs: 'h-4 w-4',
    sm: 'h-5 w-5',
    md: 'h-7 w-7',
    lg: 'h-10 w-10',
    xl: 'h-16 w-16',
  }[size];

  return (
    <svg
      className={`${dimensions} ${className} shrink-0`}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Main Brand Gradients */}
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" /> {/* Electric Blue */}
          <stop offset="100%" stopColor="#06B6D4" /> {/* Bright Cyan */}
        </linearGradient>
        
        <linearGradient id="accent-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6366F1" /> {/* Indigo */}
          <stop offset="100%" stopColor="#3B82F6" /> {/* Royal Blue */}
        </linearGradient>

        <linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F59E0B" /> {/* Amber */}
          <stop offset="100%" stopColor="#D97706" /> {/* Gold */}
        </linearGradient>

        {/* Glow Filter for High-Contrast Premium Look */}
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer Hexagonal Shield Frame */}
      <polygon
        points="50,5 90,28 90,72 50,95 10,72 10,28"
        stroke="url(#logo-grad)"
        strokeWidth="3.5"
        strokeLinejoin="round"
        fill="none"
        opacity="0.25"
      />

      {/* Secondary Inner Hexagon representing precision */}
      <polygon
        points="50,14 81,32 81,68 50,86 19,68 19,32"
        stroke="url(#logo-grad)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        strokeLinejoin="round"
        fill="none"
        opacity="0.4"
      />

      {/* Industrial Factory Silhouette / Gear Teeth nested geometrically */}
      {/* 3 central structural towers representing heavy industry, stamping, plating, and storage */}
      <path
        d="M32,68 V45 L40,51 V40 L48,46 V35 L56,41 V48 L64,43 V68 Z"
        fill="url(#logo-grad)"
        opacity="0.9"
      />

      {/* Circular Traceability Pipeline Orbit */}
      <circle
        cx="50"
        cy="50"
        r="34"
        stroke="url(#accent-grad)"
        strokeWidth="3"
        strokeDasharray="60 30"
        className="animate-[spin_12s_linear_infinite]"
        style={{ transformOrigin: 'center' }}
      />

      {/* Glowing material flow pipeline nodes (Store, Production, Dispatch) */}
      {/* Node 1: Raw Material Source */}
      <circle
        cx="32"
        cy="68"
        r="5"
        fill="#3B82F6"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        filter="url(#glow)"
      />
      
      {/* Node 2: Production Target */}
      <circle
        cx="50"
        cy="35"
        r="5.5"
        fill="#06B6D4"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        filter="url(#glow)"
      />

      {/* Node 3: Dispatch Destination */}
      <circle
        cx="64"
        cy="68"
        r="5"
        fill="#6366F1"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        filter="url(#glow)"
      />

      {/* Precision crosshair ticks at corners */}
      <line x1="50" y1="5" x2="50" y2="10" stroke="url(#logo-grad)" strokeWidth="2" />
      <line x1="50" y1="90" x2="50" y2="95" stroke="url(#logo-grad)" strokeWidth="2" />
      <line x1="10" y1="28" x2="15" y2="31" stroke="url(#logo-grad)" strokeWidth="2" />
      <line x1="90" y1="72" x2="85" y2="69" stroke="url(#logo-grad)" strokeWidth="2" />

      {/* Center glowing core point */}
      <circle cx="50" cy="52" r="2.5" fill="#FFFFFF" filter="url(#glow)" />
    </svg>
  );
}
