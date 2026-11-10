import React from 'react';
import type { LibraryAccountActionId } from '../../core/account/account.contract';
import type { LibrarySuiteManifest } from '../../core/suite/suite.contract';

// src/library/suites/tui/entry.ts
// 终端风格的列表 suite（开发验证专用，默认关闭）。显式设置 VITE_LIBRARY_TUI=true 才在开发版启用；
// 实现首页、集合、歌手页与账户四个 surface（P4.3 起歌手页不再回退网格，A6 起账户不再回退网格）。
// 生产构建里 import.meta.env.DEV 是常量 false：组件那一行连同动态 import 一起被摇掉，不会产出 TUI 的 chunk，
// registry 也因为 available: false 把它当作不存在（浮层不出现、选不到）。
// A6 起有自己的 account surface（LibraryTuiAccount）：扫码登录框与切换确认不再回退网格的 GridAccountSurface。

const ENABLE_TUI = import.meta.env.DEV && import.meta.env.VITE_LIBRARY_TUI === 'true';
const LibraryTuiView = ENABLE_TUI ? React.lazy(() => import('./LibraryTuiView')) : null;
const LibraryTuiHome = ENABLE_TUI ? React.lazy(() => import('./LibraryTuiHome')) : null;
const LibraryTuiArtist = ENABLE_TUI ? React.lazy(() => import('./LibraryTuiArtist')) : null;
const LibraryTuiAccount = ENABLE_TUI ? React.lazy(() => import('./LibraryTuiAccount')) : null;

// 账户（LibraryTuiAccount 与首页在线页签的平台列表）：全部 7 个动作都实现。
// - account-switch-confirm：方框里的切换确认，Enter / Esc（LibraryTuiAccount）。
// - account-select / account-logout：首页在线页签的平台列表（未登录时就是页签内容，已登录时 F2 打开），Enter 选平台、
//   Delete 登出当前且已登录的平台。
// - account-login / account-login-method / account-login-diagnostics / account-backend-restart：选未登录的平台打开共用的
//   登录窗口（src/components/login），选方式、失败详情与诊断、本地服务重启都在窗口里。
const TUI_ACCOUNT_ACTIONS: readonly LibraryAccountActionId[] = [
    'account-login',
    'account-login-method',
    'account-switch-confirm',
    'account-select',
    'account-logout',
    'account-login-diagnostics',
    'account-backend-restart',
];

const tui: LibrarySuiteManifest = {
    id: 'tui',
    labelKey: 'libraryTui.rendererTui',
    available: ENABLE_TUI,
    surfaces: LibraryTuiView && LibraryTuiHome && LibraryTuiArtist && LibraryTuiAccount
        ? {
            home: {
                component: LibraryTuiHome,
                // 首页（LibraryTuiHome）：命令面板筛选目录、Insert / Ctrl+A 批选、Ctrl+Enter 播放 / 入队选中的，
                // 新建歌单（命令面板或行内输入）、从曲库删除选中的（行内确认），焦点在导入根 / 被忽略的文件夹上时
                // 重扫根、移除根（行内确认）、恢复忽略目录，「管理隐藏」视图与焦点歌单的隐藏 / 取消隐藏；
                // 本地的导入文件夹、刷新、导入歌单文件（隐藏的文件选择框）与 Navidrome 的刷新。
                // 在线账户的平台列表（选平台、登出）也在首页上，但它的动作声明在 account surface 里（见 TUI_ACCOUNT_ACTIONS）。
                actions: [
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
                ],
            },
            collection: {
                component: LibraryTuiView,
                // 与 LibraryTuiView 现在做得到的一致：播放 / 入队焦点行与范围、筛选、本地排序、重新拉取、续传；
                // 变更动作：Delete 删焦点条目（每日推荐是不喜欢）、状态栏的订阅星标 / 改名 / 删除集合 / 每日推荐日期、
                // 行上的手动匹配，来源维护（重扫、导出、编辑实体、整理）经命令面板。行上的歌手 / 专辑名在能解析出目录引用时
                // 是按钮（P4.4），Alt+Enter / Alt+Shift+Enter 打开焦点行的专辑 / 歌手（嵌套压栈，返回时焦点回到这一行）。
                // 不声明 add-to-playlist / create-playlist：Navidrome 加入歌单要一个歌单选择器，TUI 还没有，
                // 这两个动作只在网格里出现。
                actions: [
                    'play',
                    'enqueue',
                    'play-scope',
                    'enqueue-scope',
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
                    'organize-song-info',
                    'match-song',
                    'daily-date',
                    'open-album',
                    'open-artist',
                ],
            },
            artist: {
                component: LibraryTuiArtist,
                // 歌手页（LibraryTuiArtist）：Enter 播放焦点热门歌曲（以可播放的热门歌曲为队列）、Shift+Enter 入队，
                // Ctrl+Enter 播放全部、Ctrl+Shift+Enter 加入热门歌曲（状态栏也有按钮，提示报队列实际收下的条数）；
                // 命令面板筛选专辑；状态栏的重新加载与「重试」（加载失败从头、专辑分页失败从失败处续）；本地歌手的编辑
                // （宿主的实体对话框）；Enter / 双击打开专辑，歌曲行上的歌手 / 专辑链接打开嵌套的歌手页 / 专辑。
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
            account: {
                component: LibraryTuiAccount,
                actions: TUI_ACCOUNT_ACTIONS,
            },
        }
        : {},
};

export default tui;
