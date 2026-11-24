import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bug, Code2, Download, ExternalLink, FlaskConical, MoreHorizontal, RefreshCw, Store, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { Button, Menu, Tabs, type MenuItem } from '../../components/modal/settings/kit';
import { openOutsideLink, opensThroughDesktopApp } from '../../utils/system/outsideLink';
import type { ModMarketCategory, ModMarketProgress } from '../types';
import type { ModCost } from '../manager/modCost';
import type { ModManagerClasses } from '../manager/modManagerClasses';
import type { ModNotice } from '../manager/ModStorageUsage';
import { SignatureBadge } from '../manager/ModSignatureMarks';
import { translateModError } from '../manager/modErrors';
import { useModMarketStore } from './useModMarketStore';
import { isModOn, type ModViewItem } from './marketModel';
import { canUninstall, primaryActionOf } from './modActions';
import { modFeedbackOf } from './modFeedback';
import { ModIcon, Mark } from './ModListEntry';
import { ReadmeView } from './ReadmeView';
import { ModPermissionsSection, ModRuntimeSection, ModSettingsSection, ModVersionSection } from './ModDetailSections';
import type { ModOps } from './ModsWorkbench';

// One empty list for every render: a fresh `[]` from a store selector re-renders without end.
const NO_CATEGORIES: readonly ModMarketCategory[] = [];

// src/mods/market/ModDetailPane.tsx
// The right side of the mods view (the whole view when narrow): a mod's header with its actions and the
// links to its author, repository and tracker, then tabs. Problems go to the author, so the tracker link is
// in the header, in the "⋯" menu and beside an error.

type Tab = 'readme' | 'settings' | 'permissions' | 'runtime' | 'version';

const openLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!opensThroughDesktopApp()) return;
    event.preventDefault();
    void openOutsideLink(event.currentTarget.href);
};

const HeaderLink: React.FC<{ href: string; icon: LucideIcon; children: React.ReactNode; strong?: boolean }> = ({ href, icon: Icon, children, strong }) => (
    <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={openLink}
        className={`st-t-fast inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] transition-colors hover:bg-[var(--st-fill)] ${
            strong ? 'font-medium text-[color:var(--st-accent)]' : 'text-[color:var(--st-t2)] hover:text-[color:var(--st-t1)]'
        }`}
    >
        <Icon size={12} />
        {children}
    </a>
);

/* "向作者反馈" beside an error, or the note that there is nowhere to send it. */
export const FeedbackLine: React.FC<{ url: string | null; owner: string | null }> = ({ url, owner }) => {
    const { t } = useTranslation();
    if (!url) return <span className="text-[11px] opacity-80">{t('mods.view.noFeedback')}</span>;
    return (
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={openLink} className="inline-flex items-center gap-1 self-start text-[11.5px] font-medium underline underline-offset-2">
            <Bug size={11} />
            {owner === 'author' ? t('mods.view.reportToAuthor') : t('mods.view.reportIssue')}
        </a>
    );
};

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type ModDetailPaneProps = {
    item: ModViewItem;
    narrow: boolean;
    cost?: ModCost;
    progress: ModMarketProgress | null;
    isDaylight: boolean;
    theme: Theme;
    classes: ModManagerClasses;
    ops: ModOps;
    onBack: () => void;
    onNotice: (notice: ModNotice) => void;
};

