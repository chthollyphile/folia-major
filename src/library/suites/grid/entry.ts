import type { LibraryAccountActionId } from '../../core/account/account.contract';
import type { LibraryHomeActionId, LibrarySuiteManifest } from '../../core/suite/suite.contract';
import Grid3D from './home/Grid3D';
import GridCollectionSurface from './collection/GridCollectionSurface';
import GridArtistSurface from './artist/GridArtistSurface';
import GridAccountSurface from './account/GridAccountSurface';
import { CollectionMorphOverlay } from './transitions/CollectionMorphOverlay';
import { gridHostTransitions } from './transitions/gridHostTransitions';
import { gridLayout } from './gridLayout';

// src/library/suites/grid/entry.ts
// 网格 suite（默认 suite）：实现全部 surface（首页、集合、歌手页与 A5 起的账户），任何别的 suite 没实现的 surface 都由它渲染。
//
// 这里的组件是即时 import，不是 React.lazy——这是默认 suite 唯一的例外（别的 entry 必须 lazy，
// test/unit/library/suiteEntries.test.ts 检查）：
// - Grid3D 在首屏。lazy 会让首页第一次渲染先挂起、等一个 chunk，React 19 还会为 Suspense 的揭示节流，
//   首屏因此晚出现；
// - 移形换影要在首页卡片被点的那一刻量到网格集合层的 hero，转场层也必须从挂载起就在（捕获首页卡片的点击）。
//   集合层或转场层 lazy 的话，第一次打开集合时它们还没加载，第一次转场就会丢；
// - registry 只被首页外壳（Home）、集合宿主和 suite 切换引用，而它们本来就静态 import 这些组件，
//   即时 import 不会把网格拉进任何原本不含它的模块。
// - 账户 surface（登录弹窗与切换确认框）在 A4 时由首页外壳里的账户宿主即时 import；改由 registry 解析后仍然即时，
//   登录弹窗第一次出现不必等 chunk。

// 首页：GridMap 的筛选、批量面板（批选、播放 / 入队、新建歌单、删除，目录树上的重扫根 / 移除根 / 恢复忽略目录）、
// 隐藏管理（卡片上的眼睛按钮），以及本地 / Navidrome 列表右上角的导入与刷新。toggle-hidden 与三个根上的动作
// 网格用卡片 / 目录树上的按钮做，不经命令面板（GridMap 没有焦点那一项，目录 surface 不发布它们）。
// 这份声明经宿主传到 GridMap：目录 surface 发布的命令 = core 判定 ∩ 这里的声明（与 TUI 的目录同一条规则）。
const GRID_HOME_ACTIONS: readonly LibraryHomeActionId[] = [
    'directory-filter',
    'directory-select',
    'directory-play-selection',
    'directory-enqueue-selection',
    'directory-create-playlist',
    'directory-remove-selection',
    'directory-rescan-root',
    'directory-remove-root',
    'directory-clear-ignore',
    'directory-manage-hidden',
    'directory-toggle-hidden',
    'home-import-folder',
    'home-refresh-folders',
    'home-import-playlist',
    'home-refresh-navidrome',
];

// 账户：切换确认框（GridAccountSurface）；登录（二维码或浏览器、QQ 两步选方式、重来、关闭、失败详情与诊断、本地服务
// 重启）在共用的登录窗口里，首页的登录按钮和右下角的药丸打开它，选平台与登出也在窗口里。全部 7 个动作都实现。
const GRID_ACCOUNT_ACTIONS: readonly LibraryAccountActionId[] = [
    'account-login',
    'account-login-method',
    'account-switch-confirm',
    'account-select',
    'account-logout',
    'account-login-diagnostics',
    'account-backend-restart',
];

const grid: LibrarySuiteManifest = {
    id: 'grid',
    labelKey: 'libraryTui.rendererGrid',
    surfaces: {
        home: { component: Grid3D, actions: GRID_HOME_ACTIONS },
        collection: {
            component: GridCollectionSurface,
            actions: [
                'play',
                'enqueue',
                'play-scope',
                'enqueue-scope',
                // 速记簿：聚焦卡片与曲目侧栏行上的「加入速记簿」，信息面板的「全部加入速记簿」。
                'collect',
                'collect-scope',
                'filter',
                'sort',
                'reload',
                'resume-sync',
                'remove-entry',
                'subscribe',
                'rename',
                'delete-collection',
                'resync-folder',
                'resync-all-folders',
                'export-playlist',
                'edit-entity',
                'set-cover',
                'organize-song-info',
                'match-song',
                'add-to-playlist',
                'create-playlist',
                'daily-date',
                // 曲目卡片上的专辑名 / 歌手名：打开嵌套的专辑 / 歌手页。
                'open-album',
                'open-artist',
            ],
            extraActions: ['toggle-info-panel', 'toggle-track-list', 'toggle-edit-mode'],
        },
        artist: {
            component: GridArtistSurface,
            // 歌手页：播放 / 入队单曲（卡片）与热门歌曲（「加入热门歌曲」按钮；播放全部只经命令面板）、筛选专辑、
            // 错误态与专辑分页失败的「重试」（重新加载 / 续页）、编辑本地歌手实体（信息面板），专辑卡与歌曲卡上的
            // 专辑 / 歌手链接。
            actions: [
                'play',
                'enqueue',
                'play-scope',
                'enqueue-scope',
                'filter',
                'reload',
                'resume-sync',
                'edit-entity',
                'open-album',
                'open-artist',
            ],
        },
        account: { component: GridAccountSurface, actions: GRID_ACCOUNT_ACTIONS },
    },
    transitions: {
        Overlay: CollectionMorphOverlay,
        ...gridHostTransitions,
    },
    // 「完成」时宿主让网格忘掉这一层的集合 / 歌手页布局记录（sessionStorage）。
    layout: gridLayout,
};

export default grid;
