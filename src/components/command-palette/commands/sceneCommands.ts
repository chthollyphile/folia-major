import { listScenes } from '../../scenes/registry';
import { useSceneSettingsStore } from '../../scenes/settings/useSceneSettingsStore';
import { sceneIdKind } from '../../../types/sceneIds';
import { createToggleCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/sceneCommands.ts
// 场景的命令：切到每个内建场景（按名单生成，id `scene-<id>`，文案在三份语言文件的 commandPalette.commands 里）、
// 退出场景、房间声音开关和耳机/音箱（场景设置里的同两项），以及开发时用的「重新加载场景」。
// 模组和数据包的场景没有自己的命令，在选择器里选。

const sceneActive = () => useSceneSettingsStore.getState().sceneId !== null;
const roomOutputIs = (output: 'headphones' | 'speakers') => useSceneSettingsStore.getState().roomOutput === output;

export const sceneCommands: CommandPaletteCommand[] = [
    ...listScenes()
        .filter(scene => sceneIdKind(scene.manifest.id) === 'builtin')
        .map(scene => createToggleCommand(
            `scene-${scene.manifest.id}`,
            'visualizer',
            `Scene: ${scene.manifest.name.en ?? scene.manifest.id}`,
            'Make the player page this scene',
            ['scene', '场景'],
            () => useSceneSettingsStore.getState().setSceneId(scene.manifest.id),
        )),
    createToggleCommand(
        'scene-exit',
        'visualizer',
        'Leave the scene',
        'Back to the lyric style and background on the player page',
        ['scene off', 'exit scene', '场景', '退出场景', '关闭场景'],
        () => useSceneSettingsStore.getState().setSceneId(null),
        { isAvailable: sceneActive },
    ),
    createToggleCommand(
        'scene-room-sound',
        'visualizer',
        'Room sound on or off',
        "Hear the music as in the scene's room, or as on the plain player page",
        ['room sound', 'scene sound', '房间声音', '场景声音', '回声'],
        () => {
            const { roomSound, setRoomSound } = useSceneSettingsStore.getState();
            setRoomSound(!roomSound);
        },
        { isAvailable: sceneActive },
    ),
    createToggleCommand(
        'scene-room-headphones',
        'visualizer',
        'Room sound for headphones',
        "Make the scene's room sound for listening on headphones",
        ['headphones', 'room sound', '耳机', '房间声音'],
        () => useSceneSettingsStore.getState().setRoomOutput('headphones'),
        { isAvailable: () => sceneActive() && !roomOutputIs('headphones') },
    ),
    createToggleCommand(
        'scene-room-speakers',
        'visualizer',
        'Room sound for speakers',
        "Make the scene's room sound for listening on speakers",
        ['speakers', 'room sound', '音箱', '扬声器', '房间声音'],
        () => useSceneSettingsStore.getState().setRoomOutput('speakers'),
        { isAvailable: () => sceneActive() && !roomOutputIs('speakers') },
    ),
    createToggleCommand(
        'scene-reload',
        'visualizer',
        'Reload the scene',
        'Load the scene on the player page again, after changing its files',
        ['scene reload', 'refresh scene', '重新加载场景', '刷新场景'],
        () => useSceneSettingsStore.getState().reloadScene(),
        { isAvailable: () => import.meta.env.DEV && sceneActive() },
    ),
];
