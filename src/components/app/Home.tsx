import React, { useState } from 'react';
import GridViewOverlayHost from '../../library/app/GridViewOverlayHost';
import LibraryAccountHost from '../../library/app/LibraryAccountHost';
import { createLibraryAccountLayer } from '../../library/app/libraryAccountLayer';
import { resolveLibrarySurface } from '../../library/registry';
import { useLibrarySuiteStore } from '../../library/core/state/useLibrarySuiteStore';
import { useLibraryDirectoryBatchController } from '../../library/app/useLibraryDirectoryBatchController';
import { useLibraryHomeResources } from '../../library/app/useLibraryHomeResources';
import type { HomeViewModel } from './home/buildHomeModel';
import { FoliumHomePage } from './home/FoliumHomePage';
import { useHomePageStore } from '../../mods/folium/homePages';
import { countRender } from '../../dev/renderCount';

// App-level entry for the home surface backed by a view model.
// 首页 surface 经 Library registry 解析：选中的 suite 实现了首页就用它，否则回退默认 suite（网格的 Grid3D）。
// 外壳只交出首页模型与打开集合的入口，不直接 import 任何 suite。
type AppHomeProps = {
    model: HomeViewModel;
    isHomeFullyHidden?: boolean;
    isInteractive?: boolean;
};

const Home: React.FC<AppHomeProps> = ({ model, isHomeFullyHidden, isInteractive = true }) => {
    countRender('Home');
    const pageOpen = useHomePageStore(state => state.activeId !== null);
    // 只在切换 suite 时变（开发版浮层）；同一个回退结果是同一个组件，首页不会因此重新挂载。
    const suiteId = useLibrarySuiteStore(state => state.suite);
    // 目录批量动作（本地文件夹 / 专辑 / 歌手的播放、入队、建歌单、删除、重扫）：首页一个控制器，不随渲染重建。
    const directoryActions = useLibraryDirectoryBatchController(model.surfaceProps);
    // 首页资源（在线收藏专辑、电台 feed、Navidrome 概览、文件夹树、导入与打开等首页动作）：首页一份，任何 suite 的
    // 首页都订阅同一份，换 suite 不重新请求；首页整个藏起或卸载时才作废（回来重新读）。
    const homeResources = useLibraryHomeResources(model.surfaceProps, { active: !isHomeFullyHidden });
    // 账户界面（登录弹窗）的挂载点：首页 surface 交元素，账户宿主订阅；外壳自己不因元素变化重渲染。
    const [accountLayer] = useState(createLibraryAccountLayer);
    if (isHomeFullyHidden) {
        return null;
    }

    const homeSurface = resolveLibrarySurface('home', suiteId);
    const HomeSurface = homeSurface.component;

    return (
        <>
            <GridViewOverlayHost
                surfaceProps={model.surfaceProps}
                onOpenCollection={model.onOpenCollection}
                onPushCollection={model.onPushCollection}
                onPopCollectionTo={model.onPopCollectionTo}
                onBackCollection={model.onBackCollection}
                isInteractive={isInteractive && !pageOpen}
            >
                {(openGridView, isHomeGridInteractive) => (
                    <React.Suspense fallback={null}>
                        <HomeSurface
                            {...model.surfaceProps}
                            account={model.account}
                            accountLayerRef={accountLayer.attach}
                            onOpenGridView={openGridView}
                            isInteractive={isHomeGridInteractive}
                            declaredActions={homeSurface.declaredActions}
                            directoryActions={directoryActions}
                            homeResources={homeResources}
                        />
                    </React.Suspense>
                )}
            </GridViewOverlayHost>
            <FoliumHomePage theme={model.surfaceProps.theme} />
            {/* 登录弹窗与切换确认框：寿命与首页 surface 相同（首页整个藏起时卸载），换 suite 不卸载。 */}
            <LibraryAccountHost
                account={model.account}
                layer={accountLayer}
                theme={model.surfaceProps.theme}
                isInteractive={isInteractive && !pageOpen}
            />
        </>
    );
};

// Memoised because App re-renders on every store write anywhere in the app, while `homeModel`
// only changes for the 35 values it is actually built from. Without this the whole home tree
// re-runs for a volume drag.
export default React.memo(Home);
