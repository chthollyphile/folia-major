import React from 'react';
import type { OmniCollection } from '../../../../types/onlineMusic';

// Provider-declared cover branding, shared by Explore's list, grid and wall presentations.
export const ExploreCoverOverlay: React.FC<{ overlay?: OmniCollection['coverOverlay']; className?: string }> = ({ overlay, className = 'absolute inset-x-0 bottom-0 h-[22%] min-h-3' }) => overlay ? (
    <span data-cover-overlay aria-hidden="true" className={`pointer-events-none [container-type:inline-size] ${className}`}>
        <span className="absolute inset-0 flex items-center justify-between gap-0.5 bg-sky-500/75 pl-[5%] text-white">
            <span className="min-w-0 truncate text-[clamp(7px,9cqi,24px)] font-medium leading-none">{overlay.label}</span>
            {overlay.logoUrl && <img data-cover-overlay-logo src={overlay.logoUrl} alt="" draggable={false} className="h-[125%] max-w-[25%] self-end object-contain object-bottom" />}
        </span>
    </span>
) : null;
