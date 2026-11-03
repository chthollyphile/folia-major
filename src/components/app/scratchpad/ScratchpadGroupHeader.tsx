import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus, SquareCheck, Star } from 'lucide-react';

// src/components/app/scratchpad/ScratchpadGroupHeader.tsx
// 一个来源组的组头（列表与画布共用）：来源、条数，以及对整组的动作——入队、加入歌单（这一组的来源允许时），
// 画布里还有「选中本组」。一组只有一个来源，所以整组能一起进同一个歌单。

type ScratchpadGroupHeaderProps = {
    label: string;
    count: number;
    canAddToPlaylist: boolean;
    onEnqueue: () => void;
    onAddToPlaylist: () => void;
    /** 只有画布给：选中这一组的全部卡片。 */
    onSelectAll?: () => void;
};

const ScratchpadGroupHeader: React.FC<ScratchpadGroupHeaderProps> = ({
    label,
    count,
    canAddToPlaylist,
    onEnqueue,
    onAddToPlaylist,
    onSelectAll,
}) => {
    const { t } = useTranslation();
    const buttons = [
        ...(onSelectAll ? [{ id: 'select-group', label: t('scratchpad.selectGroup'), icon: SquareCheck, run: onSelectAll }] : []),
        { id: 'enqueue-group', label: t('scratchpad.enqueueGroup'), icon: ListPlus, run: onEnqueue },
        ...(canAddToPlaylist ? [{ id: 'add-group-to-playlist', label: t('scratchpad.addGroupToPlaylist'), icon: Star, run: onAddToPlaylist }] : []),
    ];
    return (
        <div className="scratchpad-group-header">
            <span className="scratchpad-group-label">{label}</span>
            <span className="scratchpad-group-count">{t('scratchpad.count', { count })}</span>
            <span className="scratchpad-group-actions">
                {buttons.map(({ id, label: buttonLabel, icon: Icon, run }) => (
                    <button
                        key={id}
                        type="button"
                        className="scratchpad-icon-button"
                        data-scratchpad-action={id}
                        title={buttonLabel}
                        aria-label={buttonLabel}
                        onClick={run}
                    >
                        <Icon aria-hidden="true" />
                    </button>
                ))}
            </span>
        </div>
    );
};

export default ScratchpadGroupHeader;
