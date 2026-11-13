import type {
    DailyStyleGroup,
    OnlineRecommendationProvider,
    PersonalFmRequestOptions,
    RecommendationPreferenceItem,
    RecommendationPreferences,
} from '@/types/onlineMusic';
import type { PersonalFmCatalog, PersonalFmModeId } from '@/types/personalFm';
import type { FoliumJsonValue } from '../../contract';
import type { FoliumSourceRecommendations } from '../../sources/contract';
import { finite, list, record, text, type SourceAdapterKit } from './kit';

// src/mods/folium/registries/sourceAdapter/recommendations.ts
// recommendations@1 as the host's internal `recommendations`: what the source recommends to the account. The
// names of FM modes, scenes and preferences come as FoliumText and leave as the host's
// `{ labelKey, labelFallback }`; `personalFmModes` is the source's own word (the flags cannot tell it, matrix §3).

const FM_MODES = new Set(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD', 'PUZZLE_MODE_RCMD']);

const fmCatalogOf = (kit: SourceAdapterKit, value: unknown): PersonalFmCatalog => {
    const answer = record(value);
    const keywords = (entry: Record<string, unknown>) => list(entry.keywords).map(text).filter(Boolean);
    return {
        ...(answer?.name !== undefined ? { name: kit.labelOf(answer.name, 'fmCatalog.name') } : {}),
        modes: list(answer?.modes).flatMap((item) => {
            const mode = record(item);
            if (!mode || !FM_MODES.has(text(mode.id))) return [];
            return [{ id: mode.id as PersonalFmModeId, ...kit.labelOf(mode.label, 'fmCatalog.mode'), keywords: keywords(mode) }];
        }),
        scenes: list(answer?.scenes).flatMap((item) => {
            const scene = record(item);
            if (!scene) return [];
            return [{ id: text(scene.id), category: text(scene.category), ...kit.labelOf(scene.label, 'fmCatalog.scene'), keywords: keywords(scene) }];
        }),
        categories: list(answer?.categories).flatMap((item) => {
            const category = record(item);
            return category ? [{ id: text(category.id), ...kit.labelOf(category.label, 'fmCatalog.category') }] : [];
        }),
    };
};

const preferenceOf = (kit: SourceAdapterKit, value: unknown): RecommendationPreferenceItem | null => {
    const item = record(value);
    if (item?.kind === 'choice') {
        return {
            kind: 'choice',
            key: text(item.key),
            label: kit.labelOf(item.label, 'preference.label'),
            options: list(item.options).flatMap((entry) => {
                const option = record(entry);
                return option ? [{ value: text(option.value), label: kit.labelOf(option.label, 'preference.option') }] : [];
            }),
            value: text(item.value),
            defaultValue: text(item.defaultValue),
        };
    }
    if (item?.kind === 'ratio') {
        const min = finite(item.min);
        const max = finite(item.max);
        const defaultValue = finite(item.defaultValue);
        const current = finite(item.value);
        const snapWithin = finite(item.snapWithin);
        if (min === undefined || max === undefined || defaultValue === undefined || current === undefined) return null;
        return {
            kind: 'ratio',
            key: text(item.key),
            label: kit.labelOf(item.label, 'preference.label'),
            min,
            max,
            defaultValue,
            ...(snapWithin !== undefined ? { snapWithin } : {}),
            value: current,
        };
    }
    return null;
};

const dataOf = (value: unknown) => record(value) as Record<string, FoliumJsonValue> | null;

export const buildRecommendations = (kit: SourceAdapterKit, recommendations: FoliumSourceRecommendations): OnlineRecommendationProvider => {
    const r = recommendations;
    const getPersonalFmCatalog = r.getPersonalFmCatalog?.bind(r);
    const getDailySongs = r.getDailySongs?.bind(r);
    const getPersonalFm = r.getPersonalFm?.bind(r);
    const getRecommendedCollections = r.getRecommendedCollections?.bind(r);
    const getHistoryEntries = r.getHistoryEntries?.bind(r);
    const getHistoryDates = r.getHistoryDates?.bind(r);
    const getHistorySongs = r.getHistorySongs?.bind(r);
    const dislikeSong = r.dislikeSong?.bind(r);
    const getDailyStyleGroups = r.getDailyStyleGroups?.bind(r);
    const getDailyStyleSongs = r.getDailyStyleSongs?.bind(r);
    const setDailyStyle = r.setDailyStyle?.bind(r);
    const getRecommendationPreferences = r.getRecommendationPreferences?.bind(r);
    const saveRecommendationPreferences = r.saveRecommendationPreferences?.bind(r);
    const built: OnlineRecommendationProvider = {
        ...(getPersonalFmCatalog ? {
            getPersonalFmCatalog: async (station) => fmCatalogOf(kit, await kit.run('getPersonalFmCatalog', () => getPersonalFmCatalog(station))),
        } : {}),
        ...(getDailySongs ? { getDailySongs: async (refresh) => kit.songs(await kit.run('getDailySongs', () => getDailySongs(refresh))) } : {}),
        ...(getPersonalFm ? {
            getPersonalFm: async (options?: PersonalFmRequestOptions) => kit.songs(await kit.run('getPersonalFm', () => getPersonalFm(options ? { ...options } : undefined))),
        } : {}),
        ...(getRecommendedCollections ? {
            getRecommendedCollections: async (limit) => kit.collections(await kit.run('getRecommendedCollections', () => getRecommendedCollections(limit))),
        } : {}),
        ...(getHistoryEntries ? {
            getHistoryEntries: async () => list(await kit.run('getHistoryEntries', () => getHistoryEntries())).flatMap((value) => {
                const entry = record(value);
                if (!entry) return [];
                const data = dataOf(entry.data);
                return [{ id: text(entry.id), label: text(entry.label), ...(data ? { providerData: data } : {}) }];
            }),
        } : {}),
        ...(getHistoryDates ? { getHistoryDates: async () => list(await kit.run('getHistoryDates', () => getHistoryDates())).map(text).filter(Boolean) } : {}),
        ...(getHistorySongs ? {
            getHistorySongs: async (entry) => kit.songs(await kit.run('getHistorySongs', () => getHistorySongs(typeof entry === 'string'
                ? entry
                : { id: entry.id, label: entry.label, ...(entry.providerData ? { data: entry.providerData } : {}) }))),
        } : {}),
        ...(dislikeSong ? {
            dislikeSong: async (id) => {
                const answer = record(await kit.run('dislikeSong', () => dislikeSong(String(id))));
                const replacement = kit.song(answer?.replacement);
                return {
                    ...(replacement ? { replacement } : {}),
                    ...(answer?.limitReached === true ? { limitReached: true } : {}),
                    ...(answer?.removed === true ? { removed: true } : {}),
                };
            },
        } : {}),
        ...(getDailyStyleGroups ? {
            getDailyStyleGroups: async () => list(await kit.run('getDailyStyleGroups', () => getDailyStyleGroups())).flatMap((value): DailyStyleGroup[] => {
                const group = record(value);
                if (!group) return [];
                return [{
                    id: text(group.id),
                    name: text(group.name),
                    tags: list(group.tags).flatMap((item) => {
                        const tag = record(item);
                        return tag ? [{ id: text(tag.id), name: text(tag.name) }] : [];
                    }),
                }];
            }),
        } : {}),
        ...(getDailyStyleSongs ? {
            getDailyStyleSongs: async () => {
                const answer = record(await kit.run('getDailyStyleSongs', () => getDailyStyleSongs()));
                const selection = record(answer?.selection);
                return {
                    songs: kit.songs(answer?.songs),
                    selection: selection ? { groupId: text(selection.groupId), tagIds: list(selection.tagIds).map(text) } : null,
                };
            },
        } : {}),
        ...(setDailyStyle ? {
            setDailyStyle: async (selection) => {
                await kit.run('setDailyStyle', () => setDailyStyle({ groupId: selection.groupId, tagIds: [...selection.tagIds] }));
            },
        } : {}),
        ...(getRecommendationPreferences ? {
            getRecommendationPreferences: async (): Promise<RecommendationPreferences> => {
                const answer = record(await kit.run('getRecommendationPreferences', () => getRecommendationPreferences()));
                return {
                    items: list(answer?.items).map((item) => preferenceOf(kit, item)).filter((item): item is RecommendationPreferenceItem => item !== null),
                    ...(answer?.note !== undefined ? { note: kit.labelOf(answer.note, 'preferences.note') } : {}),
                };
            },
        } : {}),
        ...(saveRecommendationPreferences ? {
            saveRecommendationPreferences: async (changes) => ({
                confirmed: record(await kit.run('saveRecommendationPreferences', () => saveRecommendationPreferences({ ...changes })))?.confirmed === true,
            }),
        } : {}),
    };
    Object.defineProperty(built, 'preferenceEntries', { enumerable: true, get: () => r.preferenceEntries });
    return built;
};
