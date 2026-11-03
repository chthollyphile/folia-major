import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeSurfaceProps } from '../../core/suite/suite.contract';
import type { LibraryHomeTabKey } from '../../core/home/homeModel.contract';
import { cycleIndex, isOnlineHomeTab, resolveHomeSourceGroups, type LibraryHomeSourceGroup } from '../../core/home/homeSources';
import { LOCAL_HOME_SECTIONS, localHomeSectionOfRow } from '../../core/home/localHomeModel';
import { NAVIDROME_HOME_SECTIONS } from '../../core/home/navidrome/navidromeHomeModel';
import { useLibraryHomeSources } from '../../core/home/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../core/home/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../core/home/useLibraryHomeDirectory';
import { useLibraryHomeTabsRegistration } from '../../core/home/useLibraryHomeSurfaceRegistration';
import { useNavidromeHomeSectionStore } from '../../core/home/navidrome/useNavidromeHomeSectionStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { LibraryTuiLocalList, LibraryTuiNavidromeList, LibraryTuiOnlineList } from './LibraryTuiHomeLists';
import type { LibraryTuiPromptRequest } from './LibraryTuiPrompt';
import { useLibraryTuiHomePageKeys } from './useLibraryTuiHomeKeyboard';

// src/library/suites/tui/LibraryTuiHome.tsx
// 首页 surface 的 TUI 实现（开发版）：顶上两行等宽的页签——来源（在线 / 本地 / Navidrome，可用性与不可用原因来自
// 首页模型）与来源下的分区（在线的歌单 / 电台 / 专辑，本地四个 section，Navidrome 五个 section）——下面是当前
// 目录的列表（LibraryTuiDirectory）。来源、页签、在线列表、首页资源与动作都来自 Library Core（与网格的 Grid3D 用
// 同一套绑定、同一份首页资源，所以切 suite 不重新请求）；页签条交给首页 surface 句柄（useLibraryHomeTabsRegistration）。
// 在线页签未登录时是平台列表（LibraryTuiAccountList），已登录时 F2 打开它（切换平台、登出）；扫码登录框与切换确认由
// TUI 的 account surface（LibraryTuiAccount）画。更新徽标、搜索框、舞台入口属于网格的首页外观，这里不做。
// 这里不引用网格的任何实现。
// 宿主的扩展页签（extraTabs，模组的首页页面）在 TUI 里不画入口（页面只能经 ui.openHomeTab 打开）；但页面开着时
// 选原生页签照契约通知宿主（onNativeTabSelected），命令面板重选当前页签也能关掉页面。

type SectionTab = { key: string; label: string; active: boolean; disabledReason?: string };

