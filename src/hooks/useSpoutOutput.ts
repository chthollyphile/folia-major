import { useCallback, useEffect, useState } from 'react';
import type { SpoutOutputConfigPatch, SpoutOutputStatus } from '../types/spoutOutput';

// src/hooks/useSpoutOutput.ts
// Renderer-side state for the Windows-only Spout2 output: reads status over IPC, applies config
// patches, and mirrors every main-process status broadcast. Returns a null status outside Electron
// so callers can treat "no API" as "unsupported" without their own platform checks.

const unsupportedStatus = (): SpoutOutputStatus => ({
    supported: false,
    enabled: false,
    running: false,
    senderName: 'Folia',
    width: 1920,
    height: 1080,
    fps: 60,
    error: null,
});

const hasSpoutApi = () => Boolean(
    window.electron?.getSpoutOutputStatus && window.electron?.setSpoutOutputConfig,
);

export const useSpoutOutput = ({ isElectronWindow }: { isElectronWindow: boolean }) => {
    const [status, setStatus] = useState<SpoutOutputStatus>(() => unsupportedStatus());

    useEffect(() => {
        if (!isElectronWindow || !hasSpoutApi()) {
            setStatus(unsupportedStatus());
            return;
        }
        let cancelled = false;
        void window.electron?.getSpoutOutputStatus().then(nextStatus => {
            if (!cancelled) {
                setStatus(nextStatus);
            }
        }).catch(error => {
            console.warn('[Spout] Failed to read the Spout output status', error);
        });
        const unsubscribe = window.electron?.onSpoutOutputStatusChanged?.(nextStatus => {
            setStatus(nextStatus);
        });
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, [isElectronWindow]);

    // Sends a config patch and lets the resulting `spout-output-status-changed` broadcast update
    // `status`; the invoke's own return value is used as an immediate fallback for callers that
    // need the post-application state (the command palette status toast).
    const applyConfig = useCallback(async (patch: SpoutOutputConfigPatch) => {
        if (!hasSpoutApi()) {
            return unsupportedStatus();
        }
        try {
            const nextStatus = await window.electron?.setSpoutOutputConfig(patch);
            if (nextStatus) {
                setStatus(nextStatus);
            }
            return nextStatus ?? unsupportedStatus();
        } catch (error) {
            console.warn('[Spout] Failed to apply the Spout output config', error);
            throw error;
        }
    }, []);

    return { spoutStatus: status, applySpoutConfig: applyConfig };
};
