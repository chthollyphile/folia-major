import { useEffect, useRef } from 'react';
import type { LibraryArtistSurfaceHandle, LibraryArtistSurfaceState } from './artist.contract';
import { registerLibraryArtistSurface } from './useLibraryArtistSurfaceStore';

// src/library/core/artist/useLibraryArtistSurfaceRegistration.ts
// 把屏幕上的歌手页交给命令面板，做法与 useLibraryDirectorySurfaceRegistration 相同：只在可交互时注册；
// 面板拿到的句柄经 latest-ref 读最近一次渲染的状态与动作，不读注册那一刻的闭包。

export const useLibraryArtistSurfaceRegistration = ({
    isInteractive,
    getState,
    run,
}: {
    /** 只有用户正看着的那个歌手页发布动作。 */
    isInteractive: boolean;
    getState: () => LibraryArtistSurfaceState;
    run: LibraryArtistSurfaceHandle['run'];
}) => {
    // 渲染时赋值而不是在 effect 里：effect 之前的窗口里面板会读到上一次渲染的状态、调到上一次渲染的动作。
    const latestRef = useRef({ getState, run });
    latestRef.current = { getState, run };

    useEffect(() => {
        if (!isInteractive) return;
        return registerLibraryArtistSurface({
            getState: () => latestRef.current.getState(),
            run: action => latestRef.current.run(action),
        });
    }, [isInteractive]);
};
