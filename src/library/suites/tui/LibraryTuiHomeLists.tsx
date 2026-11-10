import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLibraryGroup, LocalPlaylist, LocalSong } from '../../../types';
import type { LibraryAccountController } from '../../core/account/account.contract';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryDirectoryBatchController, LibraryHiddenScope } from '../../core/directory/directory.contract';
import type { LibraryLocalCatalogSnapshot } from '../../core/home/home.contract';
import type {
    LibraryHomeActionsController,
    LibraryHomeListAction,
    LibraryHomeListState,
    LibraryHomeOnlineSource,
    LibraryHomeTabKey,
    LibraryLocalDirectoryTreesResource,
    LibraryNavidromeHomeResource,
} from '../../core/home/homeModel.contract';
import type { LibraryDeclaredActions, LibraryHomeActionId } from '../../core/suite/suite.contract';
import { resolveLocalHomeActions, type LocalHomeRow } from '../../core/home/localHomeModel';
import { isNavidromeHomeSection, resolveNavidromeCollectionType } from '../../core/home/navidrome/navidromeHomeModel';
import type { LibraryHomeOnlineList } from '../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeLocal, useLocalDirectoryTrees, useLocalHomeBatchConfig } from '../../core/home/useLibraryHomeLocal';
import { useLibraryHomeNavidrome } from '../../core/home/navidrome/useLibraryHomeNavidrome';
import { useLibraryHomeActions } from '../../core/home/useLibraryHomeActions';
import { useLibraryHomeListRegistration } from '../../core/home/useLibraryHomeSurfaceRegistration';
import LibraryTuiDirectory from './LibraryTuiDirectory';
import LibraryTuiAccountList from './LibraryTuiAccountList';
import type { LibraryTuiPromptRequest } from './LibraryTuiPrompt';

// src/library/suites/tui/LibraryTuiHomeLists.tsx
// TUI 首页三个来源的列表：在线（账户歌单 / 电台 / 收藏专辑）、本地（四个 section，文件夹是目录树、带批量）、
// Navidrome（五个 section）。每个来源只在显示时挂载（与网格的 LocalGrid3DView / NavidromeGrid3DView 一样），
// 数据、section、动作与打开都来自 Library Core 的首页模型与首页资源；列表本身是 LibraryTuiDirectory。
// 每个来源把自己的列表交给首页 surface 句柄（useLibraryHomeListRegistration），行为探针与以后的命令面板读它。
// 在线账户未登录时在线页签是平台列表（LibraryTuiAccountList：选平台登录 / 切换），已登录时 F2 打开同一个列表；
// 无账户、Navidrome 未配置、本地曲库为空时只显示原因文字。

type LibraryTuiListCommonProps = {
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    declaredActions: LibraryDeclaredActions;
    isInteractive: boolean;
    accentColor: string;
    isDaylight: boolean;
    homeActions: LibraryHomeActionsController;
    onOpenGridView: (collection: LibraryCollectionDescriptor) => void;
    prompt: LibraryTuiPromptRequest | null;
    onPromptChange: (prompt: LibraryTuiPromptRequest | null) => void;
};

const LOCAL_ACTION_IDS: Record<string, LibraryHomeActionId> = {
    'import-folder': 'home-import-folder',
    'refresh-folders': 'home-refresh-folders',
    'import-playlist': 'home-import-playlist',
};

/** 列表右上角的一排动作（导入、刷新），等宽按钮。 */
const ActionBar: React.FC<{ actions: { id: string; label: string; disabled: boolean; pending: boolean }[]; onRun: (id: string) => void }> = ({ actions, onRun }) => (
    actions.length === 0 ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 px-4 py-1 text-[12px]" data-tui-home-actions>
            {actions.map(action => (
                <button
                    key={action.id}
                    type="button"
                    data-tui-home-action={action.id}
                    disabled={action.disabled}
                    onClick={() => onRun(action.id)}
                    className="opacity-70 hover:opacity-100 disabled:opacity-30"
                >
                    {`[${action.pending ? '~' : ''}${action.label}]`}
                </button>
            ))}
        </div>
    )
);

const StatusText: React.FC<{ children: React.ReactNode; status: string }> = ({ children, status }) => (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-6 text-[13px]" data-tui-home-status={status}>
        {children}
    </div>
);

