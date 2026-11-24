import React, { useRef, useState } from 'react';
import { ChevronRight, ExternalLink, Filter, ListFilter, Loader2, MoreHorizontal, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { Menu, type MenuItem } from '../../components/modal/settings/kit';
import { SettingsToggle } from '../../components/modal/settings/SettingsRow';
import { openOutsideLink } from '../../utils/system/outsideLink';
import type { ModMarketCategory, ModMarketProgress } from '../types';
import type { ModManagerClasses } from '../manager/modManagerClasses';
import { isModOn, type ModViewItem, type ModsSection, type ModsSort } from './marketModel';
import { MODS_QUERY_FILTERS, toggleModsQueryToken } from './modsQuery';
import { primaryActionOf } from './modActions';
import { ModListEntry } from './ModListEntry';
import type { ModOps } from './ModsWorkbench';

// src/mods/market/ModsSidebar.tsx
// The left side of the mods view: the search box with its filter, sort and "⋯" menus, then either the
// sections (updates, held back by their range, installed, the market by category, Awesome-Folia), each
// folding, or one list of search results.

const PILL = 'st-t-fast inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-[11.5px] font-medium transition-[opacity,background-color] disabled:cursor-not-allowed disabled:opacity-45';
const PILL_PRIMARY = `${PILL} bg-[var(--st-accent)] text-[color:var(--st-on-accent)] enabled:hover:opacity-90`;
const PILL_FILL = `${PILL} bg-[var(--st-fill)] text-[color:var(--st-t1)] enabled:hover:bg-[var(--st-fill2)]`;
const ICON_BUTTON = 'st-t-fast inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)] aria-expanded:bg-[var(--st-fill)]';

/* The one action at the end of a line. */
const EntryAction: React.FC<{ item: ModViewItem; progress: ModMarketProgress | null; ops: ModOps; theme: Theme; classes: ModManagerClasses }> = ({ item, progress, ops, theme, classes }) => {
    const { t } = useTranslation();
    const busy = Boolean(progress && progress.phase !== 'error' && progress.phase !== 'done');
    const action = primaryActionOf(item, busy);
    switch (action.kind) {
        case 'open': return (
            <button type="button" className={ICON_BUTTON} title={t('mods.view.openRepository')} aria-label={t('mods.view.openRepository')} onClick={() => { void openOutsideLink(action.url); }}>
                <ExternalLink size={14} />
            </button>
        );
        case 'busy': return <Loader2 size={15} className="animate-spin text-[color:var(--st-t3)]" />;
        case 'install': return <button type="button" className={PILL_PRIMARY} onClick={() => ops.install(item.id)}>{t('mods.view.install')}</button>;
        case 'update': return <button type="button" className={PILL_PRIMARY} onClick={() => ops.install(item.id)}>{t('mods.view.update')}</button>;
        case 'tryLoad': return <button type="button" className={PILL_FILL} onClick={() => ops.tryLoad([item.id])}>{t('mods.view.tryLoad')}</button>;
        case 'needsFolia': return <span className="text-[11px] text-[color:var(--st-t3)]">{t('mods.view.needsFolia')}</span>;
        case 'needsCommunity': return <button type="button" className={PILL_FILL} title={t('mods.view.enableCommunity')} onClick={() => ops.enableCommunity(item.installed ? undefined : item.id)}>{t('mods.view.communityShort')}</button>;
        case 'toggle': return item.installed ? (
            <SettingsToggle
                checked={isModOn(item.installed)}
                onChange={() => ops.toggle(item.id, !(item.installed && isModOn(item.installed)))}
                offClass={classes.toggleOff}
                onColor={theme.secondaryColor}
                ariaLabel={isModOn(item.installed) ? t('mods.enabled') : t('mods.disabled')}
            />
        ) : null;
        default: return null;
    }
};

type ModsSidebarProps = {
    query: string;
    onQueryChange: (query: string) => void;
    sort: ModsSort;
    onSortChange: (sort: ModsSort) => void;
    sections: ModsSection[] | null;
    results: ModViewItem[] | null;
    categories: ModMarketCategory[];
    categoryLabel: (id: string) => string;
    activeKey: string | null;
    selectionMode: boolean;
    checkedIds: ReadonlySet<string>;
    progress: Record<string, ModMarketProgress>;
    moreItems: MenuItem[];
    status: React.ReactNode;
    isDaylight: boolean;
    theme: Theme;
    classes: ModManagerClasses;
    ops: ModOps;
    onOpen: (item: ModViewItem) => void;
    onToggleChecked: (modId: string) => void;
};

export const ModsSidebar: React.FC<ModsSidebarProps> = ({
    query, onQueryChange, sort, onSortChange, sections, results, categories, categoryLabel, activeKey, selectionMode, checkedIds,
    progress, moreItems, status, isDaylight, theme, classes, ops, onOpen, onToggleChecked,
}) => {
    const { t } = useTranslation();
    const [folded, setFolded] = useState<Set<string>>(() => new Set());
    const [menu, setMenu] = useState<'filter' | 'sort' | 'more' | null>(null);
    const filterRef = useRef<HTMLButtonElement>(null);
    const sortRef = useRef<HTMLButtonElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const lowerQuery = query.toLowerCase().split(/\s+/);

    const filterItems: MenuItem[] = [
        ...MODS_QUERY_FILTERS.map((filter) => ({
            id: filter,
            label: t(`mods.view.filter.${filter}`),
            end: `@${filter}`,
            chosen: lowerQuery.includes(`@${filter}`),
            onSelect: () => onQueryChange(toggleModsQueryToken(query, `@${filter}`)),
        })),
        ...categories.map((category) => ({
            id: `category:${category.id}`,
            label: categoryLabel(category.id),
            end: `@category:${category.id}`,
            chosen: lowerQuery.includes(`@category:${category.id}`),
            onSelect: () => onQueryChange(toggleModsQueryToken(query, `@category:${category.id}`)),
        })),
    ];
    const sortItems: MenuItem[] = (['updated', 'name'] as const).map((id) => ({
        id,
        label: t(`mods.view.sort.${id}`),
        chosen: sort === id,
        onSelect: () => onSortChange(id),
    }));

    const sectionTitle = (section: ModsSection) => {
        if (section.id.startsWith('category:')) return categoryLabel(section.id.slice('category:'.length));
        return t(`mods.view.section.${section.id}`);
    };

    const sectionAction = (section: ModsSection) => {
        if (section.id === 'updates' && section.items.length > 0) {
            return <button type="button" className={PILL_FILL} onClick={() => ops.updateAll(section.items.map((item) => item.id))}>{t('mods.view.updateAll')}</button>;
        }
        if (section.id === 'expired' && section.items.length > 0) {
            return <button type="button" className={PILL_FILL} onClick={() => ops.tryLoad(section.items.map((item) => item.id))}>{t('mods.view.tryLoadAll')}</button>;
        }
        return null;
    };

    const renderEntry = (item: ModViewItem) => (
        <ModListEntry
            key={item.key}
            item={item}
            active={activeKey === item.key}
            selectionMode={selectionMode}
            checked={checkedIds.has(item.id)}
            progress={progress[item.id] ?? null}
            isDaylight={isDaylight}
            action={<EntryAction item={item} progress={progress[item.id] ?? null} ops={ops} theme={theme} classes={classes} />}
            onOpen={() => onOpen(item)}
            onToggleChecked={() => onToggleChecked(item.id)}
        />
    );

    return (
        <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-1">
                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--st-fill)] px-2.5 focus-within:shadow-[0_0_0_1px_var(--st-accent)]">
                    <Search size={13} className="shrink-0 text-[color:var(--st-t3)]" />
                    <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder={t('mods.view.searchPlaceholder')}
                        aria-label={t('mods.view.searchPlaceholder')}
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)]"
                    />
                    {query ? (
                        <button type="button" onClick={() => onQueryChange('')} className="shrink-0 text-[color:var(--st-t3)] hover:text-[color:var(--st-t1)]" aria-label={t('mods.view.clearSearch')}>
                            <X size={13} />
                        </button>
                    ) : null}
                </label>
                <button ref={filterRef} type="button" className={ICON_BUTTON} title={t('mods.view.filterMenu')} aria-label={t('mods.view.filterMenu')} aria-haspopup="menu" aria-expanded={menu === 'filter'} onClick={() => setMenu(menu === 'filter' ? null : 'filter')}>
                    <Filter size={14} />
                </button>
                <button ref={sortRef} type="button" className={ICON_BUTTON} title={t('mods.view.sortMenu')} aria-label={t('mods.view.sortMenu')} aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
                    <ListFilter size={14} />
                </button>
                <button ref={moreRef} type="button" className={ICON_BUTTON} title={t('mods.view.more')} aria-label={t('mods.view.more')} aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
                    <MoreHorizontal size={14} />
                </button>
                <Menu anchorRef={filterRef} open={menu === 'filter'} onClose={() => setMenu(null)} label={t('mods.view.filterMenu')} items={filterItems} align="end" />
                <Menu anchorRef={sortRef} open={menu === 'sort'} onClose={() => setMenu(null)} label={t('mods.view.sortMenu')} items={sortItems} align="end" />
                <Menu anchorRef={moreRef} open={menu === 'more'} onClose={() => setMenu(null)} label={t('mods.view.more')} items={moreItems} align="end" />
            </div>
            {status}
            <div className="flex flex-col gap-0.5">
                {results ? (
                    results.length > 0 ? results.map(renderEntry) : (
                        <div className="px-2 py-6 text-center text-[12px] text-[color:var(--st-t3)]">{t('mods.view.noResults')}</div>
                    )
                ) : sections?.map((section) => {
                    const isFolded = folded.has(section.id);
                    return (
                        <div key={section.id} className="flex flex-col gap-0.5">
                            <div className="sticky top-0 z-[1] flex items-center gap-1 bg-[var(--st-card)] py-1 pr-1">
                                <button
                                    type="button"
                                    aria-expanded={!isFolded}
                                    onClick={() => setFolded((previous) => {
                                        const next = new Set(previous);
                                        if (next.has(section.id)) next.delete(section.id);
                                        else next.add(section.id);
                                        return next;
                                    })}
                                    className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[color:var(--st-t2)] hover:text-[color:var(--st-t1)]"
                                >
                                    <ChevronRight size={13} className={`shrink-0 transition-transform ${isFolded ? '' : 'rotate-90'}`} />
                                    <span className="truncate">{sectionTitle(section)}</span>
                                    <span className="shrink-0 rounded-full bg-[var(--st-fill)] px-1.5 text-[10px] font-medium normal-case tracking-normal">{section.items.length}</span>
                                </button>
                                {sectionAction(section)}
                            </div>
                            {isFolded ? null : section.items.map(renderEntry)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ModsSidebar;
