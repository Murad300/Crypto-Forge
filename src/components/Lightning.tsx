import React from 'react';
import { motion } from 'motion/react';

export default function Lightning() {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-hidden" id="lightning-component-wrapper">
      <svg 
        className="w-full h-full pointer-events-none"
        viewBox="0 0 400 120"
        preserveAspectRatio="none"
        id="lightning-component-svg"
      >
        <motion.path
          d="M 15,60 L 80,35 L 140,85 L 200,40 L 260,80 L 320,30 L 385,60"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#glow-filter)"
          style={{ originX: 0.5, originY: 0.5 }}
          animate={{
            opacity: [0, 1, 0],
            strokeDashoffset: [0, 40, 0]
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <defs>
          <filter id="glow-filter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
