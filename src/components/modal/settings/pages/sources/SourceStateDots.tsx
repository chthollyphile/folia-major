import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ModSourceState } from '../../../../../mods/types';
import { Tooltip } from '../../kit';
import { useRowAria } from '../../kit/Row';

// src/components/modal/settings/pages/sources/SourceStateDots.tsx
// 「设置 → 音源」每一行同一个控件：三个点，从左到右是启用、只用于匹配、停用，点哪个就切到哪个。选中的点变大：启用是
// 实心的强调色，只用于匹配是强调色的空心圈，停用是实心的灰。左边写着现在的状态。不能只用于匹配的音源，中间那个点
// 是灰的、点不了，悬停时（读屏在它的描述里）说为什么：不能，或者它还没在这台机器上运行过、启用一次才知道。灰的点仍能
// 用键盘停上去（aria-disabled，不是 disabled），好让读屏听到原因。

const STATES: readonly ModSourceState[] = ['enabled', 'matching', 'disabled'];

const STATE_KEYS: Readonly<Record<ModSourceState, string>> = {
    enabled: 'sourcesSettings.stateEnabled',
    matching: 'sourcesSettings.stateMatching',
    disabled: 'sourcesSettings.stateDisabled',
};

// The chosen dot of each state; the others are small and faint.
const CHOSEN_DOT: Readonly<Record<ModSourceState, string>> = {
    enabled: 'h-3 w-3 bg-[var(--st-accent)]',
    matching: 'h-3 w-3 border-2 border-[var(--st-accent)]',
    disabled: 'h-3 w-3 bg-[var(--st-t2)]',
};

type SourceStateDotsProps = {
    value: ModSourceState;
    /** The middle dot can be chosen (sourceStates.canSourceMatchOnly, or it is used only for matching now). */
    canMatchOnly: boolean;
    /** Whether `canMatchOnly` is known; a "no" that is not known yet says so. */
    matchOnlyKnown: boolean;
    disabled?: boolean;
    onChange: (state: ModSourceState) => void;
};

export const SourceStateDots: React.FC<SourceStateDotsProps> = ({ value, canMatchOnly, matchOnlyKnown, disabled, onChange }) => {
    const { t } = useTranslation();
    const rowAria = useRowAria();
    return (
        <div className={`inline-flex items-center gap-2${disabled ? ' pointer-events-none opacity-40' : ''}`}>
            <span aria-hidden className="min-w-[5.5em] whitespace-nowrap text-right text-[13px] text-[color:var(--st-t2)]">{t(STATE_KEYS[value])}</span>
            <div role="group" {...rowAria} aria-disabled={disabled || undefined} className="inline-flex h-7 items-center rounded-full bg-[var(--st-fill)] px-0.5">
                {STATES.map((state) => {
                    const chosen = state === value;
                    const unavailable = state === 'matching' && !canMatchOnly && !chosen;
                    const label = t(STATE_KEYS[state]);
                    const reason = unavailable
                        ? t(matchOnlyKnown ? 'sourcesSettings.errors.source-cannot-match-only' : 'sourcesSettings.matchOnlyUnknown')
                        : null;
                    return (
                        <Tooltip key={state} text={reason ?? label}>
                            <button
                                type="button"
                                aria-pressed={chosen}
                                aria-label={label}
                                aria-disabled={unavailable || undefined}
                                aria-description={reason ?? undefined}
                                data-source-state={state}
                                disabled={disabled}
                                onClick={() => {
                                    if (!chosen && !unavailable) onChange(state);
                                }}
                                className={`st-t-fast group grid h-6 w-6 place-items-center rounded-full transition-colors ${unavailable ? 'cursor-not-allowed' : 'enabled:hover:bg-[var(--st-fill2)]'}`}
                            >
                                <span
                                    aria-hidden
                                    className={`st-t-fast block rounded-full transition-all ${chosen
                                        ? CHOSEN_DOT[state]
                                        : `h-1.5 w-1.5 bg-[var(--st-t3)] ${unavailable ? 'opacity-30' : 'opacity-70 group-hover:h-2 group-hover:w-2 group-hover:opacity-100'}`}`}
                                />
                            </button>
                        </Tooltip>
                    );
                })}
            </div>
        </div>
    );
};

export default SourceStateDots;
