import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ScratchpadAction } from './scratchpadModel';
import ScratchpadShape from './ScratchpadShape';
import type { ScratchpadShapeKind } from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadGroupHeader.tsx
// 一组的组头（列表与画布共用）：名字、条数，以及对整组的按钮。速记簿里一组是一个来源（整组入队、整组加入歌单），
// 播放历史里一组是一天，播放队列只有一组；画布里还会在最前面加一颗「选中本组」。按钮由调用方给。
// 左缘面板的列表里组名前面有这一页的几何体，条数后面一道点缀色的短杠（mark）。

type ScratchpadGroupHeaderProps = {
    label: string;
    count: number;
    buttons: ScratchpadAction[];
    /** 组名前面画这个几何体、条数后面画一道短杠（左缘面板的列表、展开整页）。 */
    mark?: ScratchpadShapeKind;
    /** 组名前面大号的字（展开整页里播放历史那一天是几号，像相册的页眉）。 */
    lead?: string;
};

const ScratchpadGroupHeader: React.FC<ScratchpadGroupHeaderProps> = ({ label, count, buttons, mark, lead }) => {
    const { t } = useTranslation();
    return (
        <div className={`scratchpad-group-header${lead ? ' is-day' : ''}`}>
            {mark && <ScratchpadShape kind={mark} size={10} fill="var(--scratchpad-mark-wall)" />}
            {lead && <span className="scratchpad-day-number">{lead}</span>}
            <span className="scratchpad-group-label">{label}</span>
            <span className="scratchpad-group-count">{t('scratchpad.count', { count })}</span>
            {mark && <span className="scratchpad-group-rule" aria-hidden="true" />}
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
