import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, Disc3, ListMusic, Loader2, RefreshCw, Settings2, Sparkles, User } from 'lucide-react';
import DesktopGrid3DSurface, { DesktopGrid3DAction } from './DesktopGrid3DSurface';
import { Theme } from '../../../../types';
import type { GridViewCollectionDescriptor } from '../../../../components/app/home/gridViewCollectionAdapters';
import { useDebouncedFocusSync } from '../../../../hooks/useDebouncedFocusSync';
import type { LibraryHomeActionsController, LibraryHomeCard, LibraryHomeListState, LibraryNavidromeHomeResource } from '../../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import { isNavidromeHomeSection, resolveNavidromeCollectionType, type NavidromeHomeSection } from '../../../core/home/navidrome/navidromeHomeModel';
import { useLibraryHomeNavidrome } from '../../../core/home/navidrome/useLibraryHomeNavidrome';
import { useLibraryHomeListRegistration } from '../../../core/home/useLibraryHomeSurfaceRegistration';

// src/library/suites/grid/home/NavidromeGrid3DView.tsx
// Desktop-only Navidrome Grid3D overview that opens GridView instead of legacy collection views.
// 概览请求、section 记忆、卡片（含带 isVirtual 的「随机」「收藏」）与打开时的集合类型都来自 Library Core
// （core/home/navidrome/useLibraryHomeNavidrome、core/home/navidrome/navidromeHomeModel）；这里只剩图标与各 section 的焦点。

const SECTION_ICONS: Record<NavidromeHomeSection, React.ReactNode> = {
    albums: <Disc3 size={13} />,
    'recently-added': <Sparkles size={13} />,
    'recently-played': <Clock3 size={13} />,
    playlists: <ListMusic size={13} />,
    artists: <User size={13} />,
};

interface NavidromeGrid3DViewProps {
    focusedAlbumIndex: number;
    setFocusedAlbumIndex: (index: number) => void;
    onOpenSettings?: () => void;
    onOpenGridView?: (collection: GridViewCollectionDescriptor) => void;
    /** 首页动作控制器（打开卡片；宿主创建）。 */
    homeActions: LibraryHomeActionsController;
    /** Navidrome 概览（首页宿主持有，见 homeResources.navidromeOverview；换 suite 不重新请求）。 */
    overview: LibraryNavidromeHomeResource;
    /** 首页模型算好的目录会话 key（core/home/homeSources 的 resolveHomeDirectoryKey）。 */
    directoryKey: string;
    /** 网格 suite 声明的首页动作（交给 GridMap 的目录 surface 取交集）。 */
    declaredHomeActions?: LibraryDeclaredActions;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
    isInteractive?: boolean;
    /** 是否是当前显示的一级页签。缓存（keep-alive）时非活动层为 false：只显示、不对外注册列表句柄。 */
    isActive?: boolean;
}

export const NavidromeGrid3DView: React.FC<NavidromeGrid3DViewProps> = ({
    focusedAlbumIndex,
    setFocusedAlbumIndex,
    onOpenSettings,
    onOpenGridView,
    homeActions,
    overview,
    directoryKey,
    declaredHomeActions,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
    isInteractive = true,
    isActive = true,
}) => {
    const { t } = useTranslation();
    const [localAlbumIndex, setLocalAlbumIndex] = useDebouncedFocusSync(focusedAlbumIndex, setFocusedAlbumIndex);
    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    const [focusedArtistIndex, setFocusedArtistIndex] = useState(0);
    const [focusedRecentlyAddedIndex, setFocusedRecentlyAddedIndex] = useState(0);
    const [focusedRecentlyPlayedIndex, setFocusedRecentlyPlayedIndex] = useState(0);
    const navidrome = useLibraryHomeNavidrome(overview);
    const { config, section, setSection, isLoading } = navidrome;

    const focus: Record<NavidromeHomeSection, [number, (index: number) => void]> = {
        albums: [localAlbumIndex, setLocalAlbumIndex],
        'recently-added': [focusedRecentlyAddedIndex, setFocusedRecentlyAddedIndex],
        'recently-played': [focusedRecentlyPlayedIndex, setFocusedRecentlyPlayedIndex],
        playlists: [focusedPlaylistIndex, setFocusedPlaylistIndex],
        artists: [focusedArtistIndex, setFocusedArtistIndex],
    };
    const [focusedIndex, setFocusedIndex] = focus[section];

    const tabs: DesktopGrid3DAction[] = navidrome.sections.map(entry => ({
        id: entry.key,
        label: entry.label,
        icon: SECTION_ICONS[entry.key],
        active: entry.active,
        onClick: () => setSection(entry.key),
    }));

    const actions: DesktopGrid3DAction[] = navidrome.actions.map(action => ({
        id: action.id,
        label: t(action.labelKey) || action.fallbackLabel,
        icon: action.pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />,
        disabled: action.disabled,
        onClick: () => void navidrome.refresh(),
        title: t(action.titleKey ?? action.labelKey) || action.fallbackLabel,
    }));

    // 首页模型交给 core 的首页 surface 句柄（探针与以后的命令面板读它，不读组件树）。
    useLibraryHomeListRegistration({
        enabled: Boolean(config) && isActive,
        getState: (): LibraryHomeListState => ({
            tab: 'navidrome',
            directoryKey,
            hiddenScope: 'navidrome',
            sections: navidrome.sections.map(entry => ({ id: entry.key, label: entry.label, active: entry.active })),
            items: navidrome.items,
            isLoading,
            actions: navidrome.actions.map(action => ({ id: action.id, label: t(action.labelKey) || action.fallbackLabel || '', disabled: action.disabled })),
            batchSelectionType: null,
        }),
        setSection: id => {
            if (!isNavidromeHomeSection(id)) return false;
            setSection(id);
            return true;
        },
        runAction: id => {
            const action = navidrome.actions.find(candidate => candidate.id === id);
            if (!action || action.disabled) return false;
            void navidrome.refresh();
            return true;
        },
    });

    if (!config) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-5 opacity-70">
                <Settings2 size={56} />
                <p className="text-sm">{t('navidrome.notConfigured') || 'Navidrome is not configured.'}</p>
                <button
                    onClick={onOpenSettings}
                    className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-sm font-semibold"
                >
                    {t('navidrome.settings') || 'Navidrome Settings'}
                </button>
            </div>
        );
    }

    return (
        <DesktopGrid3DSurface
            focusMemoryScope={JSON.stringify(['navidrome', config?.serverUrl, config?.username, section])}
            title={navidrome.title}
            mapButtonLabel={t('home.allAlbums')}
            items={navidrome.items}
            focusedIndex={focusedIndex}
            onFocusedIndexChange={setFocusedIndex}
            onSelect={(item) => {
                const card = item as LibraryHomeCard;
                homeActions.openNavidromeCard(
                    card,
                    resolveNavidromeCollectionType(section, card.id),
                    collection => onOpenGridView?.(collection),
                );
            }}
            tabs={tabs}
            actions={actions}
            isLoading={isLoading}
            emptyMessage={navidrome.emptyMessage}
            theme={theme}
            isDaylight={isDaylight}
            isInteractive={isInteractive}
            hasFloatingPlayer={hasFloatingPlayer}
            playlistVisibilityScope="navidrome"
            directoryKey={directoryKey}
            declaredHomeActions={declaredHomeActions}
        />
    );
};

export default NavidromeGrid3DView;
