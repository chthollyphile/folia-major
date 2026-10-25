import { listScenes } from '../../scenes/registry';
import { useSceneSettingsStore } from '../../scenes/settings/useSceneSettingsStore';
import { sceneIdKind } from '../../../types/sceneIds';
import { createToggleCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/sceneCommands.ts
// 场景的命令：切到每个内建场景（按名单生成，id `scene-<id>`，文案在三份语言文件的 commandPalette.commands 里）、
// 退出场景，以及开发时用的「重新加载场景」。模组和数据包的场景没有自己的命令，在选择器里选。

const sceneActive = () => useSceneSettingsStore.getState().sceneId !== null;

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
        'scene-reload',
        'visualizer',
        'Reload the scene',
        'Load the scene on the player page again, after changing its files',
        ['scene reload', 'refresh scene', '重新加载场景', '刷新场景'],
        () => useSceneSettingsStore.getState().reloadScene(),
        { isAvailable: () => import.meta.env.DEV && sceneActive() },
    ),
];
