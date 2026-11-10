import { create } from 'zustand';

// src/services/onlineMusic/netease/useNeteaseApiStatusStore.ts
// Mirrors the Electron NetEase backend lifecycle into the renderer.
//
// The local NetEase server is a hard dependency of every NetEase feature, including QR login: when
// the xeapi public key cannot be resolved at startup it never begins listening. The login modal
// used to render that as a bare "登录错误" with no recovery short of restarting the app, so the
// status and the restart action live here where the modal can reach them.

type NeteaseApiStatusState = {
    /** false on the web build, where there is no Electron backend to watch or restart. */
    supported: boolean;
    status: ElectronNeteaseApiStatus | null;
    restarting: boolean;
    setSupported: (supported: boolean) => void;
    setStatus: (status: ElectronNeteaseApiStatus) => void;
    restart: () => Promise<void>;
};

const getBridge = () => {
    if (typeof window === 'undefined' || !window) return null;
    return (window as any).electron ?? null;
};

export const useNeteaseApiStatusStore = create<NeteaseApiStatusState>((set, get) => ({
    supported: false,
    status: null,
    restarting: false,
    setSupported: (supported) => set({ supported }),
    setStatus: (status) => set({ status }),
    restart: async () => {
        const bridge = getBridge();
        if (typeof bridge?.restartNeteaseApi !== 'function' || get().restarting) return;

        set({ restarting: true });
        try {
            // Main serializes concurrent attempts, so the resolved value is always the settled
            // status of whichever attempt is in flight.
            const next = await bridge.restartNeteaseApi();
            if (next) set({ status: next });
        } catch (error) {
            console.warn('[Electron] Failed to restart Netease API', error);
        } finally {
            set({ restarting: false });
        }
    },
}));