export const LibraryTuiOnlineList: React.FC<LibraryTuiListCommonProps & {
    tab: LibraryHomeTabKey;
    online: LibraryHomeOnlineSource;
    list: LibraryHomeOnlineList;
    account: LibraryAccountController;
    /** F2 打开了平台列表（已登录、无账户、解析中时；未登录时列表总是显示）。 */
    accountsOpen: boolean;
    onCloseAccounts: () => void;
}> = ({ tab, online, list, account, accountsOpen, onCloseAccounts, homeActions, onOpenGridView, directoryKey, hiddenScope, ...common }) => {
    const { t } = useTranslation();
    const isGuest = online.accountView === 'guest';
    const showAccounts = isGuest || accountsOpen;
    const showList = !showAccounts && online.accountView !== 'accountless' && online.accountView !== 'resolving';

    useLibraryHomeListRegistration({
        enabled: showList,
        getState: (): LibraryHomeListState => ({
            tab,
            directoryKey,
            hiddenScope,
            sections: [],
            items: list.items,
            isLoading: list.isLoading,
            actions: [],
            batchSelectionType: null,
        }),
        setSection: () => false,
        runAction: () => false,
    });

    if (showAccounts) {
        // 未登录：原因 + 「选一个平台登录或切换」；F2 打开的：标题 + 关上的提示。
        const heading = isGuest ? (
            <div data-tui-home-status="guest" className="flex flex-col gap-0.5">
                <span>{online.needsRelogin ? t('status.loginExpired') : t('home.guestTitle')}</span>
                <span className="opacity-60">{t('libraryTui.accountsGuest', { provider: online.providerLabel })}</span>
            </div>
        ) : (
            <span className="font-bold" style={{ color: common.accentColor }}>{t('libraryTui.accountsTitle')}</span>
        );
        return (
            <LibraryTuiAccountList
                account={account}
                isInteractive={common.isInteractive}
                accentColor={common.accentColor}
                isDaylight={common.isDaylight}
                heading={heading}
                onClose={isGuest ? undefined : onCloseAccounts}
            />
        );
    }
    if (online.accountView === 'accountless') {
        return (
            <StatusText status="accountless">
                <span>{t('libraryTui.accountless', { provider: online.providerLabel })}</span>
                <span className="opacity-60">{t('libraryTui.accountsOpenHint')}</span>
            </StatusText>
        );
    }
    if (online.accountView === 'resolving') {
        return <StatusText status="resolving"><span className="opacity-50">{t('home.loadingLibrary')}</span></StatusText>;
    }

    return (
        <LibraryTuiDirectory
            {...common}
            directoryKey={directoryKey}
            hiddenScope={hiddenScope}
            items={list.items}
            isLoading={list.isLoading}
            emptyMessage={list.emptyMessage}
            // 私人 FM 直接播放，其余交给宿主打开集合（suite 是 TUI，所以打开的是 TUI 的集合视图）。
            onOpen={card => void homeActions.openOnlineCard(card, online.providerId, onOpenGridView)}
        />
    );
};

