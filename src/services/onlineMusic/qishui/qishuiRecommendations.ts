import type { OnlineRecommendationProvider, ProviderCollection } from '../../../types/onlineMusic';
import type { PersonalFmCatalog } from '../../../types/personalFm';
import { DEFAULT_PERSONAL_FM_CATALOG } from '../fmModes';
import { getPersonalFmRequestOptions } from '../../../stores/usePersonalFmModeStore';
import { requestQishui } from './qishuiTransport';
import { createQishuiSceneCover } from './qishuiSceneCover';
import { normalizeQishuiSong, qishuiImage } from './qishuiNormalize';

// The live car scene list supplies both radio cards and the existing FM mode picker.
type Scene = { id: string; name: string; group: string; coverUrl?: unknown };
let catalogTask: Promise<PersonalFmCatalog> | null = null;
let catalogAt = 0;
let scenes: Scene[] = [];
// Counts the clears, so that a catalogue read under the account before does not refill the list.
let generation = 0;
export function clearQishuiRecommendations() { generation++; catalogTask = null; scenes = []; catalogAt = 0; }
export async function getQishuiFmCatalog(): Promise<PersonalFmCatalog> {
    if (!catalogTask || Date.now() - catalogAt > 10 * 60_000) {
        catalogAt = Date.now();
        const mine = generation;
        const task: Promise<PersonalFmCatalog> = requestQishui<Scene[]>('feed_modes').then(rows => {
            const seen = new Set<string>();
            const read = rows.filter(row => /^\d+$/.test(row.id) && row.name && !seen.has(row.id) && Boolean(seen.add(row.id)));
            if (mine === generation) scenes = read;
            const groups = [...new Set(read.map(scene => scene.group))];
            return {
                modes: DEFAULT_PERSONAL_FM_CATALOG.modes.filter(entry => entry.id !== 'PUZZLE_MODE_RCMD'),
                categories: groups.map((group, index) => ({ id: `group-${index}`, labelKey: '', labelFallback: group })),
                scenes: read.map(scene => ({ id: scene.id, category: `group-${groups.indexOf(scene.group)}`,
                    labelKey: '', labelFallback: scene.name, keywords: [scene.name, scene.id] })),
            };
        }).catch(error => { if (catalogTask === task) catalogTask = null; throw error; });
        catalogTask = task;
    }
    return catalogTask;
}
export const qishuiRecommendations: OnlineRecommendationProvider = {
    async dislikeSong(id) {
        await requestQishui('dislike_song', { id: String(id), disliked: true });
        console.info('[Qishui] Recommendation disliked');
        return {};
    },
    getPersonalFmCatalog: getQishuiFmCatalog,
    async getPersonalFm(options) {
        const selected = options || getPersonalFmRequestOptions('qishui');
        const data = await requestQishui<{ items: unknown[] }>('feed', { queue: 'fm', limit: 20,
            ...(selected.mode === 'SCENE_RCMD' ? { scene: selected.submode } : {}),
            ...(selected.mode === 'FAMILIAR' ? { preference: 'familiar' } : selected.mode === 'EXPLORE' ? { preference: 'fresh' } : {}) });
        return data.items.map(normalizeQishuiSong);
    },
    async getRecommendedCollections(limit): Promise<ProviderCollection[]> {
        await getQishuiFmCatalog();
        return Promise.all(scenes.slice(0, limit).map(async scene => ({
            providerId: 'qishui', id: `scene-${scene.id}`, type: 'radio', name: scene.name,
            description: scene.group, coverUrl: await createQishuiSceneCover(scene.id, qishuiImage(scene.coverUrl)), personalFm: { mode: 'SCENE_RCMD', scene: scene.id },
        })));
    },
};
