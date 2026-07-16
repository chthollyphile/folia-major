import { useTranslation } from 'react-i18next';

// src/components/modal/DurationMatchBadge.tsx
// Displays the shared duration-match result used by manual metadata and lyric matching.

interface DurationMatchBadgeProps {
    matched: boolean | null | undefined;
}

export const DurationMatchBadge = ({ matched }: DurationMatchBadgeProps) => {
    const { t } = useTranslation();
    if (matched !== true) return null;

    return (
        <span className="shrink-0 rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
            {t('localMusic.durationMatched')}
        </span>
    );
};
