import { useSyncExternalStore } from 'react';
import { assertBuiltinSceneList, BUILTIN_SCENE_IDS, sceneIdKind } from '../../types/sceneIds';
import { checkSceneManifest, type SceneDefinition, type SceneEntryModule } from './definition';
import { useSceneSettingsStore } from './settings/useSceneSettingsStore';

// src/components/scenes/registry.ts
// 场景名单：内建场景由 import.meta.glob 从 ./<id>/entry.ts 发现，模组和数据包的场景在运行时登记、撤下。
// 名单只读清单，不加载场景代码（load 在第一次显示时才调）。

type SceneModules = Record<string, SceneEntryModule>;

/** The built-in scenes found in their entry folders; throws on a list or manifest that does not hold. */
export const buildBuiltinScenes = (modules: SceneModules, declared: readonly string[] = BUILTIN_SCENE_IDS): SceneDefinition[] => {
    const scenes = Object.entries(modules).map(([path, module]) => {
        const definition = module.default;
        if (!definition) throw new Error(`[SceneRegistry] Missing default export in ${path}`);
        const folder = path.split('/').at(-2);
        const { id } = definition.manifest;
        if (folder !== id) throw new Error(`[SceneRegistry] ${path} declares id "${id}", its folder is "${folder}"`);
        if (sceneIdKind(id) !== 'builtin') throw new Error(`[SceneRegistry] "${id}" is no built-in scene id (see src/types/sceneIds.ts)`);
        const problems = checkSceneManifest(definition.manifest);
        if (problems.length > 0) throw new Error(`[SceneRegistry] ${path}: ${problems.join('; ')}`);
        return definition;
    });
    assertBuiltinSceneList(scenes.map(scene => scene.manifest.id), declared);
    return scenes;
};

const byOrder = (left: SceneDefinition, right: SceneDefinition) => (left.manifest.order ?? 0) - (right.manifest.order ?? 0);

let scenes: SceneDefinition[] = buildBuiltinScenes(import.meta.glob<SceneEntryModule>('./*/entry.ts', { eager: true })).sort(byOrder);
const listeners = new Set<() => void>();

const publish = (next: SceneDefinition[]) => {
    scenes = next.sort(byOrder);
    listeners.forEach(listener => listener());
};

export const listScenes = (): readonly SceneDefinition[] => scenes;

export const getScene = (id: string | null | undefined): SceneDefinition | null =>
    (id ? scenes.find(scene => scene.manifest.id === id) : undefined) ?? null;

/**
 * Adds a mod's or a data package's scene (`mod:` / `pkg:` id) to the live list. Refused, with the reason
 * logged, when the id is not one of those or is taken, or the manifest does not hold.
 */
export const registerScene = (definition: SceneDefinition): boolean => {
    const { id } = definition.manifest;
    const kind = sceneIdKind(id);
    const problems = kind === 'mod' || kind === 'pkg' ? checkSceneManifest(definition.manifest) : [`"${id}" needs a mod: or pkg: prefix`];
    if (getScene(id)) problems.push(`"${id}" is registered already`);
    if (problems.length > 0) {
        console.warn('[SceneRegistry] scene refused', id, problems);
        return false;
    }
    publish([...scenes, definition]);
    console.info('[SceneRegistry] scene registered', id);
    return true;
};

/** Removes a scene registerScene added. Built-in scenes stay. */
export const unregisterScene = (id: string): boolean => {
    if (sceneIdKind(id) === 'builtin' || !getScene(id)) return false;
    publish(scenes.filter(scene => scene.manifest.id !== id));
    return true;
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** The live list, re-rendering when a mod adds or removes a scene. */
export const useSceneList = (): readonly SceneDefinition[] => useSyncExternalStore(subscribe, listScenes, listScenes);

/** The scene chosen in the settings, when it is registered (a mod's may not have loaded yet); null for the plain player page. */
export const useChosenScene = (): SceneDefinition | null => {
    const sceneId = useSceneSettingsStore(state => state.sceneId);
    const list = useSceneList();
    return sceneId ? list.find(scene => scene.manifest.id === sceneId) ?? null : null;
};
