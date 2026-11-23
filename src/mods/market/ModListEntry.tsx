import React from 'react';
import { CheckSquare, ExternalLink, FlaskConical, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModMarketProgress } from '../types';
import { modSettingsRowId } from '../useModsStore';
import { SignatureBadge, StatusIcon } from '../manager/ModSignatureMarks';
import type { ModViewItem } from './marketModel';

// src/mods/market/ModListEntry.tsx
// One line of the mods list: a square icon, the name and version, one line of description, the author,
// a few marks, and at its end the one action that fits (passed in by the sidebar).

const AVATAR_HUES = [12, 38, 64, 150, 188, 212, 248, 286, 322];

const hueOf = (id: string) => {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    return AVATAR_HUES[hash % AVATAR_HUES.length];
};

/* The mod's picture, cut to a square from the middle; a letter on a colour of its id without one. */
export const ModIcon: React.FC<{ item: ModViewItem; size: number }> = ({ item, size }) => {
    const preview = item.market?.preview?.url ?? null;
    const style: React.CSSProperties = { width: size, height: size, borderRadius: Math.round(size / 4.5) };
    if (preview) {
        return (
            <span
                aria-hidden
                className="block shrink-0 bg-[var(--st-fill)] bg-cover bg-center"
                style={{ ...style, backgroundImage: `url("${preview.replace(/"/g, '%22')}")` }}
            />
        );
    }
    const hue = hueOf(item.id);
    const letter = (item.name.trim().charAt(0) || item.id.charAt(0) || '?').toUpperCase();
    return (
        <span
            aria-hidden
            className="flex shrink-0 items-center justify-center font-semibold text-white"
            style={{ ...style, fontSize: Math.round(size * 0.46), background: `linear-gradient(135deg, hsl(${hue} 52% 52%), hsl(${(hue + 36) % 360} 48% 40%))` }}
        >
            {letter}
        </span>
    );
};

export const Mark: React.FC<{ children: React.ReactNode; tone?: 'beta' | 'warn' | 'plain' }> = ({ children, tone = 'plain' }) => {
    const toneClass = tone === 'beta'
        ? 'border-violet-400/40 text-violet-500'
        : tone === 'warn'
            ? 'border-[color:var(--st-warn)]/50 text-[color:var(--st-warn)]'
            : 'border-[var(--st-line2)] text-[color:var(--st-t2)]';
    return <span className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] leading-[14px] ${toneClass}`}>{children}</span>;
};

type ModListEntryProps = {
    item: ModViewItem;
    active: boolean;
    selectionMode: boolean;
    checked: boolean;
    progress: ModMarketProgress | null;
    isDaylight: boolean;
    action: React.ReactNode;
    onOpen: () => void;
    onToggleChecked: () => void;
};

export const ModListEntry: React.FC<ModListEntryProps> = ({
    item, active, selectionMode, checked, progress, isDaylight, action, onOpen, onToggleChecked,
}) => {
    const { t } = useTranslation();
    const mod = item.installed;
    const canCheck = selectionMode && Boolean(mod);
    const activate = () => (canCheck ? onToggleChecked() : onOpen());
    const busy = progress && progress.phase !== 'error' && progress.phase !== 'done';
    const share = busy && progress.phase === 'download' && progress.total ? (progress.received ?? 0) / progress.total : null;

    return (
        <div
            role="button"
            tabIndex={0}
            aria-current={active ? 'true' : undefined}
            data-settings-row={item.kind === 'mod' ? modSettingsRowId(item.id) : undefined}
            data-mod-entry={item.key}
            onClick={activate}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate();
                }
            }}
            className={`group relative flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                active ? 'bg-[var(--st-fill2)]' : 'hover:bg-[var(--st-fill)]'
            }`}
        >
            {canCheck ? (
                <span className={`shrink-0 ${checked ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t3)]'}`}>
                    {checked ? <CheckSquare size={15} /> : <Square size={15} />}
                </span>
            ) : null}
            <span className="relative shrink-0">
                <ModIcon item={item} size={38} />
                {mod ? (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-[var(--st-card)] p-px">
                        <StatusIcon status={mod.status} error={mod.error === 'host-range-expired' ? 'community-off' : mod.error} isDaylight={isDaylight} />
                    </span>
                ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-[color:var(--st-t1)]">{item.name}</span>
                    {mod ? <SignatureBadge mod={mod} isDaylight={isDaylight} /> : item.beta ? (
                        <span title={t('mods.signatureBeta')} className={`shrink-0 ${isDaylight ? 'text-violet-600' : 'text-violet-300'}`}><FlaskConical size={13} /></span>
                    ) : null}
                    {item.version ? <span className="shrink-0 text-[11px] text-[color:var(--st-t3)]">v{item.version}</span> : null}
                </span>
                {item.description ? (
                    <span className="truncate text-[11.5px] leading-[17px] text-[color:var(--st-t2)]">{item.description}</span>
                ) : null}
                <span className="flex min-w-0 items-center gap-1.5 pt-0.5">
                    {item.author ? <span className="truncate text-[11px] text-[color:var(--st-t3)]">{item.author}</span> : null}
                    {item.kind === 'awesome' ? <Mark><ExternalLink size={9} className="-mt-px mr-0.5 inline" />{t('mods.view.markExternal')}</Mark> : null}
                    {item.beta && !mod ? <Mark tone="beta">{t('mods.signatureBeta')}</Mark> : null}
                    {item.source ? <Mark>{t('mods.kindSource')}</Mark> : null}
                    {item.builtin ? <Mark>{t('mods.signatureBuiltin')}</Mark> : null}
                    {mod?.rangeOverridden ? <Mark tone="warn">{t('mods.view.markForced')}</Mark> : null}
                    {item.rangeExpired ? <Mark tone="warn">{t('mods.view.markExpired')}</Mark> : null}
                    {mod?.error === 'community-off' ? <Mark>{t('mods.communityOffMark')}</Mark> : null}
                </span>
                {busy ? (
                    <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-[var(--st-track)]">
                        <span
                            className={`block h-full rounded-full bg-[var(--st-accent)] ${share === null ? 'w-1/3 animate-pulse' : ''}`}
                            style={share === null ? undefined : { width: `${Math.round(Math.min(1, share) * 100)}%` }}
                        />
                    </span>
                ) : null}
            </span>
            {selectionMode ? null : <span className="shrink-0" onClick={(event) => event.stopPropagation()}>{action}</span>}
        </div>
    );
};

export default ModListEntry;
