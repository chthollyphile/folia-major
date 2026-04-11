# Code Map (代码地图)

This document reflects the current `src/` architecture and explains how the main modules fit together.
本文档对应当前 `src/` 的真实结构，用来快速说明主要模块及它们之间的关系。

## 1. High-Level Architecture

`App.tsx` is the orchestration center of the frontend.
`App.tsx` 是整个前端的调度中心，负责把三类音乐来源统一到同一套播放器状态里：

- Netease online library / 网易云在线曲库
- Local music library / 本地音乐库
- Navidrome remote library / Navidrome 远程曲库

Core responsibilities handled in `App.tsx`:
`App.tsx` 的核心职责包括：

- Global playback state: current song, queue, progress, loop mode, FM mode
- Unified loading of audio, cover, lyrics, theme, queue, and session restore
- Navigation between home, player, playlist, album, and artist overlays
- Coordinating Home view, fullscreen lyric visualizer, floating controls, and side panel
- Opening local / Navidrome lyric matching flows

## 2. Current Source Tree

```text
src/
├─ App.tsx
├─ index.tsx
├─ index.css
├─ README.md
├─ vite-env.d.ts
├─ types.ts
├─ types/
│  └─ navidrome.ts
├─ components/
│  ├─ Home.tsx
│  ├─ PlaylistView.tsx
│  ├─ AlbumView.tsx
│  ├─ ArtistView.tsx
│  ├─ LocalMusicView.tsx
│  ├─ local/LocalPlaylistView.tsx
│  ├─ navidrome/NavidromeMusicView.tsx
│  ├─ navidrome/NavidromeAlbumView.tsx
│  ├─ UnifiedPanel.tsx
│  ├─ FloatingPlayerControls.tsx
│  ├─ Visualizer.tsx
│  ├─ VisualizerCadenza.tsx
│  ├─ modal/LyricsTimelineModal.tsx
│  ├─ modal/LyricMatchModal.tsx
│  ├─ modal/NaviLyricMatchModal.tsx
│  ├─ modal/HelpModal.tsx
│  ├─ modal/DeleteFolderConfirmModal.tsx
│  ├─ Carousel3D.tsx
│  ├─ ProgressBar.tsx
│  ├─ GeometricBackground.tsx
│  ├─ FluidBackground.tsx
│  └─ panelTab/
│     ├─ CoverTab.tsx
│     ├─ ControlsTab.tsx
│     ├─ QueueTab.tsx
│     ├─ AccountTab.tsx
│     ├─ LocalTab.tsx
│     ├─ NaviTab.tsx
│     └─ FmTab.tsx
├─ hooks/
│  ├─ useAppNavigation.ts
│  ├─ useAppPreferences.ts
│  ├─ useNeteaseLibrary.ts
│  └─ useThemeController.ts
├─ services/
│  ├─ db.ts
│  ├─ netease.ts
│  ├─ navidromeService.ts
│  ├─ localMusicService.ts
│  ├─ onlinePlayback.ts
│  ├─ playbackAdapters.ts
│  ├─ prefetchService.ts
│  ├─ coverCache.ts
│  ├─ themeCache.ts
│  └─ gemini.ts
├─ utils/
│  ├─ lrcParser.ts
│  ├─ yrcParser.ts
│  ├─ chorusDetector.ts
│  ├─ colorExtractor.ts
│  ├─ songNameFormatter.tsx
│  ├─ localMetadataWorkerClient.ts
│  ├─ parser_test.ts
│  └─ lyrics/
│     ├─ types.ts
│     ├─ LyricAdapter.ts
│     ├─ LyricParserFactory.ts
│     ├─ workerClient.ts
│     ├─ timelineSplitter.ts
│     └─ adapters/
│        ├─ NeteaseLyricAdapter.ts
│        ├─ LocalFileLyricAdapter.ts
│        ├─ EmbeddedLyricAdapter.ts
│        └─ NavidromeLyricAdapter.ts
├─ workers/
│  ├─ lyricsParser.worker.ts
│  └─ metadataParser.worker.ts
└─ i18n/
   ├─ config.ts
   └─ locales/
      ├─ en.ts
      └─ zh-CN.ts
```

## 3. Main UI Modules

### App Shell

| File | Responsibility |
| :--- | :--- |
| `App.tsx` | Root orchestrator. Handles playback lifecycle, queue, theme, session restore, routing state, local/Navidrome integration, lyric modals, and global overlays. |
| `index.tsx` | React entry point. |
| `index.css` | Global styles and shared CSS tokens. |

### Home and Library Views

