import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Tooltip } from '../../modal/settings/kit/Tooltip';
import { IconSwap } from '../shell/IconSwap';

// src/components/panelTab/controls/QuickTile.tsx
// A tile of the controls tab: an icon above a name. A toggle tile is lit while its thing is on; a
// tile that opens something carries a small arrow and can be lit too, to say that what it opens is
// in use.

type QuickTileProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'title' | 'className' | 'children'> & {
    /** toggle: pressing it turns its thing on or off. open: pressing it opens something. */
    kind: 'toggle' | 'open';
    icon: React.ReactNode;
    /** Names the icon that shows: when it changes, the new icon comes in a little small. */
    iconKey?: string;
    /** The name under the icon. */
    label: string;
    lit: boolean;
    /** Shown in the kit's tooltip. */
    tip?: string;
};

export const QuickTile: React.FC<QuickTileProps> = ({ kind, icon, iconKey, label, lit, tip, ...button }) => (
    <Tooltip text={tip} className="flex min-w-0">
        <button
            type="button"
            {...button}
            aria-pressed={kind === 'toggle' ? lit : undefined}
            className={`st-t-fast flex min-h-16 w-full min-w-0 flex-col justify-between gap-2 rounded-[10px] px-2.5 pb-[9px] pt-2.5 text-left text-xs leading-4 transition-[background-color,color,box-shadow,scale] enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 ${lit
                ? 'bg-[var(--st-raise)] text-[color:var(--st-t1)] shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
                : 'bg-[var(--st-fill)] text-[color:var(--st-t2)] enabled:hover:bg-[var(--st-fill2)]'}`}
        >
            <span className={`st-t-fast flex items-center justify-between transition-colors ${lit ? 'text-[color:var(--st-accent)]' : 'text-[color:var(--st-t3)]'}`}>
                <IconSwap name={iconKey}>{icon}</IconSwap>
                {kind === 'open' && <ChevronRight size={14} className="opacity-70" />}
            </span>
            <span className="truncate">{label}</span>
        </button>
    </Tooltip>
);

export default QuickTile;
