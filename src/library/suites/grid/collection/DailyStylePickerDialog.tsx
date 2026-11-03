import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../../../../components/shared/ThemedDialog';
import { SheetButton } from '../../../../components/shared/Sheet';
import { Tabs } from '../../../../components/modal/settings/kit/Tabs';
import type { DailyStyleGroup, DailyStyleSelection } from '../../../../types/onlineMusic';
import { toggleDailyStyleTag } from '../../../core/collection/dailyStyle';

// src/library/suites/grid/collection/DailyStylePickerDialog.tsx
// 每日推荐的风格选择（#938）：上面是平台的风格分组（曲风、情绪……），下面是这一组的风格，可以选几个；
// 一次只能选同一组里的，点了别的组的风格就从那一组重新选（core/collection/dailyStyle）。确认才交出去。

type DailyStylePickerDialogProps = {
    isOpen: boolean;
    isDaylight: boolean;
    groups: readonly DailyStyleGroup[];
    /** 风格分组没取到：给失败的说明和重试。 */
    groupsFailed: boolean;
    /** 账号现在选的风格：打开时从它开始。 */
    selection: DailyStyleSelection | null;
    onRetryGroups: () => void;
    onConfirm: (selection: DailyStyleSelection) => void;
    onClose: () => void;
};

const DailyStylePickerDialog: React.FC<DailyStylePickerDialogProps> = ({
    isOpen,
    isDaylight,
    groups,
    groupsFailed,
    selection,
    onRetryGroups,
    onConfirm,
    onClose,
}) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<DailyStyleSelection | null>(selection);
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

    // 每次打开都从账号现在的选择开始，停在它那一组。只看 isOpen：开着的时候 selection 变了（换歌带回来）不该冲掉选到一半的草稿。
    useEffect(() => {
        if (!isOpen) return;
        setDraft(selection);
        setActiveGroupId(selection?.groupId ?? null);
    }, [isOpen]);

    const activeGroup = groups.find(group => group.id === activeGroupId) ?? groups[0];
    const canConfirm = Boolean(draft && draft.tagIds.length > 0);

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            size="m"
            title={t('home.dailyStylePickerTitle')}
            description={t('home.dailyStylePickerDescription')}
            footer={(
                <>
                    <SheetButton onClick={onClose}>{t('status.cancel')}</SheetButton>
                    <SheetButton variant="primary" disabled={!canConfirm} onClick={() => draft && onConfirm(draft)}>
                        {t('status.confirm')}
                    </SheetButton>
                </>
            )}
        >
            {groups.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-[13px] text-[color:var(--st-t2)]">
                    {groupsFailed ? (
                        <>
                            {t('home.dailyStyleGroupsFailed')}
                            <button type="button" onClick={onRetryGroups} className="text-[color:var(--st-t1)] underline underline-offset-2">
                                {t('ui.retry')}
                            </button>
                        </>
                    ) : (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            {t('home.dailyStyleLoading')}
                        </>
                    )}
                </div>
            ) : (
                <>
                    <Tabs
                        tabs={groups.map(group => ({ id: group.id, label: group.name, dot: draft?.groupId === group.id && draft.tagIds.length > 0 }))}
                        activeId={activeGroup?.id ?? null}
                        onSelect={setActiveGroupId}
                        label={t('home.dailyStylePickerTitle')}
                    />
                    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={activeGroup?.name}>
                        {(activeGroup?.tags ?? []).map(tag => {
                            const checked = draft?.groupId === activeGroup?.id && draft.tagIds.includes(tag.id);
                            return (
                                <button
                                    key={tag.id}
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    onClick={() => activeGroup && setDraft(current => toggleDailyStyleTag(current, activeGroup.id, tag.id))}
                                    className={`st-t-fast inline-flex h-8 items-center gap-1 rounded-full px-3.5 text-[13px] transition-[background-color,color,box-shadow,scale] active:scale-[0.97] ${checked
                                        ? 'bg-[var(--st-accent)] pl-2.5 text-[color:var(--st-on-accent)]'
                                        : 'text-[color:var(--st-t2)] shadow-[inset_0_0_0_1px_var(--st-t3)] hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]'}`}
                                >
                                    {checked && <Check size={13} strokeWidth={2.5} aria-hidden />}
                                    {tag.name}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </ThemedDialog>
    );
};

export default DailyStylePickerDialog;
