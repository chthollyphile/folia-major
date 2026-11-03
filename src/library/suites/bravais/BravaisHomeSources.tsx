import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLibraryGroup, LocalPlaylist, LocalSong } from '../../../types';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryDirectoryBatchController, LibraryHiddenScope } from '../../core/directory/directory.contract';
import type { LibraryLocalCatalogSnapshot } from '../../core/home/home.contract';
import type {
    LibraryHomeActionsController,
    LibraryHomeCard,
    LibraryHomeListState,
    LibraryHomeOnlineSource,
    LibraryHomeTabKey,
    LibraryLocalDirectoryTreesResource,
    LibraryNavidromeHomeResource,
} from '../../core/home/homeModel.contract';
import type { LibraryDeclaredActions, LibraryHomeActionId } from '../../core/suite/suite.contract';
import type { LibraryAccountController } from '../../core/account/account.contract';
import { isPersonalFmCard } from '../../core/home/homeCards';
import { resolveLocalHomeActions, type LocalHomeRow } from '../../core/home/localHomeModel';
import { isNavidromeHomeSection, resolveNavidromeCollectionType } from '../../core/home/navidrome/navidromeHomeModel';
import type { LibraryHomeOnlineList } from '../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeLocal, useLocalDirectoryTrees, useLocalHomeBatchConfig } from '../../core/home/useLibraryHomeLocal';
import { useLibraryHomeNavidrome } from '../../core/home/navidrome/useLibraryHomeNavidrome';
import { useLibraryHomeActions } from '../../core/home/useLibraryHomeActions';
import { useLibraryHomeListRegistration } from '../../core/home/useLibraryHomeSurfaceRegistration';
import type { BravaisHomeTool } from './bravaisHomeModels';
import type { BravaisSeamMenuItem } from './bravaisSeamModels';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import BravaisHomeDirectory from './BravaisHomeDirectory';
import { availableLocalTabLabel, localWallHint, onlineWallHint } from './bravaisEmptyWallHint';
import { useBravaisHomeAccount } from './useBravaisHomeAccount';

// src/library/suites/bravais/BravaisHomeSources.tsx
// bravais 首页三个来源的墙（设计稿 §10.5）：在线（账户歌单 / 电台 / 收藏专辑）、本地（文件夹 / 专辑 / 歌手 / 歌单
// 四行是缝里的二级切换）、Navidrome（五个 section）。与 TUI 的 LibraryTuiHomeLists 同一个结构：每个来源只在显示时
// 挂载（Navidrome 概览、本地文件夹树都是进页签时 ensure），数据、section、动作与打开都来自 Library Core 的首页模型与
// 首页资源；每个来源把自己的列表交给首页 surface 句柄（useLibraryHomeListRegistration），行为探针读它。
// 墙本身（目录会话、批量、隐藏、层描述）是 BravaisHomeDirectory。私人 FM 卡直接播放（openOnlineCard 判定），不进新层。
// 特殊集合的直达入口：在线页签看当前页签自己的卡（我喜欢的音乐、云盘在歌单页签，私人 FM、每日推荐在电台页签——电台数据
// 只在电台页签读，别的页签不为入口多发请求）；本地看文件夹与歌单两行（全部歌曲、「我喜欢」），Navidrome 看歌单 section
// （随机、收藏），都不限当前 section。

type BravaisHomeSourceCommonProps = {
    chrome: BravaisHomeChrome;
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    declaredActions: LibraryDeclaredActions;
    isInteractive: boolean;
    homeActions: LibraryHomeActionsController;
    onOpenGridView: (collection: LibraryCollectionDescriptor) => void;
};

const LOCAL_ACTION_IDS: Record<string, LibraryHomeActionId> = {
    'import-folder': 'home-import-folder',
    'refresh-folders': 'home-refresh-folders',
    'import-playlist': 'home-import-playlist',
};

