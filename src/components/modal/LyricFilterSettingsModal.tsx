import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricData } from '../../types';
import { getLyricFilterError } from '../../utils/lyrics/filtering';
import { getLyricStaffPatternError } from '../../utils/lyrics/staffCredits';
import type { LyricStaffAbsorbMode, LyricStaffPolicy } from '../../utils/lyrics/staffCreditsPolicy';
import Sheet, { SheetButton } from '../shared/Sheet';
import { buildLyricFilterPreviewModel } from './lyric-filter/buildLyricFilterPreviewModel';
import LyricFilterPreviewList from './lyric-filter/LyricFilterPreviewList';
import LyricFilterRuleSection from './lyric-filter/LyricFilterRuleSection';
import LyricStaffSection from './lyric-filter/LyricStaffSection';

// src/components/modal/LyricFilterSettingsModal.tsx
// The lyric filter window: a large sheet with the sample lyric at the left and the rules at the
// right. Every change of a rule shows in the sample at once; nothing is stored until Save.

export interface LyricFilterDraft {
    pattern: string;
    filterEnabled: boolean;
    staffPolicy: LyricStaffPolicy;
    staffMinDwellSeconds: number;
    staffAbsorbMode: LyricStaffAbsorbMode;
    staffPattern: string;
}

interface LyricFilterSettingsModalProps {
    isOpen: boolean;
    isDaylight: boolean;
    currentSongTitle?: string | null;
    initialPattern: string;
    initialFilterEnabled: boolean;
    initialStaffPolicy: LyricStaffPolicy;
    initialStaffMinDwellSeconds: number;
    initialStaffAbsorbMode: LyricStaffAbsorbMode;
    initialStaffPattern: string;
    loadPreviewLyrics: () => Promise<LyricData | null>;
    onClose: () => void;
    onSave: (draft: LyricFilterDraft) => Promise<void> | void;
}

