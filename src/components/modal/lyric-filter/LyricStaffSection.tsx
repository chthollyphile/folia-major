import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    LYRIC_STAFF_MIN_DWELL_RANGE,
    type LyricStaffDecision,
    type LyricStaffPolicy,
} from '../../../utils/lyrics/staffCreditsPolicy';
import { LYRIC_STAFF_PATTERN_EXAMPLE, getLyricStaffPatternError } from '../../../utils/lyrics/staffCredits';

// src/components/modal/lyric-filter/LyricStaffSection.tsx

const POLICY_ORDER: LyricStaffPolicy[] = ['keep', 'smart', 'hide'];

const POLICY_LABEL_KEYS: Record<LyricStaffPolicy, { label: string; description: string }> = {
    keep: { label: 'lyricStaff.policyKeep', description: 'lyricStaff.policyKeepDesc' },
    smart: { label: 'lyricStaff.policySmart', description: 'lyricStaff.policySmartDesc' },
    hide: { label: 'lyricStaff.policyHide', description: 'lyricStaff.policyHideDesc' },
};

const formatSeconds = (seconds: number): string => (Math.round(seconds * 10) / 10).toFixed(1);

interface LyricStaffSectionProps {
    isDaylight: boolean;
    policy: LyricStaffPolicy;
    minDwellSeconds: number;
    pattern: string;
    decision: LyricStaffDecision;
    onPolicyChange: (policy: LyricStaffPolicy) => void;
    onMinDwellChange: (seconds: number) => void;
    onPatternChange: (pattern: string) => void;
}

const LyricStaffSection: React.FC<LyricStaffSectionProps> = ({
    isDaylight,
    policy,
    minDwellSeconds,
    pattern,
    decision,
    onPolicyChange,
    onMinDwellChange,
    onPatternChange,
}) => {
    const { t } = useTranslation();
    const cardBg = isDaylight ? 'bg-black/[0.03]' : 'bg-white/[0.04]';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const inputBg = isDaylight ? 'bg-black/5 border-black/10' : 'bg-white/5 border-white/10';
    const trackBg = isDaylight ? 'bg-black/[0.05]' : 'bg-black/15';
    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const dangerText = isDaylight ? 'text-red-600' : 'text-red-300';
    const patternError = getLyricStaffPatternError(pattern);

    const verdictLabel = t(`lyricStaff.verdict${decision.verdict.charAt(0).toUpperCase()}${decision.verdict.slice(1)}`);

    return (
        <div className={`rounded-[24px] border p-4 ${cardBg} ${borderColor}`}>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {t('lyricStaff.title')}
            </div>
            <div className={`mt-1 text-xs ${mutedText}`}>{t('lyricStaff.description')}</div>

            {/* 选中态沿用设置页分段控件的做法：白天用实心白药丸 + 深色字，夜间用高亮层，
                未选中一律压透明度。早先两种状态都是 white/x 叠加，在亮色背景上分不出来。 */}
            <div className={`mt-4 grid grid-cols-3 gap-1 rounded-2xl border p-1 ${borderColor} ${trackBg}`}>
                {POLICY_ORDER.map((option) => {
                    const isSelected = policy === option;

                    return (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onPolicyChange(option)}
                            className={`rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 ${
                                isSelected
                                    ? (isDaylight ? 'bg-white text-zinc-900 shadow-sm' : 'bg-white/10 shadow-sm')
                                    : 'opacity-50 hover:opacity-100'
                            }`}
                            style={{ color: isSelected && isDaylight ? undefined : 'var(--text-primary)' }}
                        >
                            {t(POLICY_LABEL_KEYS[option].label)}
                        </button>
                    );
                })}
            </div>
            <div className={`mt-2 px-1 text-xs ${mutedText}`}>{t(POLICY_LABEL_KEYS[policy].description)}</div>

            {policy === 'smart' && (
                <div className="mt-4">
                    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-primary)' }}>
                        <span>{t('lyricStaff.minDwell')}</span>
                        <span>{t('lyricStaff.minDwellValue', { seconds: formatSeconds(minDwellSeconds) })}</span>
                    </div>
                    <input
                        type="range"
                        min={LYRIC_STAFF_MIN_DWELL_RANGE.min}
                        max={LYRIC_STAFF_MIN_DWELL_RANGE.max}
                        step={0.1}
                        value={minDwellSeconds}
                        onChange={(event) => onMinDwellChange(Number.parseFloat(event.target.value))}
                        className={`mt-2 w-full accent-current ${isDaylight ? 'text-zinc-900' : 'text-white'}`}
                        aria-label={t('lyricStaff.minDwell')}
                    />
                    <div className={`mt-1 text-xs ${mutedText}`}>{t('lyricStaff.minDwellDesc')}</div>
                </div>
            )}

            {policy !== 'keep' && (
                <>
                    <div className="mt-5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('lyricStaff.customPattern')}
                    </div>
                    <div className={`mt-1 text-xs ${mutedText}`}>{t('lyricStaff.customPatternDesc')}</div>
                    <textarea
                        value={pattern}
                        onChange={(event) => onPatternChange(event.target.value)}
                        placeholder={t('lyricStaff.customPatternPlaceholder')}
                        rows={4}
                        spellCheck={false}
                        className={`mt-3 w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none transition-colors ${inputBg}`}
                        style={{ color: 'var(--text-primary)' }}
                    />
                    <div className="mt-2 px-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {t('lyricFilter.example')} <code>{LYRIC_STAFF_PATTERN_EXAMPLE}</code>
                    </div>
                    {patternError && (
                        <div className={`mt-2 text-xs ${dangerText}`}>
                            {t('lyricFilter.invalidRegex', { error: patternError })}
                        </div>
                    )}

                    <div className={`mt-5 rounded-2xl border px-3 py-3 ${borderColor} ${inputBg}`}>
                        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('lyricStaff.verdict')}：{verdictLabel}
                        </div>
                        {decision.verdict !== 'none' && policy === 'smart' && (
                            <div className={`mt-1 text-xs ${mutedText}`}>
                                {t('lyricStaff.verdictSummary', {
                                    lines: decision.blockLineCount,
                                    window: formatSeconds(decision.windowSeconds),
                                    required: formatSeconds(decision.requiredSeconds),
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default LyricStaffSection;