export const LibraryTuiLocalList: React.FC<LibraryTuiListCommonProps & {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    catalog: LibraryLocalCatalogSnapshot;
    activeRow: number;
    setActiveRow: (row: LocalHomeRow) => void;
    treesResource: LibraryLocalDirectoryTreesResource;
    directoryActions?: LibraryDirectoryBatchController;
}> = ({
    localSongs,
    localPlaylists,
    catalog,
    activeRow,
    setActiveRow,
    treesResource,
    directoryActions,
    homeActions,
    onOpenGridView,
    directoryKey,
    hiddenScope,
    ...common
}) => {
    const { t } = useTranslation();
    const playlistFileInputRef = useRef<HTMLInputElement>(null);
    const directoryTrees = useLocalDirectoryTrees(treesResource, localSongs);
    const local = useLibraryHomeLocal({ localSongs, localPlaylists, catalog, activeRow });
    const { snapshot: actionState, importBusy } = useLibraryHomeActions(homeActions);
    const batchConfig = useLocalHomeBatchConfig({
        controller: directoryActions,
        selectionType: local.batchSelectionType,
        trees: directoryTrees.trees,
        reloadTrees: directoryTrees.reload,
        reloadAllTrees: directoryTrees.reloadAll,
    });
    const activeSection = local.activeSection;

    // 三个导入动作都不需要网格的界面：导入文件夹与刷新直接交给首页动作控制器，歌单文件用一个隐藏的文件选择框。
    const localActions = resolveLocalHomeActions(actionState)
        .filter(action => common.declaredActions.actions.includes(LOCAL_ACTION_IDS[action.id]));
    const runAction = (id: string) => {
        if (id === 'import-folder') void homeActions.importFolder();
        else if (id === 'refresh-folders') void homeActions.refreshFolders();
        else if (id === 'import-playlist') playlistFileInputRef.current?.click();
    };
    const isEmptyLibrary = directoryTrees.loaded && localSongs.length === 0 && directoryTrees.trees.length === 0;

    useLibraryHomeListRegistration({
        enabled: !isEmptyLibrary,
        getState: (): LibraryHomeListState => ({
            tab: 'local',
            directoryKey,
            hiddenScope,
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

    const fileInput = (
        <input
            ref={playlistFileInputRef}
            type="file"
            accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl"
            className="hidden"
            data-tui-playlist-file
            onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void homeActions.importPlaylistFile(file);
            }}
        />
    );

    if (isEmptyLibrary) {
        return (
            <StatusText status="empty-library">
                {fileInput}
                <span>{t('localMusic.noLocalMusic')}</span>
                {common.declaredActions.actions.includes('home-import-folder') ? (
                    <button type="button" disabled={importBusy} onClick={() => void homeActions.importFolder()} className="self-start opacity-70 hover:opacity-100 disabled:opacity-30">
                        {`[${actionState.scan?.active ? t('options.scanning') : actionState.importingFolder ? t('localMusic.importing') : t('localMusic.importFolder')}]`}
                    </button>
                ) : null}
            </StatusText>
        );
    }

    return (
        <>
            {fileInput}
            <ActionBar
                actions={localActions.map((action: LibraryHomeListAction) => ({
                    id: action.id,
                    label: t(action.labelKey),
                    disabled: action.disabled,
                    pending: action.pending,
                }))}
                onRun={runAction}
            />
            <LibraryTuiDirectory
                {...common}
                directoryKey={directoryKey}
                hiddenScope={hiddenScope}
                items={activeSection.cards}
                isLoading={false}
                emptyMessage={activeSection.emptyMessage}
                batchConfig={batchConfig}
                directoryTrees={activeSection.key === 'folders' ? directoryTrees.trees : undefined}
                onOpen={card => homeActions.openLocalGroup(card.raw as LocalLibraryGroup, onOpenGridView)}
            />
        </>
    );
};

export const LibraryTuiNavidromeList: React.FC<LibraryTuiListCommonProps & {
    overview: LibraryNavidromeHomeResource;
    onOpenSettings?: () => void;
}> = ({ overview, onOpenSettings, homeActions, onOpenGridView, directoryKey, hiddenScope, ...common }) => {
    const { t } = useTranslation();
    const navidrome = useLibraryHomeNavidrome(overview);
    const { config, section, setSection, isLoading } = navidrome;
    const canRefresh = common.declaredActions.actions.includes('home-refresh-navidrome');
    const actions = canRefresh ? navidrome.actions : [];

    useLibraryHomeListRegistration({
        enabled: Boolean(config),
        getState: (): LibraryHomeListState => ({
            tab: 'navidrome',
            directoryKey,
            hiddenScope,
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

    if (!config) {
        return (
            <StatusText status="navidrome-not-configured">
                <span>{t('navidrome.notConfigured') || 'Navidrome is not configured.'}</span>
                {onOpenSettings ? (
                    <button type="button" onClick={onOpenSettings} className="self-start opacity-70 hover:opacity-100">
                        {`[${t('navidrome.settings') || 'Navidrome Settings'}]`}
                    </button>
                ) : null}
            </StatusText>
        );
    }

    return (
        <>
            <ActionBar
                actions={actions.map(action => ({
                    id: action.id,
                    label: t(action.labelKey) || action.fallbackLabel || '',
                    disabled: action.disabled,
                    pending: action.pending,
                }))}
                onRun={() => void navidrome.refresh()}
            />
            <LibraryTuiDirectory
                {...common}
                directoryKey={directoryKey}
                hiddenScope={hiddenScope}
                items={navidrome.items}
                isLoading={isLoading}
                emptyMessage={navidrome.emptyMessage}
                onOpen={card => homeActions.openNavidromeCard(card, resolveNavidromeCollectionType(section, card.id), onOpenGridView)}
            />
        </>
    );
};
