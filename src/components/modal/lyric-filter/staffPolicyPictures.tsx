import React from 'react';
import type { LyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';

// src/components/modal/lyric-filter/staffPolicyPictures.tsx
// The pictures of the three ways to treat the opening credits, for the kit's PictureChoice (a 96 by
// 64 frame). Each shows the intro as a band with the credits in it, and the first two lyric lines
// after it: the credits bunched at the start as the file has them, spread over the intro, or gone.

/** Where the credits start inside the intro band, and how wide each one is. */
const CREDITS: Record<Exclude<LyricStaffPolicy, 'hide'>, { starts: number[]; width: number }> = {
    keep: { starts: [13, 18, 23], width: 3 },
    smart: { starts: [13, 28, 43], width: 10 },
};

export const StaffPolicyPicture: React.FC<{ policy: LyricStaffPolicy }> = ({ policy }) => (
    <svg viewBox="0 0 96 64" className="block h-full w-full">
        {policy === 'hide' ? (
            <rect x="8.5" y="23.5" width="49" height="17" rx="5" strokeDasharray="3 3" style={{ fill: 'none', stroke: 'var(--st-line2)' }} />
        ) : (
            <>
                <rect x="8" y="23" width="50" height="18" rx="5" style={{ fill: 'var(--st-fill2)' }} />
                {CREDITS[policy].starts.map(x => (
                    <rect key={x} x={x} y="28" width={CREDITS[policy].width} height="8" rx={Math.min(2, CREDITS[policy].width / 2)} style={{ fill: 'var(--st-t1)' }} />
                ))}
            </>
        )}
        {[64, 78].map(x => (
            <rect key={x} x={x} y="29" width="10" height="6" rx="3" style={{ fill: 'var(--st-t3)' }} />
        ))}
    </svg>
);
