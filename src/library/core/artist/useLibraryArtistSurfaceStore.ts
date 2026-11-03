import { create } from 'zustand';
import type { LibraryArtistSurfaceHandle } from './artist.contract';

// src/library/core/artist/useLibraryArtistSurfaceStore.ts
// 命令面板此刻能操作的歌手页（P4.2）。与集合的 grid surface、首页的 directory surface 分开：歌手页的动作是
// 热门歌曲的播放 / 入队、重新加载、续专辑分页与编辑本地歌手，各自判断，互不掺和。
// 只有正在交互的那个歌手页注册；旧实例晚一步卸载时不会注销已经接手的新实例（换 suite、嵌套打开都会发生）。

type LibraryArtistSurfaceState = {
    artistSurface: LibraryArtistSurfaceHandle | null;
    /** 返回注销函数。注册会顶替之前的持有者。 */
    registerArtistSurface: (handle: LibraryArtistSurfaceHandle) => () => void;
};

export const useLibraryArtistSurfaceStore = create<LibraryArtistSurfaceState>((set, get) => ({
    artistSurface: null,
    registerArtistSurface: (handle) => {
        set({ artistSurface: handle });
        return () => {
            if (get().artistSurface === handle) {
                set({ artistSurface: null });
            }
        };
    },
}));

/** 注册歌手页 surface（动作，不需要订阅）。 */
export const registerLibraryArtistSurface: LibraryArtistSurfaceState['registerArtistSurface'] = (handle) => (
    useLibraryArtistSurfaceStore.getState().registerArtistSurface(handle)
);
