# Code Map (代码地图)

This document provides an overview of the source code structure and maps components to their corresponding user interface elements.
本文档提供了源代码结构的概览，并将组件映射到其对应的用户界面元素。

## 📂 Project Structure (项目结构)

- **`src/`**: Root source directory.
    - **`components/`**: React UI components (UI组件).
    - **`services/`**: API and backend logic interaction (服务与API).
    - **`utils/`**: Helper functions and utilities (工具函数).
    - **`i18n/`**: Internationalization files (多语言配置).
    - **`App.tsx`**: Main Application Entry (应用主入口).

## 🧩 Components & UI Mapping (组件与界面对应)

Here is a mapping of key components to the parts of the application they render.
以下是关键组件与其渲染的应用程序部分的映射。

### Core Views (核心视图)

| Component (File) | Name (EN/CN) | Description / UI Location |
| :--- | :--- | :--- |
| **`App.tsx`** | **App Root** (应用入口) | Manages global state (player, user, theme), background, and audio context. The root container. <br> 管理全局状态（播放器、用户、主题）、背景和音频上下文。 |
| **`Home.tsx`** | **Home Dashboard** (主页) | The main landing page. Contains the Search bar, Playlist Carousel, and Local Music toggle. <br> 主登陆页面。包含搜索栏、歌单轮播图和本地音乐切换入口。 |
| **`PlaylistView.tsx`** | **Playlist Detail** (歌单详情页) | Displays the list of songs in an online Netease playlist. <br> 显示网易云歌单中的歌曲列表。 |
| **`AlbumView.tsx`** | **Album Detail** (专辑详情页) | Displays details and songs of a specific online album. <br> 显示特定在线专辑的详情和歌曲。 |
| **`LocalMusicView.tsx`** | **Local Music List** (本地音乐列表) | The list view for local music folders and files within the Home tab. <br> 主页标签下的本地音乐文件夹和文件列表视图。 |
| **`LocalPlaylistView.tsx`**| **Local Playlist Detail** (本地歌单详情)| Displays songs within a specific local folder or album category. <br> 显示特定本地文件夹或专辑分类中的歌曲。 |

### Visuals & Player (视觉与播放器)

| Component (File) | Name (EN/CN) | Description / UI Location |
| :--- | :--- | :--- |
| **`UnifiedPanel.tsx`** | **Unified Control Panel** (统一控制面板) | The floating side panel (expandable) containing **Cover**, **Controls**, **Queue**, and **Account** tabs. <br> 悬浮侧边栏（可展开），包含**封面**、**控制**、**播放队列**和**账户**标签页。 |
| **`LyricsTimelineModal.tsx`**| **Immersive Lyrics** (沉浸式歌词页) | Full-screen scrolling lyrics view with timeline interaction. <br> 全屏滚动歌词视图，支持时间轴交互。 |
| **`Visualizer.tsx`** | **Lyrics Animation** (歌词动画) | Renders the animated lyrics and lyric translation on the playback page. <br> 渲染播放页面上的歌词动画和歌词翻译。 |
| **`GeometricBackground.tsx`**| **Dynamic Background** (动态背景) | The animated geometric shapes floating in the background. <br> 背景中漂浮的动态几何图形。 |
| **`Carousel3D.tsx`** | **3D Carousel** (3D轮播图) | The cover flow style playlist selector on the Home page. <br> 主页上的 Cover Flow 风格歌单选择器。 |
| **`FloatingPlayerControls.tsx`**| **Mobile Controls** (移动端播放栏) | Simplified player controls docked at the bottom for smaller screens. <br> 针对小屏幕底部停靠的简化播放控制栏。 |
| **`ProgressBar.tsx`** | **Progress Bar** (进度条) | Reusable drag-enabled progress slider. <br> 可复用的可拖拽进度滑块。 |

### Modals & Dialogs (弹窗与对话框)

| Component (File) | Name (EN/CN) | Description / UI Location |
| :--- | :--- | :--- |
| **`LyricMatchModal.tsx`** | **Lyric Match** (歌词匹配弹窗) | Modal to search and manually link online metadata to a local song. <br> 用于搜索并将在线元数据手动关联到本地歌曲的弹窗。 |
| **`HelpModal.tsx`** | **Help & About** (帮助与关于) | Displays keyboard shortcuts and application info. <br> 显示键盘快捷键和应用程序信息。 |
| **`DeleteFolderConfirmModal.tsx`**| **Delete Confirm** (删除确认) | Confirmation dialog when removing a local folder. <br> 删除本地文件夹时的确认对话框。 |

## 🛠 Services & Logic (服务与逻辑)

- **`netease.ts`**: **Netease API** (网易云API) - Handles requests to the music provider.
- **`localMusicService.ts`**: **Local Service** (本地服务) - Manages file system access and metadata parsing.
- **`db.ts`**: **Database** (数据库) - IndexedDB wrapper for caching songs/images.
- **`lrcParser.ts` / `yrcParser.ts`**: **Lyric Parsers** (歌词解析) - Parses standard LRC and enhanced YRC lyrics.
- **`chorusDetector.ts`**: **Chorus Detector** (副歌检测) - Algorithmic detection of song highlights.
