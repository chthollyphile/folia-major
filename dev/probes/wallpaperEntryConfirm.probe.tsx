import React, { useEffect, useState } from 'react';
import ConfirmDialog from '../../src/components/shared/ConfirmDialog';
import { useWallpaperEntryConfirmDialog } from '../../src/components/app/dialogs/useAppDialogsModel';
import { useDesktopSettingsStore } from '../../src/stores/useDesktopSettingsStore';
import type { ProbeDefinition } from './definition';

// dev/probes/wallpaperEntryConfirm.probe.tsx

/**
 * 进入壁纸模式前的首次确认：真实的 store 动作 + 真实的 ConfirmDialog 属性 hook（AppDialogs 同一份）。
 * 「设置卡片 / 命令面板 / 托盘请求」三个入口最终都调 handleToggleWallpaperMode，探针里用按钮代表它们，
 * saveSettings 被替换成记录器，调用结果镜像到 data 属性供用例断言。第一次进入确认并记下已确认，
 * 之后再次进入不再弹窗。
 */
const WallpaperEntryConfirmProbe: React.FC = () => {
    const [saved, setSaved] = useState<string[]>([]);
    const [ready, setReady] = useState(false);
    const wallpaperMode = useDesktopSettingsStore(state => state.wallpaperMode);
    const wallpaperEntryConfirmed = useDesktopSettingsStore(state => state.wallpaperEntryConfirmed);
    const dialog = useWallpaperEntryConfirmDialog(false);

    useEffect(() => {
        (window as unknown as { electron: unknown }).electron = {
            saveSettings: async (key: string, value: unknown) => {
                setSaved(prev => [...prev, `${key}=${String(value)}`]);
            },
        };
        setReady(true);
        return () => {
            delete (window as unknown as { electron?: unknown }).electron;
        };
    }, []);

    return (
        <div
            className="flex w-[480px] flex-col gap-4 p-8 text-zinc-100"
            data-probe-wallpaper-confirm={ready ? 'ready' : 'booting'}
            data-probe-saved={saved.join(',')}
            data-probe-wallpaper-mode={String(wallpaperMode)}
            data-probe-confirmed={String(wallpaperEntryConfirmed)}
        >
            <button
                type="button"
                data-probe="enter"
                className="rounded bg-zinc-800 px-3 py-2"
                onClick={() => useDesktopSettingsStore.getState().handleToggleWallpaperMode(true)}
            >
                enter
            </button>
            <button
                type="button"
                data-probe="leave"
                className="rounded bg-zinc-800 px-3 py-2"
                onClick={() => useDesktopSettingsStore.getState().handleToggleWallpaperMode(false)}
            >
                leave
            </button>
            <ConfirmDialog {...dialog} />
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'wallpaperEntryConfirm',
    title: 'Wallpaper mode · 进入前确认',
    description: '第一次进入先弹确认，取消不进入、确认后才写入 wallpaper_mode；之后进入不再弹窗；退出不弹确认；文案说明退出方式。',
    Component: WallpaperEntryConfirmProbe,
};

export default probe;