| File | Responsibility |
| :--- | :--- |
| `components/Home.tsx` | Main home surface. Contains search, Netease playlists, favorite albums, radio, local music tab, Navidrome tab, login modal, help/options modal, and search result overlay. |
| `components/PlaylistView.tsx` | Netease playlist detail page. |
| `components/AlbumView.tsx` | Netease album detail page. |
| `components/ArtistView.tsx` | Netease artist detail page. |
| `components/LocalMusicView.tsx` | Local library root view with folder / album grouping, refresh, match entry, and scan progress integration. |
| `components/local/LocalPlaylistView.tsx` | Local folder or local album detail list. |
| `components/navidrome/NavidromeMusicView.tsx` | Navidrome album browser with sort modes and configuration-aware empty state. |
| `components/navidrome/NavidromeAlbumView.tsx` | Navidrome album detail and playback entry. |

### Player and Visual Layer

| File | Responsibility |
| :--- | :--- |
| `components/Visualizer.tsx` | Classic lyric renderer with animated word-level timing and geometric background. |
| `components/VisualizerCadenza.tsx` | Newer lyric renderer with more advanced layout, layered glow, fluid background, and tunable typography/motion. |
| `components/GeometricBackground.tsx` | Audio-reactive geometric background. |
| `components/FluidBackground.tsx` | Cover-color-driven blurred fluid background. |
| `components/FloatingPlayerControls.tsx` | Mini player / mobile player controls shown globally. |
| `components/ProgressBar.tsx` | Shared draggable progress / slider UI. |
| `components/modal/LyricsTimelineModal.tsx` | Fullscreen timeline-oriented lyrics view. |

### Panel, Modals, and Supporting UI

| File | Responsibility |
| :--- | :--- |
| `components/UnifiedPanel.tsx` | Right-side floating panel used in player mode. Chooses tabs dynamically for cloud, local, FM, and Navidrome tracks. |
| `components/panelTab/CoverTab.tsx` | Cover card and artist/album jump entry. |
| `components/panelTab/ControlsTab.tsx` | Playback options, AI theme, day/night switch, background mode, and volume controls. |
| `components/panelTab/QueueTab.tsx` | Queue list and shuffle action. |
| `components/panelTab/AccountTab.tsx` | Netease account info, audio quality, cache size, sync, logout, and navigation back to home. |
| `components/panelTab/LocalTab.tsx` | Local-track-only tools: lyric source, online match, manual lyric editing, ReplayGain mode. |
| `components/panelTab/NaviTab.tsx` | Navidrome-track-only tools: lyric availability and online match entry. |
| `components/panelTab/FmTab.tsx` | Personal FM quick controls. |
| `components/modal/LyricMatchModal.tsx` | Manual Netease metadata/lyric matching for local songs. |
| `components/modal/NaviLyricMatchModal.tsx` | Manual Netease metadata/lyric matching for Navidrome songs. |
| `components/modal/HelpModal.tsx` | Help + options center. Also owns cache cleanup, visual options, Navidrome settings, and Electron AI settings. |
| `components/modal/DeleteFolderConfirmModal.tsx` | Confirm deletion of imported local folders. |
| `components/Carousel3D.tsx` | Shared 3D carousel used by playlists, albums, radio, and Navidrome browsing. |

## 4. Hooks Layer

| File | Responsibility |
| :--- | :--- |
| `hooks/useAppNavigation.ts` | Maintains app-level navigation state and browser history integration for home/player/playlist/album/artist. |
| `hooks/useAppPreferences.ts` | Stores user preferences: audio quality, static mode, media cache, daylight mode, visualizer mode, cadenza tuning, volume, mute state. |
| `hooks/useNeteaseLibrary.ts` | Loads user profile, playlists, liked songs, handles sync/logout, and manages Netease-related cache refresh. |
| `hooks/useThemeController.ts` | Manages default theme, AI theme, light/dark switching, theme restore, and theme generation flow. |

## 5. Services Layer

### Data Source Services

| File | Responsibility |
| :--- | :--- |
| `services/netease.ts` | Netease API wrapper used by search, playlists, albums, artists, lyrics, FM, and login. |
| `services/navidromeService.ts` | Subsonic/Navidrome client, config persistence, auth params, album/search/stream/lyrics helpers. |
| `services/localMusicService.ts` | Local library import/resync/delete pipeline, `.lrc` / `.vtt` pairing, folder-cover preference, embedded metadata parsing, cover hydration, file-handle recovery, local lyric matching, and scan progress events. |

### Playback and Cache Services

