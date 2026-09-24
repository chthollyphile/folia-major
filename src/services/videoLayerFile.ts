import { getFromCache, removeFromCache, saveToCache } from './db';

// src/services/videoLayerFile.ts
// Local video file for the video layer behind the lyrics. Where the File System Access API exists
// (Chromium, Electron) the pick is a FileSystemFileHandle kept in IndexedDB, so it survives a
// restart without copying the video anywhere. Elsewhere the pick falls back to <input type=file>
// and lasts for the session only.

const VIDEO_LAYER_FILE_HANDLE_KEY = 'video_layer_file_handle';

type PermissionAwareFileHandle = FileSystemFileHandle & {
    queryPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
};

type OpenFilePickerWindow = Window & {
    showOpenFilePicker?: (options: {
        multiple?: boolean;
        excludeAcceptAllOption?: boolean;
        types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle[]>;
};

export type PickedVideoFile = {
    file: File;
    /** Null when the pick came from the <input> fallback and cannot be restored later. */
    handle: FileSystemFileHandle | null;
};

export const canPersistVideoLayerFile = (): boolean => (
    typeof window !== 'undefined' && typeof (window as OpenFilePickerWindow).showOpenFilePicker === 'function'
);

const pickWithInput = (): Promise<File | null> => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
});

/** Opens the native picker for one video; null when the user cancels. Must run inside a user gesture. */
export const pickVideoLayerFile = async (): Promise<PickedVideoFile | null> => {
    const picker = (window as OpenFilePickerWindow).showOpenFilePicker;
    if (!picker) {
        const file = await pickWithInput();
        return file ? { file, handle: null } : null;
    }
    try {
        const [handle] = await picker({
            multiple: false,
            types: [{
                description: 'Video',
                accept: { 'video/*': ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.ogv'] },
            }],
        });
        if (!handle) return null;
        return { file: await handle.getFile(), handle };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        throw error;
    }
};

export const saveVideoLayerFileHandle = (handle: FileSystemFileHandle) => saveToCache(VIDEO_LAYER_FILE_HANDLE_KEY, handle);

export const loadVideoLayerFileHandle = () => getFromCache<FileSystemFileHandle>(VIDEO_LAYER_FILE_HANDLE_KEY);

export const clearVideoLayerFileHandle = () => removeFromCache(VIDEO_LAYER_FILE_HANDLE_KEY);

export type VideoLayerFileReadResult =
    | { status: 'ready'; file: File }
    | { status: 'needs-permission' }
    | { status: 'missing' };

/**
 * Reads the stored handle's file. Without `request` it never prompts: a handle whose read
 * permission lapsed (a browser restart outside Electron) reports `needs-permission`, and the
 * settings UI asks again from a click. `missing` means the file was moved or deleted.
 */
export const readVideoLayerFileHandle = async (
    handle: FileSystemFileHandle,
    request: boolean,
): Promise<VideoLayerFileReadResult> => {
    const permissionAware = handle as PermissionAwareFileHandle;
    let permission: PermissionState = (await permissionAware.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (permission !== 'granted' && request && permissionAware.requestPermission) {
        permission = await permissionAware.requestPermission({ mode: 'read' });
    }
    if (permission !== 'granted') return { status: 'needs-permission' };
    try {
        return { status: 'ready', file: await handle.getFile() };
    } catch {
        return { status: 'missing' };
    }
};
