import React from 'react';

interface YoinkMarkProps {
  size?: number;
  className?: string;
}

/**
 * Open-corner crop frame with detached top-right corner pixel,
 * matching public/yoink-brand-logo.png in currentColor so it adapts
 * cleanly across light and dark DESIGN.md tokens.
 */
export const YoinkMark: React.FC<YoinkMarkProps> = ({ size = 20, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M14.5 3.5H6.5C4.84315 3.5 3.5 4.84315 3.5 6.5V17.5C3.5 19.1569 4.84315 20.5 6.5 20.5H17.5C19.1569 20.5 20.5 19.1569 20.5 17.5V9.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <rect x="16.5" y="3.5" width="4" height="4" rx="0.75" fill="currentColor" />
  </svg>
);
