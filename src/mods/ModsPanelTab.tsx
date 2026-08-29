import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Boxes, ChevronDown, CircleOff, FolderOpen, Power, RefreshCw, TriangleAlert, CircleCheck, FileVideo2, CheckSquare, Square, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { LyricData, SongResult, Theme, VisualizerMode } from '@/types';
import { useSettingsUiStore } from '@/stores/useSettingsUiStore';
import { readLyricOffset } from '@/utils/lyrics/lyricOffsetMemory';
import type { ModRuntimeInfo } from './types';
import { resolveOnlineLyrics } from '@/utils/onlineLyricsState';
import { ModSurfaceRenderer } from './ModSurfaceRenderer';
import { pushRuntimeSnapshot } from './ipc';
import { useModsStore } from './useModsStore';

// src/mods/ModsPanelTab.tsx
// The mod manager surface rendered as a single-column accordion: each mod
// row expands in place to reveal its metadata and command surface, so the
// panel never reserves a side column and params get the full panel width.
// Mounted by the command palette's `mods` surface; the whole mod system stays
// self-contained behind the store.

interface ModsPanelTabProps {
    currentSong: SongResult | null;
    theme: Theme | null;
    visualizerMode: VisualizerMode | null;
    /**
     * The lyrics the player is actually rendering right now. Rebuilding them
     * from `currentSong.onlineLyricsState` alone is not equivalent: an ordinary
     * online match lives in neither `importedLyrics` nor `onlineOverrideLyrics`,
     * so a snapshot built that way is empty and export mods reject the song
     * with export-no-lyrics even though lyrics are on screen.
     */
    lyricData: LyricData | null;
}

/*
 * Maps a loader error code onto its localized message. Codes that have no entry
 * (a raw JS message from a mod's own failure) fall through to themselves, and
 * `value` is supplied for the messages that quote the underlying detail.
 */
const translateModError = (
    t: (key: string, options: Record<string, unknown>) => string,
    error: string | null | undefined,
    fallbackCode: string,
): string => {
    const code = error ?? fallbackCode;
    return t(`mods.errors.${code}`, { value: code, defaultValue: code });
};

const statusIcon = (status: string, isDaylight: boolean) => {
    if (status === 'loaded') return <CircleCheck size={13} className={`${isDaylight ? 'text-emerald-600' : 'text-emerald-300'} shrink-0`} />;
    if (status === 'disabled') return <CircleOff size={13} className={`${isDaylight ? 'text-zinc-400' : 'text-white/40'} shrink-0`} />;
    return <TriangleAlert size={13} className={`${isDaylight ? 'text-red-600' : 'text-red-300'} shrink-0`} />;
};

interface ModAccordionItemProps {
    mod: ModRuntimeInfo;
    expanded: boolean;
    selected: boolean;
    selectionMode: boolean;
    isDaylight: boolean;
    onToggleExpand: () => void;
    onToggleEnabled: () => void;
    onToggleSelected: () => void;
}