| File | Responsibility |
| :--- | :--- |
| `services/onlinePlayback.ts` | Loads cloud audio + lyrics with cache and prefetch awareness. |
| `services/playbackAdapters.ts` | Converts local and Navidrome tracks into the unified playback shape used by `App.tsx`. |
| `services/prefetchService.ts` | Prefetches nearby online songs in queue, including audio URLs, lyrics, and cover URLs. |
| `services/coverCache.ts` | Loads and caches cover blobs. |
| `services/themeCache.ts` | Restores cached song themes and last-used dual theme. |
| `services/db.ts` | IndexedDB wrapper for session data, media cache, metadata cache, user cache, local songs, persisted directory handles, and local library snapshots. |
| `services/gemini.ts` | Frontend bridge for AI theme generation APIs or Electron-provided theme generation. |

## 6. Lyrics and Parsing Stack

The lyric system now has a single parser core, with worker/factory/helpers layered around it.
现在歌词解析以单一 parser core 为真源，worker、factory 和特定来源 helper 都只是入口层：

| File | Responsibility |
| :--- | :--- |
| `utils/lyrics/parserCore.ts` | Single source of truth for LRC / enhanced LRC / YRC / VTT parsing, metadata extraction, translation alignment, interludes, and render hints. |
| `utils/lyrics/LyricParserFactory.ts` | Central entry. Dispatches by source type: `netease`, `local`, `embedded`, `navidrome`. |
| `utils/lyrics/LyricAdapter.ts` | Shared adapter contract. |
| `utils/lyrics/types.ts` | Raw lyric input types used by the factory/adapters. |
| `utils/lyrics/neteaseProcessing.ts` | Shared Netease lyric normalization flow: payload extraction, pure-music detection, parsing, and chorus decoration. |
| `utils/lyrics/adapters/NeteaseLyricAdapter.ts` | Parses Netease lyric payloads. |
| `utils/lyrics/adapters/LocalFileLyricAdapter.ts` | Parses external `.lrc` / `.vtt` lyric pairs, including translated variants. |
| `utils/lyrics/adapters/EmbeddedLyricAdapter.ts` | Parses embedded tag lyrics extracted from audio metadata. |
| `utils/lyrics/adapters/NavidromeLyricAdapter.ts` | Parses Navidrome/OpenSubsonic lyric payloads. |
| `utils/lyrics/workerClient.ts` | Frontend client for lyric parsing worker. |
| `workers/lyricsParser.worker.ts` | Off-main-thread execution layer that delegates parsing to `parserCore`. |
| `utils/lrcParser.ts` / `utils/yrcParser.ts` | Backward-compatible thin wrappers over `parserCore`. |
| `utils/lyrics/timelineSplitter.ts` | Splits combined lyric/translation timelines when needed. |
| `utils/lyrics/chorusEffects.ts` | Applies chorus annotations on top of parsed lyrics. |
| `utils/chorusDetector.ts` | Detects repeated chorus lines for visual effects. |

## 7. Metadata, Types, and Utilities

| File | Responsibility |
| :--- | :--- |
| `types.ts` | Core shared types: songs, local songs, lyrics, themes, player state, visualizer tuning, local snapshot structures. |
| `types/navidrome.ts` | Navidrome/Subsonic API and playback types. |
| `utils/localMetadataWorkerClient.ts` | Client for metadata extraction worker. |
| `workers/metadataParser.worker.ts` | Parses embedded tags, replay gain, duration, cover, and embedded lyrics off the main thread. |
| `utils/colorExtractor.ts` | Cover/image color extraction helpers. |
| `utils/songNameFormatter.tsx` | Shared song title formatting logic. |
| `i18n/config.ts` | i18n initialization. |
| `i18n/locales/en.ts` / `i18n/locales/zh-CN.ts` | Translation dictionaries. |

## 8. Practical Reading Order

If you want to understand the codebase quickly, read in this order:
如果想最快理解这套代码，建议按下面顺序看：

1. `App.tsx`
2. `types.ts`
3. `hooks/useAppNavigation.ts`
4. `hooks/useAppPreferences.ts`
5. `hooks/useThemeController.ts`
6. `components/Home.tsx`
7. `services/localMusicService.ts`
8. `services/navidromeService.ts`
9. `services/onlinePlayback.ts`
10. `utils/lyrics/LyricParserFactory.ts`

## 9. Notes

- The app now uses a unified playback model for cloud, local, and Navidrome tracks.
- `modal/HelpModal.tsx` is no longer only a help dialog; it is also the options/settings hub.
- `UnifiedPanel.tsx` is now composition-based through `panelTab/*`, instead of one monolithic control panel body.
- Local library import is incremental and snapshot-based, not just a simple one-time folder scan.
- The lyric pipeline now supports multiple sources and off-main-thread parsing.