export const BravaisHomeOnline: React.FC<BravaisHomeSourceCommonProps & {
    tab: LibraryHomeTabKey;
    online: LibraryHomeOnlineSource;
    list: LibraryHomeOnlineList;
    /** B10：账户 controller（窄缝里的平台切换与登出）。 */
    account: LibraryAccountController;
}> = ({ tab, online, list, account: accountController, homeActions, onOpenGridView, ...common }) => {
    const { t } = useTranslation();
    const showList = online.accountView === 'authenticated';
    useLibraryHomeListRegistration({
        enabled: showList,
        getState: (): LibraryHomeListState => ({
            tab,
            directoryKey: common.directoryKey,
            hiddenScope: common.hiddenScope,
            sections: [],
            items: list.items,
            isLoading: list.isLoading,
            actions: [],
            batchSelectionType: null,
        }),
        setSection: () => false,
        runAction: () => false,
    });
    // 未登录 / 无账户 / 解析中：墙空着，缝里说原因（平台切换与登录在 B10 的账户位里）。
    // fb3（用户实测）：未登录时不再显示「先搜几首喜欢的歌试试看」（grid / TUI 仍用 home.guestTitle），缝里只有
    // 「连接在线平台」入口；登录过期仍要说。
    const emptyMessage = online.accountView === 'guest'
        ? (online.needsRelogin ? t('status.loginExpired') : undefined)
        : online.accountView === 'resolving' ? t('home.loadingLibrary') : list.emptyMessage;
    // 未登录时墙不再整面空白：墙面上写一段背景说明（连接在线平台，或者去本地页签导入文件夹）。
    const localTab = availableLocalTabLabel(common.chrome.tabs);
    const { accountView, needsRelogin, providerLabel } = online;
    const wallHint = useMemo(
        () => onlineWallHint({ accountView, needsRelogin, providerLabel }, localTab, t),
        [accountView, localTab, needsRelogin, providerLabel, t],
    );
    // B10：账户位里的平台切换（account-select / account-logout）。
    const account = useBravaisHomeAccount(accountController, online);
    const latest = useRef({ homeActions, providerId: online.providerId, onOpenGridView });
    latest.current = { homeActions, providerId: online.providerId, onOpenGridView };
    const onOpen = useMemo(() => (card: Parameters<LibraryHomeActionsController['openOnlineCard']>[0]) => {
        const { homeActions: actions, providerId, onOpenGridView: open } = latest.current;
        void actions.openOnlineCard(card, providerId, open);
    }, []);
    return (
        <BravaisHomeDirectory
            {...common}
            layerKey={`home:${tab}`}
            source="online"
            section={tab}
            items={showList ? list.items : []}
            isLoading={showList && list.isLoading}
            emptyMessage={emptyMessage}
            wallHint={wallHint}
            meta={online.providerLabel}
            account={account}
            panelTitle={list.title}
            onOpen={onOpen}
            isDirect={isPersonalFmCard}
        />
    );
};