const LyricFilterSettingsModal: React.FC<LyricFilterSettingsModalProps> = ({
    isOpen,
    isDaylight,
    currentSongTitle,
    initialPattern,
    initialFilterEnabled,
    initialStaffPolicy,
    initialStaffMinDwellSeconds,
    initialStaffAbsorbMode,
    initialStaffPattern,
    loadPreviewLyrics,
    onClose,
    onSave,
}) => {
    const { t } = useTranslation();
    const [draftPattern, setDraftPattern] = useState(initialPattern);
    const [isFilterEnabled, setIsFilterEnabled] = useState(initialFilterEnabled);
    const [draftStaffPolicy, setDraftStaffPolicy] = useState<LyricStaffPolicy>(initialStaffPolicy);
    const [draftStaffMinDwell, setDraftStaffMinDwell] = useState(initialStaffMinDwellSeconds);
    const [draftStaffAbsorbMode, setDraftStaffAbsorbMode] = useState<LyricStaffAbsorbMode>(initialStaffAbsorbMode);
    const [draftStaffPattern, setDraftStaffPattern] = useState(initialStaffPattern);
    const [previewLyrics, setPreviewLyrics] = useState<LyricData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setDraftPattern(initialPattern);
        setIsFilterEnabled(initialFilterEnabled);
        setDraftStaffPolicy(initialStaffPolicy);
        setDraftStaffMinDwell(initialStaffMinDwellSeconds);
        setDraftStaffAbsorbMode(initialStaffAbsorbMode);
        setDraftStaffPattern(initialStaffPattern);
        setIsLoadingPreview(true);
        let active = true;

        loadPreviewLyrics()
            .then((lyrics) => {
                if (active) {
                    setPreviewLyrics(lyrics);
                }
            })
            .finally(() => {
                if (active) {
                    setIsLoadingPreview(false);
                }
            });

        return () => {
            active = false;
        };
    }, [
        initialPattern,
        initialFilterEnabled,
        initialStaffMinDwellSeconds,
        initialStaffAbsorbMode,
        initialStaffPattern,
        initialStaffPolicy,
        isOpen,
        loadPreviewLyrics,
    ]);

    const effectivePattern = isFilterEnabled ? draftPattern : '';
    const error = isFilterEnabled ? getLyricFilterError(draftPattern) : null;
    // 只在自定义规则输入框可见时校验：切到「始终显示」后输入框和报错都会收起来，
    // 再拿它禁用保存按钮，用户就只剩「切回去清空」这一条路。
    const staffPatternError = draftStaffPolicy === 'keep' ? null : getLyricStaffPatternError(draftStaffPattern);
    const preview = useMemo(
        () => buildLyricFilterPreviewModel(previewLyrics, effectivePattern, {
            policy: draftStaffPolicy,
            minDwellSeconds: draftStaffMinDwell,
            absorbMode: draftStaffAbsorbMode,
            pattern: draftStaffPattern,
        }),
        [draftStaffAbsorbMode, draftStaffMinDwell, draftStaffPattern, draftStaffPolicy, effectivePattern, previewLyrics]
    );

    const handleSave = async () => {
        if (error || staffPatternError) {
            return;
        }

        setIsSaving(true);
        try {
            await onSave({
                pattern: draftPattern.trim(),
                filterEnabled: isFilterEnabled,
                staffPolicy: draftStaffPolicy,
                staffMinDwellSeconds: draftStaffMinDwell,
                staffAbsorbMode: draftStaffAbsorbMode,
                staffPattern: draftStaffPattern.trim(),
            });
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            size="l"
            body="panes"
            title={t('lyricFilter.title')}
            footer={(
                <>
                    <SheetButton onClick={onClose}>{t('ui.cancel')}</SheetButton>
                    <SheetButton
                        variant="primary"
                        disabled={Boolean(error) || Boolean(staffPatternError) || isSaving}
                        onClick={handleSave}
                    >
                        {isSaving ? t('lyricFilter.saving') : t('lyricFilter.save')}
                    </SheetButton>
                </>
            )}
        >
            {/* Side by side; one above the other in a window too narrow for both. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-[var(--st-line)] bg-[var(--st-pv)] md:border-b-0 md:border-r">
                    <div className="flex shrink-0 items-baseline justify-between gap-4 px-6 pb-1.5 pt-4 text-[13px] text-[color:var(--st-t2)]">
                        <span className="min-w-0 truncate">
                            {currentSongTitle ? t('lyricFilter.previewCurrentSong', { title: currentSongTitle }) : t('lyricFilter.previewFallback')}
                        </span>
                        {preview.totalCount > 0 && (
                            <span className="shrink-0 tabular-nums text-[color:var(--st-t1)]">
                                {t('lyricFilter.filteredCount', { removed: preview.removedCount, total: preview.totalCount })}
                            </span>
                        )}
                    </div>
                    <div className="st-scroll min-h-0 flex-1 overflow-y-auto px-3">
                        <LyricFilterPreviewList
                            isLoading={isLoadingPreview}
                            rows={preview.rows}
                            staff={preview.staff}
                            staffPolicy={draftStaffPolicy}
                            staffBlockRanges={preview.staffBlockRanges}
                        />
                    </div>
                </div>

                <div className="st-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:w-[440px] md:flex-none">
                    <LyricFilterRuleSection
                        isEnabled={isFilterEnabled}
                        pattern={draftPattern}
                        error={error}
                        onToggle={() => setIsFilterEnabled(previous => !previous)}
                        onPatternChange={setDraftPattern}
                    />
                    <LyricStaffSection
                        policy={draftStaffPolicy}
                        minDwellSeconds={draftStaffMinDwell}
                        absorbMode={draftStaffAbsorbMode}
                        pattern={draftStaffPattern}
                        onPolicyChange={setDraftStaffPolicy}
                        onMinDwellChange={setDraftStaffMinDwell}
                        onAbsorbModeChange={setDraftStaffAbsorbMode}
                        onPatternChange={setDraftStaffPattern}
                    />
                </div>
            </div>
        </Sheet>
    );
};

export default LyricFilterSettingsModal;
