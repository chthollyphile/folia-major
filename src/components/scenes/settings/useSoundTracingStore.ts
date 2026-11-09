import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from '../../../stores/storagePrimitives';

// src/components/scenes/settings/useSoundTracingStore.ts
// 声线追踪的设置，所有场景共用：开不开、用耳机还是音箱听（用户自己选，不按设备猜）。默认关，用户自己打开。
// 和场景的画面设置（useSceneSettingsStore）分开存。

// 键名是这个功能叫「房间声音」时定的；用户已经存了值，所以不改名。
export const SOUND_TRACING_ENABLED_KEY = 'scene_room_sound';
export const SOUND_TRACING_OUTPUT_KEY = 'scene_room_output';

export type SoundTracingOutput = 'headphones' | 'speakers';

/** Headphones until the user says otherwise: the prototype's hall was made and heard on them. */
const readOutput = (): SoundTracingOutput => (getStoredString(SOUND_TRACING_OUTPUT_KEY, 'headphones') === 'speakers' ? 'speakers' : 'headphones');

interface SoundTracingState {
    /** The music sounds as in the scene's room (a scene with speakers); off, it plays as on the plain player page. */
    enabled: boolean;
    output: SoundTracingOutput;
    setEnabled: (enabled: boolean) => void;
    setOutput: (output: SoundTracingOutput) => void;
}

export const useSoundTracingStore = create<SoundTracingState>(set => ({
    enabled: getStoredBoolean(SOUND_TRACING_ENABLED_KEY, false),
    output: readOutput(),
    setEnabled: (enabled) => {
        setStoredBoolean(SOUND_TRACING_ENABLED_KEY, enabled);
        set({ enabled });
    },
    setOutput: (output) => {
        setStoredString(SOUND_TRACING_OUTPUT_KEY, output);
        set({ output });
    },
}));
