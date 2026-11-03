import React from 'react';

// src/components/panelTab/equalizer/EqualizerSection.tsx
// A section of the audio effect window: a small heading over one card, the look of a group in the
// settings. The settings kit's Group is not used: it cannot take the height that is to spare, which
// the band section does.

type EqualizerSectionProps = {
    title: string;
    /** A few quiet words at the right end of the heading's line. */
    hint?: string;
    /** Takes the height its column has to spare, and its card with it. */
    grow?: boolean;
    children: React.ReactNode;
};

const EqualizerSection: React.FC<EqualizerSectionProps> = ({ title, hint, grow, children }) => (
    <section className={`mt-5 flex flex-col${grow ? ' flex-1' : ''}`}>
        <div className="mb-2 flex min-h-6 items-center justify-between gap-3 px-1">
            <h3 className="text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">{title}</h3>
            {hint && <span className="text-xs leading-[18px] text-[color:var(--st-t3)]">{hint}</span>}
        </div>
        <div className={`overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]${grow ? ' flex flex-1' : ''}`}>
            {children}
        </div>
    </section>
);

export default EqualizerSection;
