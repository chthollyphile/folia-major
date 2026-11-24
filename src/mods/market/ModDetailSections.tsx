import React from 'react';
import { Copy, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { SettingsToggle } from '../../components/modal/settings/SettingsRow';
import { omni } from '@/services/onlineMusic/omni';
import { openSettings } from '@/stores/useSettingsModalStore';
import type { ModMarketEntry, ModRuntimeInfo } from '../types';
import { isModOn } from './marketModel';
import { ModSurfaceRenderer } from '../manager/ModSurfaceRenderer';
import { setFoliumFaultNoticeMuted, useFoliumStatusStore } from '../runtime/status';
import { ModCostLines } from '../manager/ModCostLines';
import type { ModCost } from '../manager/modCost';
import type { ModManagerClasses } from '../manager/modManagerClasses';
import { translateModError } from '../manager/modErrors';
import { MOD_FILES_PERMISSION, ModStorageUsage, type ModNotice } from '../manager/ModStorageUsage';
import { useFoliumOldNameStore } from '../folium/deprecated/warnings';
import { SignatureNotice } from '../manager/ModSignatureMarks';

// src/mods/market/ModDetailSections.tsx
// The tabs of a mod's detail pane past its README: its own settings, what it may do and which Folia it
// is for, how it runs, and its version and signature. What the old expanded row of the list held lives here.

const NO_OLD_NAMES: readonly string[] = [];

const Line: React.FC<{ children: React.ReactNode; tone?: 'muted' }> = ({ children }) => (
    <div className="text-[12px] leading-[19px] text-[color:var(--st-t2)]">{children}</div>
);

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--st-t3)]">{children}</div>
);

/* The mod's own settings surface; only a running mod has one to show. */
export const ModSettingsSection: React.FC<{ mod: ModRuntimeInfo; theme: Theme; isDaylight: boolean }> = ({ mod, theme, isDaylight }) => {
    const { t } = useTranslation();
    if (mod.status === 'loaded') return <ModSurfaceRenderer modId={mod.id} theme={theme} isDaylight={isDaylight} />;
    return (
        <Line>
            {mod.status === 'skipped' ? t('mods.skippedThisRun') : isModOn(mod) ? t('mods.notLoaded') : t('mods.modDisabledHint')}
        </Line>
    );
};

/*
 * Folium 1.7: the platforms the mod may call as the user through the experimental platform.raw
 * (`platform.<id>.read` / `.write`), by their names in the app.
 */
const platformGrantsOf = (permissions: readonly string[], access: 'read' | 'write'): string[] => permissions
    .map((permission) => /^platform\.([^.]+)\.(read|write)$/.exec(permission))
    .filter((match): match is RegExpExecArray => match !== null && match[2] === access)
    .map((match) => omni.getProviderLabel(match[1]));

// The permissions whose meaning gets a sentence of its own.
const PERMISSION_HINTS: Array<[string, string]> = [
    ['playback.queue', 'mods.queueReplaceHint'],
    ['equalizer.control', 'mods.equalizerControlHint'],
    ['visualizer.renderQuality', 'mods.renderQualityHint'],
    ['visualizer.mode', 'mods.visualizerModeHint'],
    ['visualizer.tuning', 'mods.visualizerTuningHint'],
    ['visualizer.beatEffects', 'mods.visualizerBeatEffectsHint'],
    ['visualizer.background', 'mods.visualizerBackgroundHint'],
    ['visualizer.animationIntensity', 'mods.visualizerAnimationIntensityHint'],
    ['theme.write', 'mods.themeWriteHint'],
];

const permissionKey = (permission: string) => `mods.view.permissions.${permission.replace(/\./g, '_')}`;