const ModAccordionItem: React.FC<ModAccordionItemProps> = ({
    mod, expanded, selected, selectionMode, isDaylight, onToggleExpand, onToggleEnabled, onToggleSelected,
}) => {
    const { t } = useTranslation();

    return (
        <div className={`${isDaylight ? 'bg-black/[0.04]' : 'bg-white/5'} rounded-xl overflow-hidden transition-shadow ${selected ? (isDaylight ? 'ring-1 ring-black/20' : 'ring-1 ring-white/25') : ''}`}>
            <div
                role="button"
                tabIndex={0}
                onClick={(event) => {
                    if (selectionMode) {
                        onToggleSelected();
                        return;
                    }
                    onToggleExpand();
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (selectionMode) {
                            onToggleSelected();
                        } else {
                            onToggleExpand();
                        }
                    }
                }}
                className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors ${
                    expanded && !selectionMode ? (isDaylight ? 'bg-black/[0.04]' : 'bg-white/5') : (isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/5')
                }`}
            >
                {selectionMode ? (
                    <span className={`shrink-0 ${selected ? (isDaylight ? 'text-zinc-800' : 'text-white') : (isDaylight ? 'text-zinc-400' : 'text-white/35')}`}>
                        {selected ? <CheckSquare size={14} /> : <Square size={14} />}
                    </span>
                ) : statusIcon(mod.status, isDaylight)}
                <span className="text-xs font-medium truncate flex-1 min-w-0">{mod.name}</span>
                <button
                    type="button"
                    title={mod.enabled ? t('mods.enabled') : t('mods.disabled')}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleEnabled();
                    }}
                    className={`shrink-0 p-1 rounded-md transition-colors ${
                        mod.enabled
                            ? isDaylight ? 'text-zinc-700 hover:text-zinc-900 hover:bg-black/10' : 'text-white/70 hover:text-white hover:bg-white/10'
                            : isDaylight ? 'text-zinc-400 hover:text-zinc-600 hover:bg-black/10' : 'text-white/30 hover:text-white/60 hover:bg-white/10'
                    }`}
                >
                    <Power size={13} />
                </button>
                <motion.span
                    animate={{ rotate: expanded && !selectionMode ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className={`shrink-0 ${isDaylight ? 'text-zinc-400' : 'text-white/40'}`}
                >
                    <ChevronDown size={14} />
                </motion.span>
            </div>

            <AnimatePresence initial={false}>
                {expanded ? (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                        className="overflow-hidden"
                    >
                        <div className={`px-3 pb-3 pt-2.5 flex flex-col gap-2.5 border-t ${isDaylight ? 'border-black/10' : 'border-white/5'}`}>
                            <div className="text-[11px] opacity-50 truncate">
                                {mod.id} · v{mod.version ?? '-'}
                                {mod.author ? ` · ${mod.author}` : ''}
                            </div>
                            {mod.description ? (
                                <div className="text-xs opacity-70 leading-relaxed">{mod.description}</div>
                            ) : null}
                            {mod.permissions.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {mod.permissions.map((permission) => (
                                        <span
                                            key={permission}
                                            className={`px-1.5 py-0.5 rounded ${isDaylight ? 'bg-black/[0.05]' : 'bg-white/5'} text-[10px] opacity-50`}
                                        >
                                            {permission}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {mod.trustStale ? (
                                <div className={`flex items-start gap-1.5 text-xs rounded-lg p-2 ${isDaylight ? 'text-amber-800 bg-amber-500/10' : 'text-amber-200 bg-amber-400/10'}`}>
                                    <TriangleAlert size={14} className="mt-px shrink-0" />
                                    <span>{t('mods.trustRevoked')}</span>
                                </div>
                            ) : null}
                            {mod.error ? (
                                <div className={`flex items-start gap-1.5 text-xs ${isDaylight ? 'text-red-600 bg-red-500/10' : 'text-red-300 bg-red-500/10'} rounded-lg p-2`}>
                                    <TriangleAlert size={14} className="mt-px shrink-0" />
                                    <span className="break-all">{translateModError(t, mod.error, 'unknown')}</span>
                                </div>
                            ) : null}

                            {mod.status === 'loaded' ? (
                                <ModSurfaceRenderer modId={mod.id} />
                            ) : mod.enabled ? (
                                <div className="text-xs opacity-50">{t('mods.notLoaded')}</div>
                            ) : (
                                <div className="text-xs opacity-50">{t('mods.modDisabledHint')}</div>
                            )}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
};

const ModsPanelTab: React.FC<ModsPanelTabProps> = ({
    currentSong,
    theme,
    visualizerMode,
    lyricData,
}) => {
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

    // Lift the current visualizer tunings from the settings store so exports can
    // reproduce the song's animation verbatim (rather than the default settings).
    const visualizerTunings = useSettingsUiStore(useShallow((state) => ({
        classic: state.classicTuning,
        cadenza: state.cadenzaTuning,
        partita: state.partitaTuning,
        fume: state.fumeTuning,
        claddagh: state.claddaghTuning,
        cappella: state.cappellaTuning,
        tilt: state.tiltTuning,
        diorama: state.dioramaTuning,
        monet: state.monetTuning,
        pendolo: state.pendoloTuning,
        sonnet: state.sonnetTuning,
        tempera: state.temperaTuning,
    })));
    const globalLyricTimelineOffsetMs = useSettingsUiStore((state) => state.globalLyricTimelineOffsetMs);
    const isDaylight = useSettingsUiStore((state) => state.isDaylight);

    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchPending, setBatchPending] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    // Drag event depth counter: dragenter/dragleave fire per child element crossed,
    // so a plain boolean would flicker the overlay. Counting balances across the
    // whole panel; combined with pointer-events-none on the overlay it stays steady.
    const dragDepthRef = useRef(0);

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

    useEffect(() => {
        bindEvents();
        void refresh();
    }, [bindEvents, refresh]);

    // The listener's own imported/override choice still wins; what is on screen
    // is the fallback, which is what an ordinary online match resolves to.
    const activeLyrics = useMemo(
        () => resolveOnlineLyrics(currentSong?.onlineLyricsState ?? null, lyricData ?? null),
        [currentSong?.onlineLyricsState, lyricData],
    );
    const lyricTimelineOffsetMs = globalLyricTimelineOffsetMs + (currentSong ? readLyricOffset(currentSong.id) : 0);

    // Publish the currently visible song/theme/lyrics so main-process mods can
    // act on it. Lyrics objects are replaced by reference when they change, so
    // this is a natural low-frequency dependency set.
    useEffect(() => {
        if (!bridgeAvailable) {
            return;
        }
        void pushRuntimeSnapshot({
            song: currentSong,
            songTitle: currentSong?.name ?? null,
            songArtist: currentSong?.artists?.[0]?.name ?? null,
            lyricData: activeLyrics,
            theme,
            visualizerMode,
            visualizerTunings,
            lyricTimelineOffsetMs,
        });
    }, [bridgeAvailable, currentSong, activeLyrics, theme, visualizerMode, visualizerTunings, lyricTimelineOffsetMs]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-3 relative"
            onDragEnter={handleDragEnter}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={handleDragLeave}
            onDrop={handleDropZip}
        >
            {isDragging && bridgeAvailable ? (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed backdrop-blur-md"
                    style={{
                        borderColor: theme?.accentColor ?? (isDaylight ? '#52525b' : 'rgba(255,255,255,0.45)'),
                        backgroundColor: isDaylight ? 'rgba(250,250,252,0.78)' : 'rgba(24,24,28,0.72)',
                        color: isDaylight ? '#27272a' : '#ececef',
                    }}
                >
                    <Upload size={22} className="opacity-80" />
                    <span className="text-xs">{installing ? t('mods.installing') : t('mods.dropZipHint')}</span>
                </motion.div>
            ) : null}

            {notice ? (
                <div
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] ${
                        notice.kind === 'ok'
                            ? isDaylight ? 'bg-emerald-500/10 text-emerald-700' : 'bg-emerald-500/10 text-emerald-300'
                            : isDaylight ? 'bg-red-500/10 text-red-700' : 'bg-red-500/10 text-red-300'
                    }`}
                >
                    {notice.kind === 'ok' ? <CircleCheck size={13} className="shrink-0" /> : <AlertCircle size={13} className="shrink-0" />}
                    <span className="break-all">{notice.text}</span>
                </div>
            ) : null}

            {!bridgeAvailable ? (
                <div className="flex flex-col items-center gap-2 py-8 text-sm opacity-70 text-center px-4">
                    <Boxes size={28} />
                    <span>{t('mods.desktopOnly')}</span>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between gap-2">
                        <div
                            className="text-sm font-medium flex items-center gap-2"
                            style={{ color: 'var(--text-primary, inherit)' }}
                        >
                            <FileVideo2 size={16} style={{ color: theme?.accentColor }} />
                            {t('mods.title')}
                            <span
                                title={t('mods.experimentalHint')}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-normal border ${
                                    isDaylight
                                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800'
                                        : 'border-amber-400/25 bg-amber-400/10 text-amber-200'
                                }`}
                            >
                                {t('mods.experimental')}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                title={t('mods.openDirectory')}
                                onClick={() => { void handleOpenDirectory(); }}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                    isDaylight
                                        ? 'border-black/10 bg-black/[0.04] text-zinc-800 hover:bg-black/[0.08]'
                                        : 'border-white/10 bg-white/[0.05] text-zinc-100 hover:bg-white/[0.1]'
                                }`}
                            >
                                <FolderOpen size={12} />
                                {t('mods.openDirectory')}
                            </button>
                            <button
                                type="button"
                                onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                    selectionMode
                                        ? isDaylight
                                            ? 'border-black/15 bg-black/15 text-black'
                                            : 'border-white/20 bg-white/20 text-white'
                                        : isDaylight
                                            ? 'border-black/10 bg-black/[0.04] text-zinc-800 hover:bg-black/[0.08]'
                                            : 'border-white/10 bg-white/[0.05] text-zinc-100 hover:bg-white/[0.1]'
                                }`}
                            >
                                {selectionMode ? <X size={12} /> : <CheckSquare size={12} />}
                                {selectionMode ? t('mods.selectionCancel') : t('mods.selectionMode')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { void reloadAll(); }}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                                    isDaylight
                                        ? 'border-black/10 bg-black/[0.04] text-zinc-800 hover:bg-black/[0.08]'
                                        : 'border-white/10 bg-white/[0.05] text-zinc-100 hover:bg-white/[0.1]'
                                }`}
                            >
                                <RefreshCw size={12} />
                                {t('mods.reload')}
                            </button>
                        </div>
                    </div>

                    <div
                        className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border ${
                            isDaylight ? 'border-amber-500/30 bg-amber-500/10 text-amber-800' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                        }`}
                    >
                        <TriangleAlert size={14} className="mt-px shrink-0" />
                        <span className="text-[11px] leading-relaxed">
                            {t('mods.experimentalHint')}
                            {' '}
                            {t('mods.securityWarning')}
                        </span>
                    </div>

                    <AnimatePresence initial={false}>
                        {selectionMode ? (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                                className="overflow-hidden"
                            >
                                <div
                                    className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 border ${
                                        isDaylight ? 'border-black/10 bg-black/[0.04]' : 'border-white/10 bg-white/[0.05]'
                                    }`}
                                >
                                    <span
                                        className="text-[11px] opacity-60"
                                        style={{ color: 'var(--text-secondary, inherit)' }}
                                    >
                                        {t('mods.selectionCount', { count: selectedIds.size })}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            disabled={batchPending || selectedIds.size === 0}
                                            onClick={() => { void applyBatch(true); }}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                                isDaylight
                                                    ? 'border-black/10 bg-black/[0.06] hover:bg-black/[0.1] text-zinc-800'
                                                    : 'border-white/10 bg-white/[0.1] hover:bg-white/[0.18] text-zinc-100'
                                            }`}
                                        >
                                            {t('mods.batchEnable')}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={batchPending || selectedIds.size === 0}
                                            onClick={() => { void applyBatch(false); }}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                                isDaylight
                                                    ? 'border-black/10 bg-black/[0.06] hover:bg-black/[0.1] text-zinc-800'
                                                    : 'border-white/10 bg-white/[0.1] hover:bg-white/[0.18] text-zinc-100'
                                            }`}
                                        >
                                            {t('mods.batchDisable')}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        ) : null}
                    </AnimatePresence>

                    {!ffmpeg.available ? (
                        <button
                            type="button"
                            onClick={() => { void refreshFfmpeg(); }}
                            className="flex flex-col gap-1 text-left bg-red-500/10 border border-red-400/20 rounded-xl p-3 hover:bg-red-500/15 transition-colors"
                        >
                            <span className="flex items-center gap-1.5 text-xs text-red-300">
                                <TriangleAlert size={14} />
                                {t('mods.ffmpegMissing')}
                            </span>
                            <span className="text-[10px] text-red-200/60 break-all">
                                {t('mods.ffmpegMissingHint')}
                            </span>
                        </button>
                    ) : null}

                    <div className="flex flex-col gap-2">
                        {mods.map((mod) => (
                            <ModAccordionItem
                                key={mod.id}
                                mod={mod}
                                expanded={selectedModId === mod.id && !selectionMode}
                                selected={selectedIds.has(mod.id)}
                                selectionMode={selectionMode}
                                isDaylight={isDaylight}
                                onToggleExpand={() => selectMod(selectedModId === mod.id ? null : mod.id)}
                                onToggleEnabled={() => { void handleToggleEnabled(mod.id, !mod.enabled); }}
                                onToggleSelected={() => toggleSelected(mod.id)}
                            />
                        ))}
                        {mods.length === 0 ? (
                            <div className="px-3 py-6 text-xs opacity-50 text-center">
                                <div>{t('mods.empty')}</div>
                                {directories.length > 0 ? (
                                    <span className="block mt-1.5 break-all text-[10px] opacity-60">
                                        {directories[0]}
                                    </span>
                                ) : null}
                            </div>
                        ) : null}

                        {logs.length > 0 ? (
                            <div className="flex flex-col gap-1 border-t border-white/5 pt-2.5 mt-1">
                                <div className="text-[10px] opacity-40">{t('mods.recentLogs')}</div>
                                {logs.slice(-4).reverse().map((entry, index) => (
                                    <div key={`${entry.message}-${index}`} className="text-[10px] opacity-50 truncate">
                                        [{entry.level}] {entry.message}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </>
            )}
        </motion.div>
    );
};

export default ModsPanelTab;