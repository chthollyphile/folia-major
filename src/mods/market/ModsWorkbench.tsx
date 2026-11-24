import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Boxes, CheckSquare, CircleCheck, CloudOff, Download, ExternalLink, FolderOpen, Power, RefreshCw, Store, TriangleAlert, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { DEFAULT_THEME } from '@/services/baseThemes';
import type { MenuItem } from '../../components/modal/settings/kit';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { openOutsideLink, opensThroughDesktopApp } from '../../utils/system/outsideLink';
import { FOLIUM_MARKET_ORIGIN } from '../folium/shared';
import { useModsStore } from '../useModsStore';
import { useModCosts } from '../manager/modCost';
import { translateModError } from '../manager/modErrors';
import type { ModManagerClasses } from '../manager/modManagerClasses';
import type { ModNotice } from '../manager/ModStorageUsage';
import { useModMarketStore } from './useModMarketStore';
import { switchModOn } from './modSwitch';
import { buildModViewItems, isModOn, isEmptyModsQuery, searchModViewItems, sectionModViewItems, type ModViewItem, type ModsSort } from './marketModel';
import { parseModsQuery } from './modsQuery';
import { ModsSidebar } from './ModsSidebar';
import { ModDetailPane } from './ModDetailPane';

// src/mods/market/ModsWorkbench.tsx
// The mods view, after VS Code's extensions view: installed mods and the mod market in one list on the
// left, the chosen one's detail on the right. Narrower than WIDE_MIN_PX it is one column: the list, and a
// chosen mod's detail in its place with a way back. Shown in the mods window (Settings → Mods → Open, `fill`)
// and on the palette's mods surface.
//
// Every step that trusts code is the main process's: an install checks the package's signature against the
// app's keys (market.cjs, zipInstall.cjs), enabling asks in a native dialog, and so do uninstalling and
// loading a mod past its expired `folia` range.

/** Where the market lives; the "⋯" menu and the switched-off placeholder open it in the browser. */
export const MOD_MARKET_URL = `${FOLIUM_MARKET_ORIGIN}/`;

// Where the list and a detail beside it both still have room to read.
const WIDE_MIN_PX = 600;

export type ModOps = {
    install: (modId: string) => void;
    updateAll: (modIds: string[]) => void;
    uninstall: (modId: string) => void;
    toggle: (modId: string, enabled: boolean) => void;
    tryLoad: (modIds: string[]) => void;
    revokeRange: (modId: string) => void;
    /** Turns community mods on (a native dialog); given a mod that is not installed, installs it once they are on. */
    enableCommunity: (installModId?: string) => void;
    openDirectory: () => void;
};

// Answers that are the user's own choice in a native dialog, and stay silent.
const DECLINED = new Set(['enable-declined', 'uninstall-declined', 'range-override-declined', 'community-declined']);

/** On desktop a plain link would open inside the app window; hand it to the system browser instead. */
const openLinkExternally = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!opensThroughDesktopApp()) return;
    event.preventDefault();
    void openOutsideLink(event.currentTarget.href);
};

type ModsWorkbenchProps = {
    classes: ModManagerClasses;
    isDaylight: boolean;
    theme: Theme | null;
    /** Fill a box that has a height of its own (the mods window), edge to edge, instead of drawing a card of a set height. */
    fill?: boolean;
};