/* What the mod may do, and which Folia it says it is for; from its manifest when installed, else from the catalog. */
export const ModPermissionsSection: React.FC<{ installed: ModRuntimeInfo | null; market: ModMarketEntry | null }> = ({ installed, market }) => {
    const { t } = useTranslation();
    const permissions = installed?.permissions ?? market?.permissions ?? [];
    const experimental = installed?.experimental ?? market?.experimental ?? [];
    const embedOrigins = installed?.embedOrigins ?? market?.embedOrigins ?? [];
    const folia = installed ? installed.folia : market?.folia ?? null;
    const hasMain = installed?.hasMain ?? market?.hasMain ?? false;
    const readPlatforms = platformGrantsOf(permissions, 'read');
    const writePlatforms = platformGrantsOf(permissions, 'write');
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <Heading>{t('mods.view.permissionsHeading')}</Heading>
                {permissions.length === 0 ? <Line>{t('mods.view.noPermissions')}</Line> : (
                    <ul className="flex flex-col gap-1">
                        {permissions.map((permission) => (
                            <li key={permission} className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-[19px]">
                                <span className="text-[color:var(--st-t1)]">{t(permissionKey(permission), { defaultValue: permission })}</span>
                                <code className="font-mono text-[10.5px] text-[color:var(--st-t3)]">{permission}</code>
                            </li>
                        ))}
                    </ul>
                )}
                {hasMain ? <Line>{t('mods.view.hasMain')}</Line> : null}
                {PERMISSION_HINTS.filter(([permission]) => permissions.includes(permission)).map(([permission, key]) => (
                    <Line key={permission}>{t(key)}</Line>
                ))}
                {readPlatforms.length > 0 ? (
                    <Line>
                        {t('mods.platformReadHint', { platforms: readPlatforms.join(' / ') })}
                        {writePlatforms.length > 0 ? ` ${t('mods.platformWriteHint', { platforms: writePlatforms.join(' / ') })}` : ''}
                    </Line>
                ) : null}
            </div>
            {embedOrigins.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    <Heading>{t('mods.view.embedHeading')}</Heading>
                    {embedOrigins.map((origin) => <code key={origin} className="font-mono text-[11px] text-[color:var(--st-t2)]">{origin}</code>)}
                </div>
            ) : null}
            {experimental.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    <Heading>{t('mods.view.experimentalHeading')}</Heading>
                    <Line>{t('mods.view.experimentalHint')}</Line>
                    <div className="flex flex-wrap gap-1">
                        {experimental.map((feature) => (
                            <code key={feature} className="rounded bg-[var(--st-fill)] px-1.5 py-0.5 font-mono text-[10.5px] text-[color:var(--st-t2)]">{feature}</code>
                        ))}
                    </div>
                </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
                <Heading>{t('mods.view.compatHeading')}</Heading>
                <Line>{folia ? t('mods.view.foliaRange', { range: folia }) : t('mods.view.foliaAny')}</Line>
                {installed?.folium ? <Line>{t('mods.view.foliumVersion', { version: installed.folium })}</Line> : null}
            </div>
        </div>
    );
};

