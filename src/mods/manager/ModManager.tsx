import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Boxes, CheckSquare, CircleCheck, ExternalLink, FolderOpen, Power, RefreshCw, Store, TriangleAlert, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { DEFAULT_THEME } from '@/services/baseThemes';
import { useModsStore } from '../useModsStore';
import { FOLIUM_HOST_VERSION } from '../folium/shared';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { openOutsideLink, opensThroughDesktopApp } from '../../utils/system/outsideLink';
import { ModListItem, translateModError } from './ModListItem';
import { useModCosts } from './modCost';
import type { ModManagerClasses } from './modManagerClasses';

// src/mods/manager/ModManager.tsx
// The mod list and everything that acts on it: toolbar, zip drop install, batch selection, ffmpeg
// status and recent logs. Shared by the settings page and the palette surface; both put it under
// ModSystemSwitch, and it shows a placeholder instead of the list while that switch is off.

type ModManagerProps = {
    classes: ModManagerClasses;
    isDaylight: boolean;
    theme: Theme | null;
};

type Notice = { kind: 'ok' | 'error'; text: string };

/** Where mods are published; linked from the toolbar and from the switched-off placeholder. */
export const MOD_MARKET_URL = 'https://folium-compound.cielaniska.top/';

/** On desktop a plain link would open inside the app window; hand it to the system browser instead. */
const openLinkExternally = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!opensThroughDesktopApp()) return;
    event.preventDefault();
    void openOutsideLink(event.currentTarget.href);
};

