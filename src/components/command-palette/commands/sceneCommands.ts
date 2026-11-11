import { getScene, listScenes } from '../../scenes/registry';
import { useSceneSettingsStore } from '../../scenes/settings/useSceneSettingsStore';
import { useSoundTracingStore, type SoundTracingOutput } from '../../scenes/settings/useSoundTracingStore';
import { sceneIdKind } from '../../../types/sceneIds';
import { createSettingsCommand, createToggleCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/sceneCommands.ts
// 场景的命令：切到每个内建场景（按名单生成，id `scene-<id>`，文案在三份语言文件的 commandPalette.commands 里）、
// 退出场景、声线追踪开关和耳机/音箱（设置「场景」页里的同两项），以及开发时用的「重新加载场景」。
// 声线追踪三条命令的 id 还是 `scene-room-*`：最近用过的命令按 id 存着，改名会丢掉。
// 模组和数据包的场景没有自己的命令，在选择器里选。

const sceneActive = () => useSceneSettingsStore.getState().sceneId !== null;
/** Same check as the scene window's sound tracing row (SoundTracingGroup.tsx): the chosen scene plays music through its speakers. */
const sceneHasRoomSound = () => getScene(useSceneSettingsStore.getState().sceneId)?.manifest.sound?.music === 'speakers';
const outputIs = (output: SoundTracingOutput) => useSoundTracingStore.getState().output === output;

export const sceneCommands: CommandPaletteCommand[] = [
    createSettingsCommand('settings-scene', 'Scene settings', 'Open the scene window', ['scene', 'cinema', '场景', '影厅', '场景设置'], 'options', 'scene'),
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
        'Sound tracing on or off',
        "Hear the music as in the scene's room, or as on the plain player page",
        ['sound tracing', 'room sound', 'scene sound', '声线追踪', '房间声音', '场景声音', '回声'],
        () => {
            const { enabled, setEnabled } = useSoundTracingStore.getState();
            setEnabled(!enabled);
        },
        { isAvailable: sceneHasRoomSound, platform: ['electron'] },
    ),
    createToggleCommand(
        'scene-room-headphones',
        'visualizer',
        'Sound tracing for headphones',
        "Make the scene's sound for listening on headphones",
        ['headphones', 'sound tracing', '耳机', '声线追踪'],
        () => useSoundTracingStore.getState().setOutput('headphones'),
        { isAvailable: () => sceneHasRoomSound() && !outputIs('headphones'), platform: ['electron'] },
    ),
    createToggleCommand(
        'scene-room-speakers',
        'visualizer',
        'Sound tracing for speakers',
        "Make the scene's sound for listening on speakers",
        ['speakers', 'sound tracing', '音箱', '扬声器', '声线追踪'],
        () => useSoundTracingStore.getState().setOutput('speakers'),
        { isAvailable: () => sceneHasRoomSound() && !outputIs('speakers'), platform: ['electron'] },
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