export const BravaisHomeLocal: React.FC<BravaisHomeSourceCommonProps & {
    meta: string;
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    catalog: LibraryLocalCatalogSnapshot;
    activeRow: number;
    setActiveRow: (row: LocalHomeRow) => void;
    treesResource: LibraryLocalDirectoryTreesResource;
    directoryActions?: LibraryDirectoryBatchController;
}> = ({ meta, localSongs, localPlaylists, catalog, activeRow, setActiveRow, treesResource, directoryActions, homeActions, onOpenGridView, ...common }) => {
    const { t } = useTranslation();
    const playlistFileInputRef = useRef<HTMLInputElement>(null);
    const directoryTrees = useLocalDirectoryTrees(treesResource, localSongs);
    const local = useLibraryHomeLocal({ localSongs, localPlaylists, catalog, activeRow });
    const { snapshot: actionState } = useLibraryHomeActions(homeActions);
    const batchConfig = useLocalHomeBatchConfig({
        controller: directoryActions,
        selectionType: local.batchSelectionType,
        trees: directoryTrees.trees,
        reloadTrees: directoryTrees.reload,
        reloadAllTrees: directoryTrees.reloadAll,
    });
    const activeSection = local.activeSection;
    const localActions = resolveLocalHomeActions(actionState)
        .filter(action => common.declaredActions.actions.includes(LOCAL_ACTION_IDS[action.id]));
    const runAction = (id: string) => {
        if (id === 'import-folder') void homeActions.importFolder();
        else if (id === 'refresh-folders') void homeActions.refreshFolders();
        else if (id === 'import-playlist') playlistFileInputRef.current?.click();
    };
    const runActionRef = useRef(runAction);
    runActionRef.current = runAction;
    const isEmptyLibrary = directoryTrees.loaded && localSongs.length === 0 && directoryTrees.trees.length === 0;
    // 空曲库时墙面上写一段背景说明（从缝的「⋯」导入文件夹）。
    const canImportFolder = localActions.some(action => action.id === 'import-folder');
    const wallHint = useMemo(() => (isEmptyLibrary ? localWallHint(canImportFolder, t) : undefined), [canImportFolder, isEmptyLibrary, t]);

    useLibraryHomeListRegistration({
        enabled: !isEmptyLibrary,
        getState: (): LibraryHomeListState => ({
            tab: 'local',
            directoryKey: common.directoryKey,
            hiddenScope: common.hiddenScope,
            sections: local.sections.map(section => ({ id: section.key, label: section.label, active: section.key === activeSection.key })),
            items: activeSection.cards,
            isLoading: false,
            actions: localActions.map(action => ({ id: action.id, label: t(action.labelKey), disabled: action.disabled })),
            batchSelectionType: batchConfig ? batchConfig.selectionType : null,
            ...(activeSection.key === 'folders' ? { directoryTrees: directoryTrees.trees } : {}),
        }),
        setSection: id => {
            const section = local.sections.find(candidate => candidate.key === id);
            if (!section) return false;
            setActiveRow(section.row);
            return true;
        },
        runAction: id => {
            const action = localActions.find(candidate => candidate.id === id);
            if (!action || action.disabled) return false;
            runAction(id);
            return true;
        },
        importPlaylistFile: common.declaredActions.actions.includes('home-import-playlist')
            ? async file => (await homeActions.importPlaylistFile(file)).ok
            : undefined,
    });

    // 缝：四行是二级切换（整面翻牌，不换层）；「⋯」里是导入文件夹、刷新、导入歌单文件。
    const sections = useMemo(() => local.sections.map(section => ({
        key: section.key,
        label: section.label,
        active: section.key === activeSection.key,
    })), [activeSection.key, local.sections]);
    const sectionsRef = useRef({ sections: local.sections, setActiveRow });
    sectionsRef.current = { sections: local.sections, setActiveRow };
    const onSelectSection = useMemo(() => (key: string) => {
        const section = sectionsRef.current.sections.find(candidate => candidate.key === key);
        if (section) sectionsRef.current.setActiveRow(section.row);
    }, []);
    const menuKey = localActions.map(action => `${action.id}:${action.labelKey}:${action.disabled}`).join('|');
    const menu = useMemo<BravaisSeamMenuItem[]>(() => localActions.map(action => ({
        id: `home-${action.id}`,
        label: t(action.labelKey),
        disabled: action.disabled,
        run: () => runActionRef.current(action.id),
    // localActions 每次渲染都是新数组：按内容比较。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    })), [menuKey, t]);
    const latest = useRef({ homeActions, onOpenGridView });
    latest.current = { homeActions, onOpenGridView };
    const onOpen = useMemo(() => (card: { raw?: unknown }) => {
        latest.current.homeActions.openLocalGroup(card.raw as LocalLibraryGroup, latest.current.onOpenGridView);
    }, []);
    // 直达入口（全部歌曲、本地「我喜欢」）不限当前 section：文件夹与歌单两行的卡片。
    const shortcutCards = useMemo(
        () => local.sections.filter(entry => entry.key === 'folders' || entry.key === 'playlists').flatMap(entry => entry.cards),
        [local.sections],
    );

    return (
        <>
            <input
                ref={playlistFileInputRef}
                type="file"
                accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl"
                hidden
                data-bravais-playlist-file
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void homeActions.importPlaylistFile(file);
                }}
            />
            <BravaisHomeDirectory
                {...common}
                layerKey="home:local"
                source="local"
                section={activeSection.key}
                items={isEmptyLibrary ? [] : activeSection.cards}
                isLoading={false}
                emptyMessage={isEmptyLibrary ? t('localMusic.noLocalMusic') : activeSection.emptyMessage}
                wallHint={wallHint}
                meta={meta}
                sections={isEmptyLibrary ? undefined : sections}
                onSelectSection={onSelectSection}
                menu={menu}
                batchConfig={isEmptyLibrary ? undefined : batchConfig}
                panelTitle={activeSection.label}
                onOpen={onOpen}
                shortcutCards={isEmptyLibrary ? NO_CARDS : shortcutCards}
            />
        </>
    );
};

export const BravaisHomeNavidrome: React.FC<BravaisHomeSourceCommonProps & {
    meta: string;
    overview: LibraryNavidromeHomeResource;
}> = ({ meta, overview, homeActions, onOpenGridView, ...common }) => {
    const { t } = useTranslation();
    const navidrome = useLibraryHomeNavidrome(overview);
    const { config, section, setSection, isLoading } = navidrome;
    const canRefresh = common.declaredActions.actions.includes('home-refresh-navidrome');
    const actions = canRefresh ? navidrome.actions : [];

    useLibraryHomeListRegistration({
        enabled: Boolean(config),
        getState: (): LibraryHomeListState => ({
            tab: 'navidrome',
            directoryKey: common.directoryKey,
            hiddenScope: common.hiddenScope,
            sections: navidrome.sections.map(entry => ({ id: entry.key, label: entry.label, active: entry.active })),
            items: navidrome.items,
            isLoading,
            actions: actions.map(action => ({ id: action.id, label: t(action.labelKey) || action.fallbackLabel || '', disabled: action.disabled })),
            batchSelectionType: null,
        }),
        setSection: id => {
            if (!isNavidromeHomeSection(id)) return false;
            setSection(id);
            return true;
        },
        runAction: id => {
            const action = actions.find(candidate => candidate.id === id);
            if (!action || action.disabled) return false;
            void navidrome.refresh();
            return true;
        },
    });

    const latest = useRef({ navidrome, homeActions, onOpenGridView });
    latest.current = { navidrome, homeActions, onOpenGridView };
    const sections = useMemo(() => navidrome.sections.map(entry => ({ key: entry.key, label: entry.label, active: entry.active })), [navidrome.sections]);
    const onSelectSection = useMemo(() => (key: string) => {
        if (isNavidromeHomeSection(key)) latest.current.navidrome.setSection(key);
    }, []);
    const refresh = actions[0];
    const refreshLabel = refresh ? t(refresh.labelKey) || refresh.fallbackLabel || '' : null;
    const hasConfig = Boolean(config);
    const sourceTools = useMemo<BravaisHomeTool[]>(() => (refreshLabel !== null && hasConfig ? [{
        id: 'refresh-navidrome',
        label: refreshLabel,
        busy: isLoading,
        disabled: isLoading,
        run: () => void latest.current.navidrome.refresh(),
    }] : []), [hasConfig, isLoading, refreshLabel]);
    const onOpen = useMemo(() => (card: Parameters<LibraryHomeActionsController['openNavidromeCard']>[0]) => {
        const { navidrome: current, homeActions: actionsController, onOpenGridView: open } = latest.current;
        actionsController.openNavidromeCard(card, resolveNavidromeCollectionType(current.section, card.id), open);
    }, []);
    // 直达入口（随机、收藏）在歌单 section 里：不经墙打开时按那张卡自己的 section 定集合类型（与在歌单墙上点它一样）。
    const openShortcut = useMemo(() => (card: Parameters<LibraryHomeActionsController['openNavidromeCard']>[0]) => {
        const { homeActions: actionsController, onOpenGridView: open } = latest.current;
        actionsController.openNavidromeCard(card, resolveNavidromeCollectionType('playlists', card.id), open);
    }, []);

    return (
        <BravaisHomeDirectory
            {...common}
            layerKey="home:navidrome"
            source="navidrome"
            section={section}
            items={config ? navidrome.items : []}
            isLoading={Boolean(config) && isLoading}
            emptyMessage={config ? navidrome.emptyMessage : t('navidrome.notConfigured') || 'Navidrome is not configured.'}
            meta={meta}
            sections={config ? sections : undefined}
            onSelectSection={onSelectSection}
            sourceTools={sourceTools}
            panelTitle={navidrome.title}
            onOpen={onOpen}
            shortcutCards={config ? navidrome.cardsBySection.playlists : NO_CARDS}
            openShortcut={openShortcut}
        />
    );
};

const NO_CARDS: LibraryHomeCard[] = [];