export const ModsWorkbench: React.FC<ModsWorkbenchProps> = ({ classes, isDaylight, theme, fill = false }) => {
    const { t, i18n } = useTranslation();
    const bridgeAvailable = useModsStore((state) => state.bridgeAvailable);
    const mods = useModsStore((state) => state.mods);
    const ffmpeg = useModsStore((state) => state.ffmpeg);
    const directories = useModsStore((state) => state.directories);
    const selectedModId = useModsStore((state) => state.selectedModId);
    const refresh = useModsStore((state) => state.refresh);
    const refreshFfmpeg = useModsStore((state) => state.refreshFfmpeg);
    const reloadAll = useModsStore((state) => state.reloadAll);
    const toggleMod = useModsStore((state) => state.toggleMod);
    const bindEvents = useModsStore((state) => state.bindEvents);
    const logs = useModsStore((state) => state.logs);
    const startSkipped = useModsStore((state) => state.startSkipped);
    const modSystemEnabled = useDesktopSettingsStore((state) => state.modSystemEnabled);
    const catalog = useModMarketStore((state) => state.catalog);
    const catalogLoading = useModMarketStore((state) => state.loading);
    const catalogError = useModMarketStore((state) => state.error);
    const catalogStale = useModMarketStore((state) => state.stale);
    const progress = useModMarketStore((state) => state.progress);
    const autoCheck = useModMarketStore((state) => state.autoCheck);
    const costs = useModCosts(mods.map((mod) => mod.id));

    const rootRef = useRef<HTMLDivElement>(null);
    const width = useElementWidth(rootRef);
    const wide = width === 0 || width >= WIDE_MIN_PX;

    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<ModsSort>('updated');
    const [activeKey, setActiveKey] = useState<string | null>(selectedModId ? `mod:${selectedModId}` : null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
    const [notice, setNotice] = useState<ModNotice | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [installingZip, setInstallingZip] = useState(false);
    const dragDepthRef = useRef(0);
    const canInstall = bridgeAvailable && modSystemEnabled;

    // The main process loads or unloads every mod when the master switch flips, so the list is read again then.
    useEffect(() => {
        bindEvents();
        void refresh();
        if (modSystemEnabled) void useModMarketStore.getState().load();
    }, [bindEvents, refresh, modSystemEnabled]);

    // A palette command asked for a search ("@updates"): show it, with the list in view.
    const requestedQuery = useModMarketStore((state) => state.requestedQuery);
    useEffect(() => {
        if (requestedQuery === null) return;
        const next = useModMarketStore.getState().takeRequestedQuery();
        if (next === null) return;
        setQuery(next);
        setActiveKey(null);
        useModsStore.getState().selectMod(null);
    }, [requestedQuery]);

    // Something else chose a mod (a fault notice, a settings search): show it.
    useEffect(() => {
        if (selectedModId) setActiveKey(`mod:${selectedModId}`);
    }, [selectedModId]);

    const categoryLabel = useCallback((id: string) => {
        const category = catalog?.categories.find((entry) => entry.id === id);
        if (!category) return id === 'other' ? t('mods.view.categoryOther') : id;
        return i18n.language.startsWith('zh') ? category.label['zh-CN'] : category.label.en;
    }, [catalog, i18n.language, t]);

    const items = useMemo(() => buildModViewItems(mods, catalog, categoryLabel), [mods, catalog, categoryLabel]);
    const parsed = useMemo(() => parseModsQuery(query), [query]);
    const searching = !isEmptyModsQuery(parsed);
    const results = useMemo(() => (searching ? searchModViewItems(items, parsed, sort) : null), [items, parsed, searching, sort]);
    const sections = useMemo(() => (searching ? null : sectionModViewItems(items, catalog?.categories ?? [], sort)), [items, catalog, searching, sort]);
    const activeItem = items.find((item) => item.key === activeKey) ?? null;
    // Wide, the detail side is never empty while there is anything to show.
    const shownItem = activeItem ?? (wide ? (results?.[0] ?? sections?.[0]?.items[0] ?? null) : null);

    const report = useCallback((answer: { ok: boolean; error?: string }, fallback: string, success?: string) => {
        if (answer.ok) {
            if (success) setNotice({ kind: 'ok', text: success });
            return;
        }
        if (answer.error && DECLINED.has(answer.error)) return;
        setNotice({ kind: 'error', text: translateModError(t, answer.error, fallback) });
    }, [t]);

    const ops: ModOps = useMemo(() => {
        const market = () => useModMarketStore.getState();
        const install = async (modId: string) => {
            const before = useModsStore.getState().mods.find((mod) => mod.id === modId);
            const answer = await market().install(modId);
            const name = market().catalog?.mods.find((entry) => entry.id === modId)?.name ?? modId;
            report(answer, 'install-failed', before ? t('mods.view.updated', { name }) : t('mods.view.installed', { name }));
            // New files land disabled (their approval is bound to the old ones): the one confirmation follows at once
            // for a new install and for an update of a mod that was on.
            if (answer.ok && (!before || before.enabled)) {
                const enabled = await toggleMod(modId, true);
                report(enabled, 'enable-failed');
            }
        };
        return {
            install: (modId) => { void install(modId); },
            updateAll: (modIds) => {
                void (async () => {
                    for (const modId of modIds) await install(modId);
                })();
            },
            uninstall: (modId) => {
                void market().uninstall(modId).then((answer) => report(answer, 'uninstall-failed', t('mods.view.uninstalled', { id: modId })));
            },
            toggle: (modId, on) => {
                const mod = useModsStore.getState().mods.find((entry) => entry.id === modId);
                if (!mod) return;
                void switchModOn(mod, on, toggleMod).then((answer) => report(answer, 'enable-failed'));
            },
            tryLoad: (modIds) => {
                void market().allowExpired(modIds).then((answer) => report(answer, 'range-override-failed'));
            },
            revokeRange: (modId) => {
                void market().revokeExpired(modId).then((answer) => report(answer, 'range-override-failed'));
            },
            enableCommunity: (installModId) => {
                void (async () => {
                    const on = await useDesktopSettingsStore.getState().handleToggleCommunityMods(true);
                    await market().load();
                    if (on && installModId) await install(installModId);
                })();
            },
            openDirectory: () => {
                void useModsStore.getState().openModsDirectory().then((answer) => report(answer, 'open-directory-failed', t('mods.directoryOpened')));
            },
        };
    }, [report, t, toggleMod]);

    const updatable = items.filter((item) => item.hasUpdate).map((item) => item.id);

    const moreItems: MenuItem[] = [
        { id: 'refresh', label: t('mods.view.refreshMarket'), icon: RefreshCw, onSelect: () => { void useModMarketStore.getState().load({ force: true }); } },
        { id: 'updateAll', label: t('mods.view.updateAll'), icon: Download, disabled: updatable.length === 0, onSelect: () => ops.updateAll(updatable) },
        { id: 'directory', label: t('mods.openDirectory'), icon: FolderOpen, onSelect: () => ops.openDirectory() },
        { id: 'reload', label: t('mods.view.reloadMods'), icon: Power, onSelect: () => { void reloadAll(); } },
        { id: 'select', label: selectionMode ? t('mods.selectionCancel') : t('mods.selectionMode'), icon: CheckSquare, onSelect: () => toggleSelectionMode() },
        { id: 'autoCheck', label: t('mods.view.autoCheck'), chosen: autoCheck, onSelect: () => useModMarketStore.getState().setAutoCheck(!autoCheck) },
        { id: 'site', label: t('mods.view.openSite'), icon: ExternalLink, onSelect: () => { void openOutsideLink(MOD_MARKET_URL); } },
    ];

    function toggleSelectionMode() {
        setSelectionMode((on) => !on);
        setCheckedIds(new Set());
    }

    const applyBatch = async (enabled: boolean) => {
        for (const modId of checkedIds) {
            const mod = useModsStore.getState().mods.find((entry) => entry.id === modId);
            // One already as asked is left alone: switching a source mod's sources would lose how each was set.
            if (!mod || isModOn(mod) === enabled) continue;
            const answer = await switchModOn(mod, enabled, toggleMod);
            report(answer, 'enable-failed');
        }
    };

    const handleDropZip = async (event: React.DragEvent) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDragging(false);
        if (!canInstall) return;
        const file = event.dataTransfer.files?.[0];
        if (!file || !file.name.toLowerCase().endsWith('.zip')) {
            setNotice({ kind: 'error', text: t('mods.dropZipHint') });
            return;
        }
        const filePath = window.electron?.webUtils?.getPathForFile(file);
        if (!filePath) {
            setNotice({ kind: 'error', text: t('mods.errors.install-no-path') });
            return;
        }
        setInstallingZip(true);
        try {
            const answer = await useModsStore.getState().installModFromZip(filePath);
            report(answer, 'install-failed', t('mods.installSuccess', { id: answer.id ?? '' }));
            if (answer.ok && answer.id) setActiveKey(`mod:${answer.id}`);
        } finally {
            setInstallingZip(false);
        }
    };

    if (!bridgeAvailable) {
        return (
            <div className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-8 text-center ${classes.card}`} style={{ color: 'var(--text-secondary)' }}>
                <Boxes size={26} className="opacity-60" />
                <span className="text-sm opacity-70">{t('mods.desktopOnly')}</span>
            </div>
        );
    }

    if (!modSystemEnabled) {
        return (
            <div className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-8 text-center ${classes.card}`}>
                <Power size={24} className="opacity-50" style={{ color: 'var(--text-secondary)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('mods.systemOffTitle')}</span>
                <span className="max-w-[360px] text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{t('mods.systemOffHint')}</span>
                <a href={MOD_MARKET_URL} target="_blank" rel="noopener noreferrer" onClick={openLinkExternally} className="mt-2 inline-flex items-center gap-1.5 text-xs underline underline-offset-2" style={{ color: 'var(--text-primary)' }}>
                    <Store size={12} />
                    {t('mods.market')}
                </a>
            </div>
        );
    }

    const status = (
        <>
            {startSkipped ? (
                <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${classes.warning}`}>
                    <Power size={13} className="mt-px shrink-0" />
                    <span>{t('mods.startSkippedBanner')}</span>
                </div>
            ) : null}
            {catalogError && !catalog ? (
                <button type="button" onClick={() => { void useModMarketStore.getState().load({ force: true }); }} className="flex items-start gap-2 rounded-lg bg-[var(--st-fill)] px-2.5 py-2 text-left text-[11px] text-[color:var(--st-t2)] hover:bg-[var(--st-fill2)]">
                    <CloudOff size={13} className="mt-px shrink-0" />
                    <span>{t('mods.view.marketUnavailable')}</span>
                </button>
            ) : catalogStale ? (
                <div className="flex items-start gap-2 px-1 text-[11px] text-[color:var(--st-t3)]">
                    <CloudOff size={12} className="mt-px shrink-0" />
                    <span>{t('mods.view.marketStale')}</span>
                </div>
            ) : catalogLoading && !catalog ? (
                <div className="px-1 text-[11px] text-[color:var(--st-t3)]">{t('mods.view.marketLoading')}</div>
            ) : null}
            {notice ? (
                <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs ${notice.kind === 'ok' ? classes.success : classes.danger}`}>
                    {notice.kind === 'ok' ? <CircleCheck size={13} className="shrink-0" /> : <AlertCircle size={13} className="shrink-0" />}
                    <span className="flex-1 break-all">{notice.text}</span>
                    <button type="button" onClick={() => setNotice(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label={t('mods.selectionCancel')}>
                        <X size={13} />
                    </button>
                </div>
            ) : null}
            {!ffmpeg.available && mods.some((mod) => mod.permissions.includes('render.export')) ? (
                <button type="button" onClick={() => { void refreshFfmpeg(); }} className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left ${classes.danger}`}>
                    <span className="flex items-center gap-1.5 text-xs font-medium"><TriangleAlert size={13} />{t('mods.ffmpegMissing')}</span>
                    <span className="break-all text-[11px] opacity-75">{t('mods.ffmpegMissingHint')}</span>
                </button>
            ) : null}
            {selectionMode ? (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--st-fill)] px-2.5 py-1.5">
                    <span className="text-[11.5px] text-[color:var(--st-t2)]">{t('mods.selectionCount', { count: checkedIds.size })}</span>
                    <span className="flex items-center gap-1">
                        <button type="button" disabled={checkedIds.size === 0} onClick={() => { void applyBatch(true); }} className="rounded-md px-2 py-0.5 text-[11.5px] text-[color:var(--st-t1)] hover:bg-[var(--st-fill2)] disabled:opacity-40">{t('mods.batchEnable')}</button>
                        <button type="button" disabled={checkedIds.size === 0} onClick={() => { void applyBatch(false); }} className="rounded-md px-2 py-0.5 text-[11.5px] text-[color:var(--st-t1)] hover:bg-[var(--st-fill2)] disabled:opacity-40">{t('mods.batchDisable')}</button>
                        <button type="button" onClick={toggleSelectionMode} className="rounded-md px-2 py-0.5 text-[11.5px] text-[color:var(--st-t2)] hover:bg-[var(--st-fill2)]">{t('mods.selectionCancel')}</button>
                    </span>
                </div>
            ) : null}
        </>
    );

    const sidebar = (
        <ModsSidebar
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onSortChange={setSort}
            sections={sections}
            results={results}
            categories={catalog?.categories ?? []}
            categoryLabel={categoryLabel}
            activeKey={shownItem?.key ?? null}
            selectionMode={selectionMode}
            checkedIds={checkedIds}
            progress={progress}
            moreItems={moreItems}
            status={status}
            isDaylight={isDaylight}
            theme={theme ?? DEFAULT_THEME}
            classes={classes}
            ops={ops}
            onOpen={(item: ModViewItem) => {
                setActiveKey(item.key);
                if (item.kind === 'mod') useModsStore.getState().selectMod(item.id);
            }}
            onToggleChecked={(modId) => setCheckedIds((previous) => {
                const next = new Set(previous);
                if (next.has(modId)) next.delete(modId);
                else next.add(modId);
                return next;
            })}
        />
    );

    const detail = shownItem ? (
        <ModDetailPane
            item={shownItem}
            narrow={!wide}
            cost={costs[shownItem.id]}
            progress={progress[shownItem.id] ?? null}
            isDaylight={isDaylight}
            theme={theme ?? DEFAULT_THEME}
            classes={classes}
            ops={ops}
            onBack={() => {
                setActiveKey(null);
                useModsStore.getState().selectMod(null);
            }}
            onNotice={setNotice}
        />
    ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[color:var(--st-t3)]">
            <Upload size={22} className="opacity-60" />
            <span className="text-[13px]">{t('mods.empty')}</span>
            <span className="text-xs">{t('mods.dropZipHint')}</span>
            {directories.length > 0 ? <span className="mt-1 break-all font-mono text-[10px] opacity-70">{directories[0]}</span> : null}
        </div>
    );

    const recentLogs = logs.length > 0 ? (
        <details className="mt-2 px-1 text-[color:var(--st-t3)]">
            <summary className="cursor-pointer text-[11px]">{t('mods.recentLogs')}</summary>
            {logs.slice(-6).reverse().map((entry, index) => (
                <div key={`${entry.message}-${index}`} className="truncate font-mono text-[10px]">[{entry.level}] {entry.message}</div>
            ))}
        </details>
    ) : null;

    return (
        <div
            ref={rootRef}
            data-mods-workbench={wide ? 'wide' : 'narrow'}
            className={fill ? 'relative h-full' : 'relative'}
            onDragEnter={() => { dragDepthRef.current += 1; setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => {
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setIsDragging(false);
            }}
            onDrop={handleDropZip}
        >
            {isDragging ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed backdrop-blur-md"
                    style={{
                        borderColor: theme?.accentColor ?? (isDaylight ? '#52525b' : 'rgba(255,255,255,0.45)'),
                        backgroundColor: isDaylight ? 'rgba(250,250,252,0.82)' : 'rgba(24,24,28,0.78)',
                        color: 'var(--text-primary)',
                    }}
                >
                    <Upload size={22} className="opacity-80" />
                    <span className="text-xs">{installingZip ? t('mods.installing') : t('mods.dropZipHint')}</span>
                </motion.div>
            ) : null}

            {wide ? (
                <div
                    className={fill
                        ? 'grid h-full grid-cols-[minmax(300px,36%)_minmax(0,1fr)] border-t border-[var(--st-line)]'
                        : `grid grid-cols-[minmax(248px,42%)_minmax(0,1fr)] overflow-hidden rounded-xl border ${classes.card}`}
                    style={fill ? undefined : { height: 'clamp(480px, calc(100vh - 240px), 920px)' }}
                >
                    <div className={`st-scroll min-h-0 overflow-y-auto border-r p-2 ${classes.divider}`}>
                        {sidebar}
                        {recentLogs}
                    </div>
                    <div className={`st-scroll min-h-0 overflow-y-auto ${fill ? 'px-7 py-5' : 'px-5 py-4'}`}>{detail}</div>
                </div>
            ) : (
                <div className={fill ? 'st-scroll h-full overflow-y-auto border-t border-[var(--st-line)] p-2' : `rounded-xl border p-2 ${classes.card}`}>
                    {shownItem ? <div className="p-2">{detail}</div> : (
                        <>
                            {sidebar}
                            {recentLogs}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default ModsWorkbench;