export const ModDetailPane: React.FC<ModDetailPaneProps> = ({ item, narrow, cost, progress, isDaylight, theme, classes, ops, onBack, onNotice }) => {
    const { t, i18n } = useTranslation();
    const mod = item.installed;
    const market = item.market;
    const awesome = item.awesome;
    const busy = Boolean(progress && progress.phase !== 'error' && progress.phase !== 'done');
    const action = primaryActionOf(item, busy);
    const feedback = modFeedbackOf({ installed: mod, market, awesome });
    const readmeUrl = market?.readmeUrl ?? null;
    const readme = useModMarketStore((state) => (readmeUrl ? state.readmes[readmeUrl] : undefined));
    const loadReadme = useModMarketStore((state) => state.loadReadme);
    const catalogOrigin = useModMarketStore((state) => state.catalog?.origin ?? null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const tabs = useMemo(() => {
        const list: Array<{ id: Tab; label: string; dot?: boolean }> = [{ id: 'readme', label: t('mods.view.tabReadme') }];
        if (mod) list.push({ id: 'settings', label: t('mods.view.tabSettings') });
        if (!awesome) list.push({ id: 'permissions', label: t('mods.view.tabPermissions') });
        if (mod) list.push({ id: 'runtime', label: t('mods.view.tabRuntime'), dot: Boolean(mod.error && mod.error !== 'community-off') || mod.trustStale });
        if (!awesome) list.push({ id: 'version', label: t('mods.view.tabVersion') });
        return list;
    }, [awesome, mod, t]);
    // An installed mod opens on its own settings, the way the old list row did; anything else on its README.
    const [tab, setTab] = useState<Tab>(mod ? 'settings' : 'readme');
    // On another mod, or when this one is installed or removed; not on every refresh of the list, which hands over
    // a new `installed` object each time and would throw the user back from the tab they are reading.
    const isInstalled = Boolean(item.installed);
    useEffect(() => {
        setTab(isInstalled ? 'settings' : 'readme');
        setMenuOpen(false);
    }, [item.key, isInstalled]);
    const shownTab = tabs.some((entry) => entry.id === tab) ? tab : 'readme';

    useEffect(() => {
        if (shownTab === 'readme' && readmeUrl) void loadReadme(readmeUrl);
    }, [shownTab, readmeUrl, loadReadme]);

    const owners = market?.owners ?? awesome?.owners ?? [];
    const authorText = mod?.author ?? market?.author ?? null;

    // A source mod is on only when its sources are not all off in Settings → Sources too (isModOn).
    const modOn = mod ? isModOn(mod) : false;
    const menuItems: MenuItem[] = [
        ...(mod ? [{ id: 'toggle', label: modOn ? t('mods.view.disable') : t('mods.view.enable'), onSelect: () => ops.toggle(mod.id, !modOn) }] : []),
        ...(mod?.rangeOverridden ? [{ id: 'revoke', label: t('mods.view.revokeForced'), onSelect: () => ops.revokeRange(mod.id) }] : []),
        ...(feedback.url ? [{ id: 'feedback', label: t('mods.view.reportIssue'), icon: Bug, onSelect: () => { void openOutsideLink(feedback.url as string); } }] : []),
        { id: 'directory', label: t('mods.openDirectory'), onSelect: () => ops.openDirectory() },
        ...(canUninstall(item) && mod ? [{ id: 'uninstall', label: t('mods.view.uninstall'), onSelect: () => ops.uninstall(mod.id) }] : []),
    ];

    const primary = (() => {
        switch (action.kind) {
            case 'open': return <Button variant="primary" icon={ExternalLink} onClick={() => { void openOutsideLink(action.url); }}>{t('mods.view.openRepository')}</Button>;
            case 'busy': return <Button variant="primary" icon={Download} disabled onClick={() => {}}>{t(`mods.view.phase.${progress?.phase ?? 'download'}`)}</Button>;
            case 'install': return <Button variant="primary" icon={Download} onClick={() => ops.install(item.id)}>{t('mods.view.install')}</Button>;
            case 'update': return <Button variant="primary" icon={RefreshCw} onClick={() => ops.install(item.id)}>{t('mods.view.updateTo', { version: market?.version ?? '' })}</Button>;
            case 'tryLoad': return <Button variant="primary" onClick={() => ops.tryLoad([item.id])}>{t('mods.view.tryLoad')}</Button>;
            case 'needsFolia': return <Button disabled onClick={() => {}}>{t('mods.view.needsFolia')}</Button>;
            case 'needsCommunity': return <Button onClick={() => ops.enableCommunity(item.installed ? undefined : item.id)}>{t('mods.view.enableCommunity')}</Button>;
            case 'toggle': return mod ? (
                <Button variant={modOn ? undefined : 'primary'} onClick={() => ops.toggle(mod.id, !modOn)}>
                    {modOn ? t('mods.view.disable') : t('mods.view.enable')}
                </Button>
            ) : null;
            default: return null;
        }
    })();

    const categories = useModMarketStore((state) => state.catalog?.categories ?? NO_CATEGORIES);
    const categoryLabel = (() => {
        const category = categories.find((entry) => entry.id === item.category);
        if (!category) return null;
        return i18n.language.startsWith('zh') ? category.label['zh-CN'] : category.label.en;
    })();

    return (
        <div className="flex min-h-0 flex-col">
            {narrow ? (
                <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[12px] text-[color:var(--st-t2)] hover:bg-[var(--st-fill)]">
                    <ArrowLeft size={13} />
                    {t('mods.view.back')}
                </button>
            ) : null}
            <div className="flex items-start gap-4">
                <ModIcon item={item} size={64} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="truncate text-[17px] font-semibold text-[color:var(--st-t1)]">{item.name}</h3>
                        {mod ? <SignatureBadge mod={mod} isDaylight={isDaylight} /> : null}
                        {item.beta ? <Mark tone="beta">{t('mods.signatureBeta')}</Mark> : null}
                        {item.kind === 'awesome' ? <Mark>{t('mods.view.markExternal')}</Mark> : null}
                        {mod?.rangeOverridden ? <Mark tone="warn">{t('mods.view.markForced')}</Mark> : null}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] text-[color:var(--st-t3)]">
                        {owners.length > 0 ? owners.map((owner) => (
                            owner.url
                                ? <a key={owner.login} href={owner.url} target="_blank" rel="noopener noreferrer" onClick={openLink} className="text-[color:var(--st-t2)] hover:underline">{owner.login}</a>
                                : <span key={owner.login}>{owner.login}</span>
                        )) : authorText ? <span className="text-[color:var(--st-t2)]">{authorText}</span> : null}
                        <span className="font-mono text-[11px]">{item.id}</span>
                        {item.version ? <span>v{item.version}</span> : null}
                        {mod && market && item.hasUpdate ? <span>→ v{market.version}</span> : null}
                        {categoryLabel ? <span>{categoryLabel}</span> : null}
                    </div>
                    {item.description ? <p className="text-[12.5px] leading-[19px] text-[color:var(--st-t2)]">{item.description}</p> : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {primary}
                        {action.kind === 'update' && mod ? (
                            <Button onClick={() => ops.toggle(mod.id, !modOn)}>{modOn ? t('mods.view.disable') : t('mods.view.enable')}</Button>
                        ) : null}
                        {canUninstall(item) && mod ? <Button variant="quiet" onClick={() => ops.uninstall(mod.id)}>{t('mods.view.uninstall')}</Button> : null}
                        {item.kind === 'mod' ? (
                            <div ref={menuRef} className="inline-flex">
                                <Button icon={MoreHorizontal} tip={t('mods.view.more')} onClick={() => setMenuOpen((open) => !open)} />
                            </div>
                        ) : null}
                        <Menu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={t('mods.view.more')} items={menuItems} align="end" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                        {feedback.repository ? <HeaderLink href={feedback.repository} icon={Code2}>{t('mods.view.repository')}</HeaderLink> : null}
                        {feedback.url ? <HeaderLink href={feedback.url} icon={Bug} strong>{t('mods.view.reportIssue')}</HeaderLink> : null}
                        {market ? <HeaderLink href={market.page} icon={Store}>{t('mods.view.marketPage')}</HeaderLink> : null}
                        {awesome?.homepage ? <HeaderLink href={awesome.homepage} icon={ExternalLink}>{t('mods.view.homepage')}</HeaderLink> : null}
                    </div>
                    {feedback.owner === 'author' ? <span className="text-[11px] text-[color:var(--st-t3)]">{t('mods.view.feedbackHint')}</span> : null}
                    {!feedback.url && item.kind === 'mod' && !item.builtin ? <span className="text-[11px] text-[color:var(--st-t3)]">{t('mods.view.noFeedback')}</span> : null}
                </div>
            </div>

            <div className="mt-3 flex flex-col gap-2">
                {item.beta ? (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.preview}`}>
                        <FlaskConical size={13} className="mt-px shrink-0" />
                        <span>{t('mods.view.betaNote')}</span>
                    </div>
                ) : null}
                {item.rangeExpired && mod ? (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.warning}`}>
                        <TriangleAlert size={13} className="mt-px shrink-0" />
                        <span>{t('mods.view.expiredNote', { range: mod.folia ?? '-' })}</span>
                    </div>
                ) : null}
                {!mod && market?.hostRange === 'expired' ? (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.warning}`}>
                        <TriangleAlert size={13} className="mt-px shrink-0" />
                        <span>{t('mods.view.expiredInstallNote', { range: market.folia ?? '-' })}</span>
                    </div>
                ) : null}
                {action.kind === 'needsFolia' ? (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.warning}`}>
                        <TriangleAlert size={13} className="mt-px shrink-0" />
                        <span>{t('mods.view.needsFoliaNote', { range: action.range ?? '-' })}</span>
                    </div>
                ) : null}
                {progress?.phase === 'error' ? (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${classes.danger}`}>
                        <TriangleAlert size={13} className="mt-px shrink-0" />
                        <span className="break-all">{translateModError(t, progress.error, 'install-failed')}</span>
                    </div>
                ) : null}
                {busy && progress?.phase === 'download' && progress.total ? (
                    <div className="text-[11px] text-[color:var(--st-t3)]">{formatSize(progress.received ?? 0)} / {formatSize(progress.total)}</div>
                ) : null}
                {/* An expired range has its own note above; the same words twice would read as two problems. */}
                {mod?.error && mod.error !== 'community-off' && mod.error !== 'host-range-expired' && shownTab !== 'runtime' ? (
                    <div className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs ${classes.danger}`}>
                        <span className="flex items-start gap-2">
                            <TriangleAlert size={13} className="mt-px shrink-0" />
                            <span className="break-all">{translateModError(t, mod.error, 'unknown', { range: mod.folia ?? '-' })}</span>
                        </span>
                        <FeedbackLine url={feedback.url} owner={feedback.owner} />
                    </div>
                ) : null}
            </div>

            <Tabs tabs={tabs} activeId={shownTab} onSelect={(id) => setTab(id as Tab)} label={item.name} className="mt-3" />
            <div className="pt-3">
                {shownTab === 'readme' ? (
                    readmeUrl && readme?.text ? (
                        <ReadmeView text={readme.text} base={readmeUrl} imageOrigin={catalogOrigin} />
                    ) : readmeUrl && (!readme || (readme.text === null && !readme.error)) ? (
                        <div className="text-[12px] text-[color:var(--st-t3)]">{t('mods.view.loading')}</div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {item.description ? <p className="text-[13px] leading-[21px] text-[color:var(--st-t1)]">{item.description}</p> : null}
                            {market?.preview ? <img src={market.preview.url} alt="" loading="lazy" className="max-h-[320px] max-w-full self-start rounded-lg" /> : null}
                            {!item.description && !market?.preview ? <span className="text-[12px] text-[color:var(--st-t3)]">{t('mods.view.noReadme')}</span> : null}
                        </div>
                    )
                ) : null}
                {shownTab === 'settings' && mod ? <ModSettingsSection mod={mod} theme={theme} isDaylight={isDaylight} /> : null}
                {shownTab === 'permissions' ? <ModPermissionsSection installed={mod} market={market} /> : null}
                {shownTab === 'runtime' && mod ? (
                    <ModRuntimeSection
                        mod={mod}
                        cost={cost}
                        isDaylight={isDaylight}
                        theme={theme}
                        classes={classes}
                        feedback={<FeedbackLine url={feedback.url} owner={feedback.owner} />}
                        onNotice={onNotice}
                    />
                ) : null}
                {shownTab === 'version' ? <ModVersionSection installed={mod} market={market} isDaylight={isDaylight} classes={classes} /> : null}
            </div>
        </div>
    );
};

export default ModDetailPane;
