import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ScratchpadAction } from './scratchpadModel';

// src/components/app/scratchpad/ScratchpadGroupHeader.tsx
// 一组的组头（列表与画布共用）：名字、条数，以及对整组的按钮。速记簿里一组是一个来源（整组入队、整组加入歌单），
// 播放历史里一组是一天，播放队列只有一组；画布里还会在最前面加一颗「选中本组」。按钮由调用方给。

type ScratchpadGroupHeaderProps = {
    label: string;
    count: number;
    buttons: ScratchpadAction[];
};

const ScratchpadGroupHeader: React.FC<ScratchpadGroupHeaderProps> = ({ label, count, buttons }) => {
    const { t } = useTranslation();
    return (
        <div className="scratchpad-group-header">
            <span className="scratchpad-group-label">{label}</span>
            <span className="scratchpad-group-count">{t('scratchpad.count', { count })}</span>
            <span className="scratchpad-group-actions">
                {buttons.map(({ id, label: buttonLabel, title, icon: Icon, run, disabled }) => (
                    <button
                        key={id}
                        type="button"
                        className="scratchpad-icon-button"
                        data-scratchpad-action={id}
                        title={title ?? buttonLabel}
                        aria-label={buttonLabel}
                        disabled={disabled}
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
