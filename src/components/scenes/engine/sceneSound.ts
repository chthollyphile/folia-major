import { createRoomSound, type RoomSound } from '../../../services/sceneSound/sceneSound';
import type { SceneAnchor, SceneSound } from '../definition';
import { useSceneSettingsStore } from '../settings/useSceneSettingsStore';

// src/components/scenes/engine/sceneSound.ts
// 声音接上来的地方。主窗口播放页上、清单写了 sound.music 'speakers' 的场景拿到真的房间声
// （src/services/sceneSound/）：听者在用户选的座位上，开关和耳机/音箱来自场景设置。
// 其余情况（预览、OBS、不放音乐的场景）拿到什么都不做的实现（tier 'off'），音乐照原样放。

export const silentSceneSound: SceneSound = {
    setAcoustics: () => {},
    moveObject: () => {},
    setListener: () => {},
    play: () => ({ stop: () => {} }),
    tier: 'off',
};

/**
 * The room sound for one running scene, kept in step with the scene settings: the switch, headphones or
 * speakers, and the seat chosen on the seat map (none chosen: the scene's preferred seat).
 */
export const createHostSceneSound = (sceneId: string, anchors: () => readonly SceneAnchor[]): { sound: RoomSound; dispose: () => void } => {
    const sound = createRoomSound({
        anchors: {
            viewpoints: () => anchors().filter((anchor): anchor is Extract<SceneAnchor, { kind: 'viewpoint' }> => anchor.kind === 'viewpoint'),
            speakers: () => anchors().filter((anchor): anchor is Extract<SceneAnchor, { kind: 'speaker' }> => anchor.kind === 'speaker'),
        },
    });
    let seat: string | null = null;
    const sync = () => {
        const state = useSceneSettingsStore.getState();
        sound.setOptions({ enabled: state.roomSound, output: state.roomOutput });
        const chosen = state.sceneOptions[sceneId]?.viewpoint ?? null;
        if (chosen !== seat) {
            seat = chosen;
            sound.setListener({ viewpoint: chosen ?? '' });
        }
    };
    sync();
    const unsubscribe = useSceneSettingsStore.subscribe(sync);
    return {
        sound,
        dispose: () => {
            unsubscribe();
            sound.dispose();
        },
    };
};
