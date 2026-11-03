import React from 'react';
import { PRIMARY_MODIFIER_LABEL } from '../../utils/platform';

// src/components/ponder/PonderKeyCap.tsx
// 思索里所有按键的画法，只此一份。
//
// 以前两处各画各的：演示里的按键是键帽，外框底下那行图例却是一串用「·」挤在一起的纯文字，
// 读者得自己从 "← → 关键帧 · [ ] 章节" 里分辨哪几个字是键、哪几个字是说明。键就画成键帽，
// 说明就是说明，一眼能分开。
//
// 修饰键分两种写法，不要混：
// - `Mod` 是「这个平台的主修饰键」，macOS 上是 Cmd，其余是 Ctrl。命令窗口的 Ctrl/Cmd+K
//   这类由 openHotkey 的 `ctrl` 声明出来的快捷键都属于它。
// - `Ctrl` 是字面意义的 Ctrl，哪个平台都是 Ctrl。页面级思索的 Ctrl+G 就是这种。

/** 脚本里写 `Mod` 的地方，落到画面上是这个。 */
export const PONDER_MODIFIER_TOKEN = 'Mod';

export const ponderModifierLabel = PRIMARY_MODIFIER_LABEL;

/**
 * 把一条快捷键写法拆成一串键帽标签。
 *
 * 脚本里用空格分隔（`'Mod K'`、`'Shift ; C'`），因为键与键之间是「同时按下」，
 * 用 `+` 拼成一整块反而看不出有几个键。
 */
export const splitPonderKeys = (combo: string): string[] => (
    combo
        .split(' ')
        .filter(Boolean)
        .map(key => (key === PONDER_MODIFIER_TOKEN ? ponderModifierLabel : key))
);

/** 安静的键帽：图例、退出按钮、提示胶囊和教程索引里的键都用这一组颜色，不抢画面。 */
export const PONDER_QUIET_CAP = { accent: 'var(--st-line2)', surface: 'var(--st-fill)', text: 'var(--st-t2)' };

type PonderKeyCapProps = {
    label: string;
    accent: string;
    surface: string;
    text: string;
};

const PonderKeyCap: React.FC<PonderKeyCapProps> = ({ label, accent, surface, text }) => (
    <kbd
        data-ponder-key-cap
        className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none shadow-sm"
        style={{ backgroundColor: surface, color: text, borderColor: accent }}
    >
        {label}
    </kbd>
);

type PonderKeyComboProps = {
    /** 空格分隔的一条快捷键，例如 `'Mod K'`。 */
    combo: string;
    accent: string;
    surface: string;
    text: string;
};

/** 一条快捷键：几个键帽并排。 */
export const PonderKeyCombo: React.FC<PonderKeyComboProps> = ({ combo, accent, surface, text }) => (
    <span data-ponder-key-combo className="inline-flex items-center gap-1">
        {splitPonderKeys(combo).map((key, index) => (
            <PonderKeyCap key={`${key}-${index}`} label={key} accent={accent} surface={surface} text={text} />
        ))}
    </span>
);

export default PonderKeyCap;
