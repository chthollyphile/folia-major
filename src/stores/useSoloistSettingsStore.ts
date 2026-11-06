import { create } from 'zustand';
import type { SoloistStatus } from '../types/soloist';

// Share setup metadata and the action lock between the login page and direct palette actions.
export const useSoloistSettingsStore = create<{
    status: SoloistStatus | null;
    busy: boolean;
    error: string;
}>(() => ({ status: null, busy: false, error: '' }));

let refreshRevision = 0;
export async function refreshSoloistStatus(): Promise<void> {
    const revision = ++refreshRevision;
    try {
        const status = await window.electron?.soloistStatus?.();
        if (revision === refreshRevision) useSoloistSettingsStore.setState({ status: status ?? null, error: '' });
    } catch {
        if (revision === refreshRevision) useSoloistSettingsStore.setState({ status: null, error: 'unavailable' });
    }
}

let watchers = 0;
let watchRevision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
export function watchSoloistStatus(): () => void {
    if (typeof window === 'undefined' || !window.electron?.soloistStatus) return () => {};
    if (++watchers === 1) {
        const revision = ++watchRevision;
        const poll = async () => {
            await refreshSoloistStatus();
            if (watchers > 0 && revision === watchRevision) timer = setTimeout(poll, 4000);
        };
        void poll();
    }
    return () => {
        if (--watchers === 0) { watchRevision += 1; clearTimeout(timer); }
    };
}

export const soloistProgramInstalled = (status: SoloistStatus | null): boolean => (
    !!status?.binary && !['missing', 'invalid'].includes(status.binary.state)
);
export const soloistProgramUsable = (status: SoloistStatus | null): boolean => (
    soloistProgramInstalled(status) && status?.binary.state !== 'expired'
);
export const canReconnectSoloist = (): boolean => {
    const { status, busy } = useSoloistSettingsStore.getState();
    return !busy && status?.configured === true && soloistProgramUsable(status);
};
export const canCheckSoloistLifetime = (): boolean => {
    const { status, busy } = useSoloistSettingsStore.getState();
    return !busy && soloistProgramInstalled(status);
};

export async function runSoloistAction<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (useSoloistSettingsStore.getState().busy) return undefined;
    useSoloistSettingsStore.setState({ busy: true, error: '' });
    try { return await work(); }
    finally {
        await refreshSoloistStatus();
        useSoloistSettingsStore.setState({ busy: false });
    }
}