export const ModManager: React.FC<ModManagerProps> = ({ classes, isDaylight, theme }) => {
    const { t } = useTranslation();
    const bridgeAvailable = useModsStore((state) => state.bridgeAvailable);
    const mods = useModsStore((state) => state.mods);
    const ffmpeg = useModsStore((state) => state.ffmpeg);
    const directories = useModsStore((state) => state.directories);
    const selectedModId = useModsStore((state) => state.selectedModId);
    const selectMod = useModsStore((state) => state.selectMod);
    const refresh = useModsStore((state) => state.refresh);
    const refreshFfmpeg = useModsStore((state) => state.refreshFfmpeg);
    const reloadAll = useModsStore((state) => state.reloadAll);
    const toggleMod = useModsStore((state) => state.toggleMod);
    const bindEvents = useModsStore((state) => state.bindEvents);
    const logs = useModsStore((state) => state.logs);
    const startSkipped = useModsStore((state) => state.startSkipped);
    const modSystemEnabled = useDesktopSettingsStore((state) => state.modSystemEnabled);
    // Read on a slow timer for as long as this list is on screen, and not at all otherwise.
    const costs = useModCosts(mods.map((mod) => mod.id));

    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchPending, setBatchPending] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    // Drag event depth counter: dragenter/dragleave fire per child element crossed,
    // so a plain boolean would flicker the overlay. Counting balances across the
    // whole panel; combined with pointer-events-none on the overlay it stays steady.
    const dragDepthRef = useRef(0);
    const canInstall = bridgeAvailable && modSystemEnabled;

    // The main process loads or unloads every mod when the master switch flips, so the list is
    // re-read then as well as on mount.
    useEffect(() => {
        bindEvents();
        void refresh();
    }, [bindEvents, refresh, modSystemEnabled]);

    const handleDragEnter = () => {
        dragDepthRef.current += 1;
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            setIsDragging(false);
        }
    };

    const clearDragState = () => {
        dragDepthRef.current = 0;
        setIsDragging(false);
    };

    const handleOpenDirectory = async () => {
        const result = await useModsStore.getState().openModsDirectory();
        setNotice(result.ok
            ? { kind: 'ok', text: t('mods.directoryOpened') }
            : { kind: 'error', text: translateModError(t, result.error, 'open-directory-failed') });
    };

    // Drag-and-drop zip install: resolves the OS path of the dropped File via
    // webUtils.getPathForFile (File.path was removed in modern Electron) and hands
    // it to the main process for marshalling.
    const handleDropZip = async (event: React.DragEvent) => {
        event.preventDefault();
        clearDragState();
        if (!canInstall) {
            return;
        }
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
        setInstalling(true);
        try {
            const result = await useModsStore.getState().installModFromZip(filePath);
            setNotice(result.ok
                ? { kind: 'ok', text: t('mods.installSuccess', { id: result.id ?? '' }) }
                : { kind: 'error', text: translateModError(t, result.error, 'install-failed') });
        } finally {
            setInstalling(false);
        }
    };

    /*
     * Enabling a mod opens a confirmation dialog in the main process (the
     * renderer cannot be trusted to gate code that runs with full privileges),
     * so a toggle can come back declined. A decline is a normal user choice and
     * stays silent; anything else is reported.
     */
    const handleToggleEnabled = async (modId: string, enabled: boolean) => {
        const result = await toggleMod(modId, enabled);
        if (result.ok || result.error === 'enable-declined') {
            return;
        }
        setNotice({ kind: 'error', text: translateModError(t, result.error, 'enable-failed') });
    };

    const toggleSelected = (modId: string) => {
        setSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(modId)) {
                next.delete(modId);
            } else {
                next.add(modId);
            }
            return next;
        });
    };

    // Batch enable/disable: state changes sequentially so the loader applies
    // them in order; the store refreshes itself from each response.
    const applyBatch = async (enabled: boolean) => {
        if (selectedIds.size === 0) {
            return;
        }
        setBatchPending(true);
        try {
            for (const modId of selectedIds) {
                await handleToggleEnabled(modId, enabled);
            }
        } finally {
            setBatchPending(false);
        }
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedIds(new Set());
    };

    const toolbarButtonClass = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40`;

    const marketLink = (
        <a
            href={MOD_MARKET_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openLinkExternally}
            className={`${toolbarButtonClass} ${classes.ghostButton}`}
            style={{ color: 'var(--text-primary)' }}
        >
            <Store size={12} />
            {t('mods.market')}
            <ExternalLink size={11} className="opacity-50" />
        </a>
    );

    if (!bridgeAvailable) {
        return (
            <div className={`rounded-xl border px-4 py-8 flex flex-col items-center gap-2 text-center ${classes.card}`} style={{ color: 'var(--text-secondary)' }}>
                <Boxes size={26} className="opacity-60" />
                <span className="text-sm opacity-70">{t('mods.desktopOnly')}</span>
            </div>
        );
    }

    if (!modSystemEnabled) {
        return (
            <div className={`rounded-xl border px-4 py-8 flex flex-col items-center gap-2 text-center ${classes.card}`}>
                <Power size={24} className="opacity-50" style={{ color: 'var(--text-secondary)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('mods.systemOffTitle')}</span>
                <span className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>{t('mods.systemOffHint')}</span>
                <div className="mt-2">{marketLink}</div>
            </div>
        );
    }

    return (
        <div
            className="relative flex flex-col gap-3"
            onDragEnter={handleDragEnter}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={handleDragLeave}
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
                    <span className="text-xs">{installing ? t('mods.installing') : t('mods.dropZipHint')}</span>
                </motion.div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('mods.count', { count: mods.length })}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                    {marketLink}
                    <button
                        type="button"
                        onClick={() => { void handleOpenDirectory(); }}
                        className={`${toolbarButtonClass} ${classes.ghostButton}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <FolderOpen size={12} />
                        {t('mods.openDirectory')}
                    </button>
                    <button
                        type="button"
                        onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                        disabled={mods.length === 0}
                        className={`${toolbarButtonClass} ${selectionMode ? classes.activeButton : classes.ghostButton}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {selectionMode ? <X size={12} /> : <CheckSquare size={12} />}
                        {selectionMode ? t('mods.selectionCancel') : t('mods.selectionMode')}
                    </button>
                    <button
                        type="button"
                        onClick={() => { void reloadAll(); }}
                        className={`${toolbarButtonClass} ${classes.ghostButton}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <RefreshCw size={12} />
                        {t('mods.reload')}
                    </button>
                </div>
            </div>

            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left ${classes.warning}`}>
                <TriangleAlert size={14} className="mt-px shrink-0" />
                <span className="text-[11px] leading-relaxed">
                    {t('mods.warning', { version: `${FOLIUM_HOST_VERSION.major}.${FOLIUM_HOST_VERSION.minor}` })}
                </span>
            </div>

            {startSkipped ? (
                <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left ${classes.warning}`}>
                    <Power size={14} className="mt-px shrink-0" />
                    <span className="text-[11px] leading-relaxed">{t('mods.startSkippedBanner')}</span>
                </div>
            ) : null}

            {notice ? (
                <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-left ${notice.kind === 'ok' ? classes.success : classes.danger}`}>
                    {notice.kind === 'ok' ? <CircleCheck size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
                    <span className="break-all flex-1">{notice.text}</span>
                    <button type="button" onClick={() => setNotice(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label={t('mods.selectionCancel')}>
                        <X size={13} />
                    </button>
                </div>
            ) : null}

            {!ffmpeg.available ? (
                <button
                    type="button"
                    onClick={() => { void refreshFfmpeg(); }}
                    className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-opacity hover:opacity-90 ${classes.danger}`}
                >
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                        <TriangleAlert size={14} />
                        {t('mods.ffmpegMissing')}
                    </span>
                    <span className="text-[11px] opacity-75 break-all">{t('mods.ffmpegMissingHint')}</span>
                </button>
            ) : null}

            <AnimatePresence initial={false}>
                {selectionMode ? (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                        className="overflow-hidden"
                    >
                        <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${classes.card}`}>
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('mods.selectionCount', { count: selectedIds.size })}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    disabled={batchPending || selectedIds.size === 0}
                                    onClick={() => { void applyBatch(true); }}
                                    className={`${toolbarButtonClass} ${classes.ghostButton}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {t('mods.batchEnable')}
                                </button>
                                <button
                                    type="button"
                                    disabled={batchPending || selectedIds.size === 0}
                                    onClick={() => { void applyBatch(false); }}
                                    className={`${toolbarButtonClass} ${classes.ghostButton}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {t('mods.batchDisable')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div className={`rounded-xl border overflow-hidden ${classes.card}`}>
                {mods.map((mod, index) => (
                    <ModListItem
                        key={mod.id}
                        mod={mod}
                        cost={costs[mod.id]}
                        expanded={selectedModId === mod.id && !selectionMode}
                        selected={selectedIds.has(mod.id)}
                        selectionMode={selectionMode}
                        isLast={index === mods.length - 1}
                        isDaylight={isDaylight}
                        theme={theme ?? DEFAULT_THEME}
                        classes={classes}
                        onToggleExpand={() => selectMod(selectedModId === mod.id ? null : mod.id)}
                        onToggleEnabled={() => { void handleToggleEnabled(mod.id, !mod.enabled); }}
                        onToggleSelected={() => toggleSelected(mod.id)}
                        onNotice={setNotice}
                    />
                ))}
                {mods.length === 0 ? (
                    <div className="px-4 py-8 flex flex-col items-center gap-2 text-center" style={{ color: 'var(--text-secondary)' }}>
                        <Upload size={22} className="opacity-50" />
                        <span className="text-sm opacity-70">{t('mods.empty')}</span>
                        <span className="text-xs opacity-50">{t('mods.dropZipHint')}</span>
                        {directories.length > 0 ? (
                            <span className="mt-1 break-all font-mono text-[10px] opacity-40">{directories[0]}</span>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {logs.length > 0 ? (
                <div className={`rounded-xl border px-4 py-3 flex flex-col gap-1 text-left ${classes.card}`} style={{ color: 'var(--text-secondary)' }}>
                    <div className="text-[11px] font-medium opacity-60">{t('mods.recentLogs')}</div>
                    {logs.slice(-4).reverse().map((entry, index) => (
                        <div key={`${entry.message}-${index}`} className="font-mono text-[10px] opacity-50 truncate">
                            [{entry.level}] {entry.message}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

export default ModManager;
