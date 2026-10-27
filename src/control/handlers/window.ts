import { ControlError, optionalBoolean, requireString } from '../errors';
import { readWindowStatus } from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/window.ts
// Electron main-window controls through the preload bridge. Outside the desktop build these answer
// `unsupported` rather than pretending to work.

type ElectronWindowApi = NonNullable<Window['electron']>;

const getElectron = (): ElectronWindowApi | null => (
    typeof window !== 'undefined' ? window.electron ?? null : null
);

const requireElectron = (action: string): ElectronWindowApi => {
    const electron = getElectron();
    if (!electron) {
        throw new ControlError('unsupported', `Window action "${action}" needs the Electron desktop app`);
    }
    return electron;
};

const requireMethod = <T extends(...args: never[]) => unknown>(
    action: string,
    method: T | undefined,
): T => {
    if (!method) {
        throw new ControlError('unsupported', `Window action "${action}" is not supported by this build`);
    }
    return method;
};

export const windowHandlers: Record<string, ControlHandler> = {
    folia_window: async (args) => {
        const action = requireString(args.action, 'action');
        const value = optionalBoolean(args.value, 'value');

        if (action === 'status') {
            return await readWindowStatus();
        }

        const electron = requireElectron(action);
        switch (action) {
            case 'minimize': {
                const minimize = requireMethod(action, electron.minimizeWindow);
                await minimize();
                break;
            }
            case 'maximize': {
                const toggleMaximize = requireMethod(action, electron.toggleMaximizeWindow);
                await toggleMaximize();
                break;
            }
            case 'fullscreen': {
                const toggleFullscreen = requireMethod(action, electron.toggleFullscreenWindow);
                await toggleFullscreen();
                break;
            }
            case 'alwaysOnTop': {
                const getAlwaysOnTop = requireMethod(action, electron.getMainWindowAlwaysOnTop);
                const setAlwaysOnTop = requireMethod(action, electron.setMainWindowAlwaysOnTop);
                const current = await getAlwaysOnTop();
                const target = value ?? !current;
                await setAlwaysOnTop(target);
                break;
            }
            case 'clickThrough': {
                const getClickThrough = requireMethod(action, electron.getMainWindowClickThroughEnabled);
                const setClickThrough = requireMethod(action, electron.setMainWindowClickThroughEnabled);
                const current = await getClickThrough();
                const target = value ?? !current;
                await setClickThrough(target);
                break;
            }
            case 'close': {
                const close = requireMethod(action, electron.closeWindow);
                await close();
                return { action, closed: true };
            }
            default:
                throw new ControlError('bad_request', `Unknown window action "${action}"`, {
                    actions: ['status', 'minimize', 'maximize', 'fullscreen', 'alwaysOnTop', 'clickThrough', 'close'],
                });
        }

        return { action, ...(await readWindowStatus()) };
    },
};
