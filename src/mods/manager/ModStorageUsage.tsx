import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatByteSize } from '@/utils/formatByteSize';
import { useModsStore } from '../useModsStore';
import type { ModRuntimeInfo } from '../types';
import type { FoliumPermissionId } from '../folium/shared';
import type { ModManagerClasses } from './modManagerClasses';
import { translateModError } from './modErrors';

// src/mods/manager/ModStorageUsage.tsx
// The expanded mod row's file section: how much the mod keeps on disk (its data directory and its
// cache) and a button that empties the cache. Shown for mods that declare `filesystem.data`, the
// permission behind `api.storage.paths`, whether or not they are enabled. A broken cache root (a stray
// file or a dead link, on which `paths.cache` throws) counts 0 but can still be cleared, which is the
// panel's only way to remove it.

/** The permission that gives a mod its data file and its `paths.data` / `paths.cache` directories. */
export const MOD_FILES_PERMISSION: FoliumPermissionId = 'filesystem.data';

/** A line for the manager's notice slot. */
export type ModNotice = { kind: 'ok' | 'error'; text: string };

type Usage = { data: number; cache: number; cacheBroken: boolean };

type ModStorageUsageProps = {
    mod: ModRuntimeInfo;
    isDaylight: boolean;
    classes: ModManagerClasses;
    onNotice: (notice: ModNotice) => void;
};

export const ModStorageUsage: React.FC<ModStorageUsageProps> = ({ mod, isDaylight, classes, onNotice }) => {
    const { t } = useTranslation();
    const [usage, setUsage] = useState<Usage | null>(null);
    const [usageError, setUsageError] = useState<string | null>(null);
    const [clearing, setClearing] = useState(false);
    // Bumped per request and on unmount, so a late answer never overwrites a newer one.
    const requestRef = useRef(0);

    /* Counts both directories in the main process; resolves the new usage, or null when stale or failed. */
    const loadUsage = useCallback(async (): Promise<Usage | null> => {
        const request = ++requestRef.current;
        const result = await useModsStore.getState().getModStorageUsage(mod.id);
        if (request !== requestRef.current) {
            return null;
        }
        if (!result.ok) {
            // Drop the last numbers too: after a clear they are stale, and the error must show.
            setUsage(null);
            setUsageError(result.error ?? 'storage-usage-failed');
            return null;
        }
        const next = { data: result.data ?? 0, cache: result.cache ?? 0, cacheBroken: result.cacheBroken === true };
        setUsage(next);
        setUsageError(null);
        return next;
    }, [mod.id]);

    useEffect(() => {
        void loadUsage();
        return () => {
            requestRef.current += 1;
        };
    }, [loadUsage]);

    /*
     * Empties the cache, then re-counts (also after a partial clear, so the numbers stay true) and
     * reports in the manager's notice line how much went. When the re-count fails (or is no longer
     * this row's), or the cache was a broken root that was never counted, how much went is unknown, so
     * the notice leaves the size out.
     */
    const handleClearCache = async () => {
        const before = usage?.cache ?? 0;
        const wasBroken = usage?.cacheBroken === true;
        setClearing(true);
        try {
            const result = await useModsStore.getState().clearModCache(mod.id);
            const after = await loadUsage();
            onNotice(result.ok
                ? {
                    kind: 'ok',
                    text: after && !wasBroken
                        ? t('mods.cacheCleared', {
                            name: mod.name,
                            size: formatByteSize(Math.max(0, before - after.cache)),
                        })
                        : t('mods.cacheClearedUncounted', { name: mod.name }),
                }
                : { kind: 'error', text: translateModError(t, result.error, 'cache-clear-failed') });
        } finally {
            setClearing(false);
        }
    };

    const sizeText = (bytes: number | undefined) => (usage ? formatByteSize(bytes ?? 0) : '…');

    return (
        <div
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${isDaylight ? 'bg-black/[0.04]' : 'bg-white/5'}`}
            style={{ color: 'var(--text-secondary)' }}
            data-mod-storage={mod.id}
        >
            <HardDrive size={14} className="shrink-0 opacity-70" />
            <div className="min-w-0 flex-1 flex flex-col gap-0.5 tabular-nums">
                {usageError ? (
                    <span className="break-all">{translateModError(t, usageError, 'storage-usage-failed')}</span>
                ) : (
                    <>
                        <span>{t('mods.storageData', { size: sizeText(usage?.data) })}</span>
                        <span>
                            {usage?.cacheBroken
                                ? t('mods.storageCacheBroken')
                                : t('mods.storageCache', { size: sizeText(usage?.cache) })}
                        </span>
                    </>
                )}
            </div>
            <button
                type="button"
                onClick={() => { void handleClearCache(); }}
                disabled={clearing || !usage || (usage.cache === 0 && !usage.cacheBroken)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${classes.ghostButton}`}
                style={{ color: 'var(--text-primary)' }}
            >
                <Eraser size={12} />
                {clearing ? t('mods.clearingCache') : t('mods.clearCache')}
            </button>
        </div>
    );
};

export default ModStorageUsage;