/* How an installed mod runs: its state and errors, the fault notice switch, its cost and its files. */
export const ModRuntimeSection: React.FC<{
    mod: ModRuntimeInfo;
    cost?: ModCost;
    isDaylight: boolean;
    theme: Theme;
    classes: ModManagerClasses;
    feedback: React.ReactNode;
    onNotice: (notice: ModNotice) => void;
}> = ({ mod, cost, isDaylight, theme, classes, feedback, onNotice }) => {
    const { t } = useTranslation();
    const noticeMuted = useFoliumStatusStore((state) => state.mutedNotices.includes(mod.id));
    // Folium 1.6 only: the old names the mod uses, its mod.json's and main entry's, then its client's (folium/deprecated/).
    const clientOldNames = useFoliumOldNameStore((state) => state.byMod[mod.id] ?? NO_OLD_NAMES);
    const oldNames = [...(mod.warnings ?? []), ...clientOldNames];
    const runningCost = mod.status === 'loaded' ? cost : undefined;
    return (
        <div className="flex flex-col gap-3">
            {mod.trustStale ? (
                <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.warning}`}>
                    <TriangleAlert size={14} className="mt-px shrink-0" />
                    <span>{t('mods.trustRevoked')}</span>
                </div>
            ) : null}
            {mod.error ? (
                <div className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs ${classes.danger}`}>
                    <span className="flex items-start gap-2">
                        <TriangleAlert size={14} className="mt-px shrink-0" />
                        <span className="break-all">{translateModError(t, mod.error, 'unknown', { range: mod.folia ?? '-' })}</span>
                    </span>
                    {feedback}
                </div>
            ) : null}
            {mod.rangeOverridden ? <Line>{t('mods.view.rangeOverriddenDetail', { range: mod.folia ?? '-' })}</Line> : null}
            {/* Folium 1.6 only: the old names above (electron/modSystem/deprecated.cjs, src/mods/folium/deprecated/). */}
            {oldNames.length > 0 ? (
                <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.warning}`}>
                    <TriangleAlert size={14} className="mt-px shrink-0" />
                    <div className="flex min-w-0 flex-col gap-1">
                        <span>{t('mods.oldNames')}</span>
                        {oldNames.map((warning) => <span key={warning} className="break-words opacity-80">{warning}</span>)}
                    </div>
                </div>
            ) : null}
            {mod.devSource ? <Line>{t('mods.devSourceHint')}</Line> : null}
            {/* Folium 2.0 (plan §5.3): a source mod's sources are switched one by one in Settings → Sources. */}
            {mod.kind === 'source' ? (
                <Line>
                    {t('mods.sourceSwitchHint')}
                    {' '}
                    <button
                        type="button"
                        onClick={() => openSettings('options', 'sources', null, 'sourceList')}
                        className="underline underline-offset-2 hover:opacity-80"
                    >
                        {t('mods.sourceSwitchOpen')}
                    </button>
                </Line>
            ) : null}
            {/* The notice a failing mod raises can be turned off from the notice itself; this turns it back on. */}
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[color:var(--st-t1)]">{t('mods.faultNoticeSwitch')}</span>
                <SettingsToggle
                    checked={!noticeMuted}
                    onChange={() => setFoliumFaultNoticeMuted(mod.id, !noticeMuted)}
                    offClass={classes.toggleOff}
                    onColor={theme.secondaryColor}
                    ariaLabel={t('mods.faultNoticeSwitch')}
                />
            </div>
            {runningCost ? <ModCostLines cost={runningCost} isDaylight={isDaylight} /> : null}
            {/* Mounted with this tab, so the directories are only counted when looked at. */}
            {mod.permissions.includes(MOD_FILES_PERMISSION) ? (
                <ModStorageUsage mod={mod} isDaylight={isDaylight} classes={classes} onNotice={onNotice} />
            ) : null}
        </div>
    );
};

const Field: React.FC<{ label: string; value: string | null | undefined; mono?: boolean }> = ({ label, value, mono }) => {
    const { t } = useTranslation();
    if (!value) return null;
    return (
        <div className="grid grid-cols-[112px_1fr] gap-2 text-[12px] leading-[19px]">
            <span className="text-[color:var(--st-t3)]">{label}</span>
            <span className={`flex min-w-0 items-start gap-1.5 text-[color:var(--st-t1)] ${mono ? 'font-mono text-[11px]' : ''}`}>
                <span className="min-w-0 break-all">{value}</span>
                {mono ? (
                    <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(value).catch(() => undefined); }}
                        className="mt-0.5 shrink-0 text-[color:var(--st-t3)] hover:text-[color:var(--st-t1)]"
                        aria-label={t('mods.view.copy')}
                        title={t('mods.view.copy')}
                    >
                        <Copy size={11} />
                    </button>
                ) : null}
            </span>
        </div>
    );
};

const TIER_KEYS: Record<string, string> = {
    builtin: 'mods.view.tierBuiltin',
    override: 'mods.view.tierOverride',
    user: 'mods.view.tierUser',
    repo: 'mods.view.tierRepo',
    resources: 'mods.view.tierResources',
};

/* The installed and listed versions, the signature and the package's checksums. */
export const ModVersionSection: React.FC<{
    installed: ModRuntimeInfo | null;
    market: ModMarketEntry | null;
    isDaylight: boolean;
    classes: ModManagerClasses;
}> = ({ installed, market, isDaylight, classes }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-3">
            {installed ? <SignatureNotice mod={installed} isDaylight={isDaylight} classes={classes} /> : null}
            <div className="flex flex-col gap-1">
                <Field label={t('mods.view.installedVersion')} value={installed?.version} />
                <Field label={t('mods.view.marketVersion')} value={market?.version} />
                <Field label={t('mods.view.where')} value={installed?.tier ? t(TIER_KEYS[installed.tier] ?? installed.tier, { defaultValue: installed.tier }) : null} />
                <Field label={t('mods.view.channel')} value={market ? t(market.channel === 'beta' ? 'mods.signatureBeta' : market.origin === 'official' ? 'mods.view.originOfficial' : 'mods.view.originCommunity') : null} />
                <Field label={t('mods.view.signedAt')} value={installed?.signature.signedAt ?? market?.signedAt} />
                <Field label={t('mods.view.updatedAt')} value={market?.updatedAt} />
                <Field label={t('mods.view.key')} value={installed?.signature.keyLabel ?? market?.keyLabel} />
                <Field label={t('mods.view.digest')} value={market?.digest} mono />
                <Field label={t('mods.view.sha256')} value={market?.download.sha256} mono />
                <Field label="id" value={installed?.id ?? market?.id} mono />
            </div>
        </div>
    );
};
