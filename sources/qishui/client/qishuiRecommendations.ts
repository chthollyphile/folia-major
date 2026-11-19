import type { FoliumSourceCollection, FoliumSourceFmCatalog, FoliumSourceRecommendations, FoliumText } from '@folia/folium';
import { personalFmModes } from '@folia/folium-source-kit';
import { requestQishui } from './qishuiTransport';
import { createQishuiSceneCover } from './qishuiSceneCover';
import { normalizeQishuiSong, qishuiImage } from './qishuiNormalize';

// sources/qishui/client/qishuiRecommendations.ts
// 车机的场景列表同时给电台卡片和私人 FM 的模式选择器（recommendations@1）。模式是 kit 的标准模式里汽水收的
// 四个，名字来自模组的语言表；场景和分组是平台写出来的字，原样交。宿主在没给选项时按听者选的模式问
// （personalFmModes: true，适配层补上 usePersonalFmModeStore 的选择）。

type Scene = { id: string; name: string; group: string; coverUrl?: unknown };
let catalogTask: Promise<FoliumSourceFmCatalog> | null = null;
let catalogAt = 0;
let scenes: Scene[] = [];
// Counts the clears, so that a catalogue read under the account before does not refill the list.
let generation = 0;
export function clearQishuiRecommendations() { generation++; catalogTask = null; scenes = []; catalogAt = 0; }

/** What the recommendations need of the host: the mod's own texts. */
export interface QishuiRecommendationsEnv {
    text(key: string): FoliumText;
}

export function createQishuiRecommendations(env: QishuiRecommendationsEnv): FoliumSourceRecommendations {
    const getCatalog = async (): Promise<FoliumSourceFmCatalog> => {
        if (!catalogTask || Date.now() - catalogAt > 10 * 60_000) {
            catalogAt = Date.now();
            const mine = generation;
            const task: Promise<FoliumSourceFmCatalog> = requestQishui<Scene[]>('feed_modes').then(rows => {
                const seen = new Set<string>();
                const read = rows.filter(row => /^\d+$/.test(row.id) && row.name && !seen.has(row.id) && Boolean(seen.add(row.id)));
                if (mine === generation) scenes = read;
                const groups = [...new Set(read.map(scene => scene.group))];
                return {
                    modes: personalFmModes(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD'], id => env.text(`fm.mode.${id}`)),
                    categories: groups.map((group, index) => ({ id: `group-${index}`, label: group })),
                    scenes: read.map(scene => ({ id: scene.id, category: `group-${groups.indexOf(scene.group)}`,
                        label: scene.name, keywords: [scene.name, scene.id] })),
                };
            }).catch(error => { if (catalogTask === task) catalogTask = null; throw error; });
            catalogTask = task;
        }
        return catalogTask;
    };
    return {
        personalFmModes: true,
        async dislikeSong(id) {
            await requestQishui('dislike_song', { id, disliked: true });
            console.info('[Qishui] Recommendation disliked');
            return {};
        },
        getPersonalFmCatalog: () => getCatalog(),
        async getPersonalFm(options) {
            const mode = options?.mode;
            const data = await requestQishui<{ items: unknown[] }>('feed', { queue: 'fm', limit: 20,
                ...(mode === 'SCENE_RCMD' ? { scene: options?.submode } : {}),
                ...(mode === 'FAMILIAR' ? { preference: 'familiar' } : mode === 'EXPLORE' ? { preference: 'fresh' } : {}) });
            return data.items.map(normalizeQishuiSong);
        },
        async getRecommendedCollections(limit): Promise<FoliumSourceCollection[]> {
            await getCatalog();
            return Promise.all(scenes.slice(0, limit).map(async scene => ({
                id: `scene-${scene.id}`, type: 'radio', name: scene.name, description: scene.group,
                coverUrl: await createQishuiSceneCover(scene.id, qishuiImage(scene.coverUrl)),
                personalFm: { mode: 'SCENE_RCMD' as const, scene: scene.id },
            })));
        },
    };
}