const LibraryTuiHome: React.FC<LibraryHomeSurfaceProps> = (props) => {
    const {
        account,
        user,
        playlists,
        cloudPlaylist,
        navidromeEnabled,
        localMusicState,
        setLocalMusicState,
        homeResources,
        directoryActions,
        onOpenGridView,
        isInteractive,
        declaredActions,
        theme,
    } = props;
    const { t } = useTranslation();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const accentColor = theme.accentColor || 'currentColor';
    const [prompt, setPrompt] = useState<LibraryTuiPromptRequest | null>(null);
    // 在线页签的平台列表（F2）：已登录时替换目录列表；未登录时列表总是显示，与这个开关无关。
    const [accountsOpen, setAccountsOpen] = useState(false);

    // 与 Grid3D 同一套首页模型：来源与页签、在线列表（认领首页资源里的在线数据）、目录 key 与隐藏作用域。
    const sources = useLibraryHomeSources({ account, user, playlists, cloudPlaylist, navidromeEnabled });
    const { tab, setTab, online, tabs } = sources;
    const onlineList = useLibraryHomeOnline(homeResources, sources);
    const { scanPercent, snapshot: actionState } = useLibraryHomeActions(homeResources.actions);
    const { directoryKey, hiddenScope } = useLibraryHomeDirectory({
        tab,
        providerId: online.providerId,
        localRow: localMusicState.activeRow,
    });
    const navidromeSection = useNavidromeHomeSectionStore(state => state.section);
    const setNavidromeSection = useNavidromeHomeSectionStore(state => state.setSection);

    const selectTab = (key: LibraryHomeTabKey) => {
        const target = tabs.find(candidate => candidate.key === key);
        if (!target || target.disabledReason) return false;
        // 与 Grid3D / BravaisHome 相同：原生页签接手时通知宿主（重选当前页签也通知），开着的模组首页页面随之关掉。
        props.onNativeTabSelected?.();
        setPrompt(null);
        if (key !== tab) setAccountsOpen(false);
        setTab(key);
        return true;
    };
    useLibraryHomeTabsRegistration({
        getState: () => ({ active: tab, tabs }),
        setTab: selectTab,
    });

    const groups = useMemo(() => resolveHomeSourceGroups(tabs), [tabs]);
    const activeSource: LibraryHomeSourceGroup['source'] = isOnlineHomeTab(tab) ? 'online' : tab === 'local' ? 'local' : 'navidrome';
    const sourceLabel = (group: LibraryHomeSourceGroup) => (
        group.source === 'online' ? online.providerLabel : group.tabs[0]?.label ?? group.source
    );
    const selectSource = (group: LibraryHomeSourceGroup) => {
        if (group.disabledReason) return;
        // 在线来源回到当前的在线页签（不可用时取第一个可用的）。
        const current = group.tabs.find(candidate => candidate.key === tab && !candidate.disabledReason);
        const target = current ?? group.tabs.find(candidate => !candidate.disabledReason);
        if (target) selectTab(target.key);
    };

    // 当前来源下的分区：在线是三个在线页签，本地与 Navidrome 是各自的 section。
    const localSectionKey = localHomeSectionOfRow(localMusicState.activeRow).key;
    const sections: SectionTab[] = activeSource === 'online'
        ? (groups.find(group => group.source === 'online')?.tabs ?? []).map(candidate => ({
            key: candidate.key,
            label: candidate.label,
            active: candidate.key === tab,
            disabledReason: candidate.disabledReason,
        }))
        : activeSource === 'local'
            ? LOCAL_HOME_SECTIONS.map(section => ({
                key: section.key,
                label: t(section.labelKey) || (section.fallbackLabelKey ? t(section.fallbackLabelKey) : section.key),
                active: section.key === localSectionKey,
            }))
            : NAVIDROME_HOME_SECTIONS.map(section => ({
                key: section.key,
                label: t(section.labelKey),
                active: section.key === navidromeSection,
            }));
    const selectSection = (key: string) => {
        setPrompt(null);
        if (activeSource === 'online') {
            selectTab(key as LibraryHomeTabKey);
        } else if (activeSource === 'local') {
            const section = LOCAL_HOME_SECTIONS.find(candidate => candidate.key === key);
            if (section) setLocalMusicState(previous => ({ ...previous, activeRow: section.row }));
        } else {
            const section = NAVIDROME_HOME_SECTIONS.find(candidate => candidate.key === key);
            if (section) setNavidromeSection(section.key);
        }
    };

    // 平台换了（确认切换之后）、或当前平台变成未登录（列表本来就是页签内容）时收起 F2 的平台列表，
    // 之后登录成功回到的是新平台的内容，而不是一个还开着的列表。
    const isGuest = online.accountView === 'guest';
    useEffect(() => setAccountsOpen(false), [online.providerId, isGuest]);
    const toggleAccounts = () => {
        if (activeSource !== 'online') {
            const onlineGroup = groups.find(group => group.source === 'online');
            if (!onlineGroup || onlineGroup.disabledReason) return;
            selectSource(onlineGroup);
            setAccountsOpen(true);
            return;
        }
        // 未登录时平台列表本来就是在线页签的内容，F2 不另开一层。
        if (isGuest) return;
        setAccountsOpen(open => !open);
    };

    useLibraryTuiHomePageKeys({
        isActive: isInteractive,
        isPromptOpen: prompt !== null,
        onCycleSection: delta => {
            const next = cycleIndex(sections, sections.findIndex(section => section.active), delta, section => !section.disabledReason);
            if (next >= 0) selectSection(sections[next].key);
        },
        onCycleSource: delta => {
            const next = cycleIndex(groups, groups.findIndex(group => group.source === activeSource), delta, group => !group.disabledReason);
            if (next >= 0) selectSource(groups[next]);
        },
        onToggleAccounts: toggleAccounts,
    });

    const common = {
        directoryKey,
        hiddenScope,
        declaredActions,
        isInteractive,
        accentColor,
        isDaylight,
        homeActions: homeResources.actions,
        onOpenGridView,
        prompt,
        onPromptChange: setPrompt,
    };
    const showBatchHints = activeSource === 'local' && localSectionKey !== 'playlists';
    // 开发版的 suite 切换浮层在首页上贴着左下角：给它留出底部的一行，别盖住按键提示。
    const devSwitchGutter = import.meta.env.DEV ? 'pb-8' : '';
    // 顶上让出桌面版自绘标题栏的拖拽区（h-8，盖在整个窗口最上面），否则来源页签点不到；网格的首页页头同样留了 p-8。

    return (
        <div
            data-library-home="tui"
            data-ponder-page-scope="none"
            className={`relative flex h-full w-full flex-col overflow-hidden pt-8 font-mono ${devSwitchGutter}`}
            style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
        >
            <header className="shrink-0 border-b border-current/15 px-4 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="tablist" aria-label={t('libraryTui.homeSources')}>
                    <span className="font-bold" style={{ color: accentColor }}>{`folia · ${t('libraryTui.homeTitle')}`}</span>
                    {groups.map(group => {
                        const active = group.source === activeSource;
                        return (
                            <button
                                key={group.source}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                data-tui-source={group.source}
                                disabled={Boolean(group.disabledReason)}
                                title={group.disabledReason || undefined}
                                onClick={() => selectSource(group)}
                                className={`${active ? 'font-bold' : 'opacity-60 hover:opacity-100'} disabled:cursor-not-allowed disabled:line-through disabled:opacity-30`}
                                style={active ? { color: accentColor } : undefined}
                            >
                                {active ? `[${sourceLabel(group)}]` : ` ${sourceLabel(group)} `}
                            </button>
                        );
                    })}
                    {actionState.scan?.active ? (
                        <span className="ml-auto tabular-nums opacity-60" data-tui-scan>{`${t('options.scanProgress')} ${scanPercent}%`}</span>
                    ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" role="tablist">
                    {sections.map(section => (
                        <button
                            key={section.key}
                            type="button"
                            role="tab"
                            aria-selected={section.active}
                            data-tui-section={section.key}
                            disabled={Boolean(section.disabledReason)}
                            title={section.disabledReason || undefined}
                            onClick={() => selectSection(section.key)}
                            className={`${section.active ? 'font-bold' : 'opacity-60 hover:opacity-100'} disabled:cursor-not-allowed disabled:opacity-30`}
                            style={section.active ? { color: accentColor } : undefined}
                        >
                            {section.active ? `<${section.label}>` : section.label}
                        </button>
                    ))}
                </div>
            </header>

            {activeSource === 'online' ? (
                <LibraryTuiOnlineList
                    {...common}
                    tab={tab}
                    online={online}
                    list={onlineList}
                    account={account}
                    accountsOpen={accountsOpen}
                    onCloseAccounts={() => setAccountsOpen(false)}
                />
            ) : activeSource === 'local' ? (
                <LibraryTuiLocalList
                    {...common}
                    localSongs={props.localSongs}
                    localPlaylists={props.localPlaylists}
                    catalog={props.localLibraryCatalog}
                    activeRow={localMusicState.activeRow}
                    setActiveRow={row => setLocalMusicState(previous => ({ ...previous, activeRow: row }))}
                    treesResource={homeResources.localDirectoryTrees}
                    directoryActions={directoryActions}
                />
            ) : (
                <LibraryTuiNavidromeList
                    {...common}
                    overview={homeResources.navidromeOverview}
                    onOpenSettings={props.onOpenSettings ? () => props.onOpenSettings?.('help') : undefined}
                />
            )}

            <footer className="shrink-0 border-t border-current/10 px-4 py-1.5 text-[11px] opacity-50" data-tui-home-hints>
                {t('libraryTui.homeHints')}
                {` · ${t('libraryTui.homeAccountsHint')}`}
                {activeSource === 'local' && localSectionKey === 'folders' ? ` · ${t('libraryTui.homeTreeHints')}` : ''}
                {showBatchHints ? ` · ${t('libraryTui.homeBatchHints')}` : ''}
            </footer>
        </div>
    );
};

export default LibraryTuiHome;
