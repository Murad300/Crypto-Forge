import React from 'react';
import { motion } from 'motion/react';

export default function IronMan() {
  return (
    <motion.div
      className="absolute -left-10 top-[25%] z-20 w-16 h-16 pointer-events-none"
      style={{ originY: "50%" }}
      animate={{
        y: [-8, 8, -8],
        rotate: [-3, 3, -3]
      }}
      transition={{
        duration: 4,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      id="ironman-component"
    >
      <svg viewBox="0 0 128 128" className="w-full h-full drop-shadow-[0_0_12px_rgba(239,68,68,0.75)]">
        {/* Helmet Outline */}
        <path d="M34,40 C34,25 44,15 64,15 C84,15 94,25 94,40 L94,80 C94,90 84,95 64,95 C44,95 34,90 34,80 Z" fill="#ef4444" />
        {/* Gold Faceplate */}
        <path d="M42,42 C42,32 50,23 64,23 C78,23 86,32 86,42 L84,72 C84,80 76,85 64,85 C52,85 44,80 44,72 Z" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />
        {/* Glowing Mask Eyes */}
        <rect x="48" y="46" width="12" height="4" rx="2" fill="#22d3ee" className="animate-pulse" />
        <rect x="68" y="46" width="12" height="4" rx="2" fill="#22d3ee" className="animate-pulse" />
        {/* Cheek & Jaw lines */}
        <path d="M44,65 L52,70 L76,70 L84,65" fill="none" stroke="#d97706" strokeWidth="2" />
        {/* Arc Reactor Chest segment */}
        <path d="M24,105 L104,105 L94,124 L34,124 Z" fill="#dc2626" />
        <circle cx="64" cy="115" r="9" fill="#0f172a" />
        <circle cx="64" cy="115" r="7" fill="#22d3ee" className="opacity-75" />
        <circle cx="64" cy="115" r="4" fill="#ffffff" />
      </svg>
    </motion.div>
  );
}

