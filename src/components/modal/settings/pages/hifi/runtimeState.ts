import type { HifiInstallProgress, HifiRuntimeSource, HifiRuntimeStatus } from '../../../../../types/hifi';

// src/components/modal/settings/pages/hifi/runtimeState.ts
// Where mpv stands, as the HiFi page shows it: the one line naming the mpv in use (or why there is
// none), whether a download is running, and whether a download or update is on offer. The page's
// buttons and the palette commands ask the same functions, so a command never does what the page
// would not offer.

/** A translator taking `{{name}}` values; the page passes i18next's t, the palette fills its own. */
export type RuntimeTranslate = (key: string, values?: Record<string, string>) => string;

export type RuntimeLine = { tone?: 'ok' | 'warn' | 'error'; text: string };

const SOURCE_KEYS: Record<HifiRuntimeSource, string> = {
    manual: 'hifi.settings.sourceManual',
    downloaded: 'hifi.settings.sourceDownloaded',
    system: 'hifi.settings.sourceSystem',
};

const ACTIVE_INSTALL_PHASES: ReadonlySet<HifiInstallProgress['phase']> = new Set(['downloading', 'verifying', 'extracting']);

/** The one line that says which mpv is in use, or why there is none. */
export const runtimeLine = (runtime: HifiRuntimeStatus | null, t: RuntimeTranslate): RuntimeLine => {
    if (!runtime) {
        return { text: t('hifi.settings.runtimeChecking') };
    }
    if (runtime.available) {
        const source = runtime.source ? t(SOURCE_KEYS[runtime.source]) : '';
        return { tone: 'ok', text: t('hifi.settings.runtimeFound', { version: runtime.version ?? '', source }) };
    }
    if (runtime.errorCode === 'MPV_TOO_OLD') {
        return { tone: 'warn', text: t('hifi.settings.runtimeTooOld', { version: runtime.version ?? '' }) };
    }
    return { tone: 'warn', text: t('hifi.settings.runtimeNotFound') };
};

/** The main process is downloading, verifying or unpacking an mpv. */
export const isRuntimeInstalling = (runtime: HifiRuntimeStatus | null, installProgress: HifiInstallProgress | null): boolean => (
    Boolean(runtime?.download.installing)
    || (installProgress !== null && ACTIVE_INSTALL_PHASES.has(installProgress.phase))
);

/**
 * Whether to offer the download (or the update): Folia has a build for this system (never on Linux,
 * where the distributions package mpv), none is running, and nothing is installed yet or a newer
 * one is out. False until the runtime has been asked for.
 */
export const canOfferRuntimeDownload = (
    runtime: HifiRuntimeStatus | null,
    installProgress: HifiInstallProgress | null,
    platform: string | null,
): boolean => {
    const download = runtime?.download;
    if (platform === 'linux' || !download?.supported || isRuntimeInstalling(runtime, installProgress)) {
        return false;
    }
    return download.installedVersion === null || download.updateAvailable;
};
