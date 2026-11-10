import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createVideoExportPresets,
    DEFAULT_VIDEO_EXPORT_PRESET_ID,
    DEFAULT_VIDEO_EXPORT_PRESET_VALUES,
    sanitizeVideoExportPresetValues,
} from '../../types/videoExport';
import type { VideoExportPreset, VideoExportPresetValues, VideoExportStartMode } from '../../types/videoExport';
import { sendRemoteCommand } from './remoteWindowBridge';

// src/components/remote/useRemoteExportChoices.ts
// The remote window's three size presets and the recording range. A preset is two things at once:
// picking one resizes the main window to it right away, and a recording started afterwards is made
// at that size. The three sizes can be edited and are kept in this window's storage.

const REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY = 'remote_video_export_preset_values';

const readStoredPresetValues = (): VideoExportPresetValues => {
    if (typeof window === 'undefined') {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }

    const raw = window.localStorage.getItem(REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY);
    if (!raw) {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? sanitizeVideoExportPresetValues(parsed)
            : DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    } catch {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }
};

export interface RemoteExportChoices {
    presets: VideoExportPreset[];
    selectedPreset: VideoExportPreset;
    /** Selects the preset and resizes the main window to it. */
    selectPreset: (presetId: string) => void;
    /** Stores a size (clamped, made even) in the selected preset and resizes the main window to it. */
    saveCustomSize: (width: number, height: number) => void;
    startMode: VideoExportStartMode;
    setStartMode: (mode: VideoExportStartMode) => void;
}

export const useRemoteExportChoices = (): RemoteExportChoices => {
    const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_VIDEO_EXPORT_PRESET_ID);
    const [presetValues, setPresetValues] = useState<VideoExportPresetValues>(readStoredPresetValues);
    const [startMode, setStartMode] = useState<VideoExportStartMode>('from-start');
    const presets = useMemo(() => createVideoExportPresets(presetValues), [presetValues]);
    const selectedPreset = presets.find(preset => preset.id === selectedPresetId) ?? presets[1];

    useEffect(() => {
        window.localStorage.setItem(REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY, JSON.stringify(presetValues));
    }, [presetValues]);

    const selectPreset = useCallback((presetId: string) => {
        const preset = presets.find(item => item.id === presetId);
        if (!preset) {
            return;
        }

        setSelectedPresetId(preset.id);
        sendRemoteCommand({ type: 'resize-main-window', width: preset.width, height: preset.height });
    }, [presets]);

    const saveCustomSize = useCallback((width: number, height: number) => {
        const index = presets.findIndex(preset => preset.id === selectedPreset.id);
        if (index === -1 || !Number.isFinite(width) || !Number.isFinite(height)) {
            return;
        }

        const draft = [...presetValues];
        draft[index] = { width, height };
        const nextValues = sanitizeVideoExportPresetValues(draft);
        setPresetValues(nextValues);
        sendRemoteCommand({ type: 'resize-main-window', ...nextValues[index] });
    }, [presetValues, presets, selectedPreset.id]);

    return { presets, selectedPreset, selectPreset, saveCustomSize, startMode, setStartMode };
};

export type RemoteAspectKind = 'landscape' | 'portrait' | 'square' | 'ultrawide';

/** "16:9" and what kind of shape it is, or null for sizes that are not two positive numbers. */
export const describeRemoteAspectRatio = (width: number, height: number): { ratio: string; kind: RemoteAspectKind } | null => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(Math.round(width), Math.round(height));
    const aspectWidth = Math.round(width) / divisor;
    const aspectHeight = Math.round(height) / divisor;
    const kind: RemoteAspectKind = aspectWidth === aspectHeight
        ? 'square'
        : aspectWidth === 21 && aspectHeight === 9
            ? 'ultrawide'
            : aspectWidth > aspectHeight ? 'landscape' : 'portrait';

    return { ratio: `${aspectWidth}:${aspectHeight}`, kind };
};
