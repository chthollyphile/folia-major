import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_FM_CATALOG, getPersonalFmSelectionLabel } from '@/services/onlineMusic/fmModes';
import { usePersonalFmModeStore, getPersonalFmSelection } from '@/stores/usePersonalFmModeStore';
import { qishuiRecommendations, clearQishuiRecommendations, getQishuiFmCatalog } from '@/services/onlineMusic/qishui/qishuiRecommendations';
import { requestQishui } from '@/services/onlineMusic/qishui/qishuiTransport';
import { buildPersonalFmMatches } from '@/components/command-palette/commands/fmModeOptions';
import { buildPersonalFmSections } from '@/components/command-palette/surfaces/fmModeSurface';
import { track } from './fixtures';

// Actual scene IDs, provider-specific persistence and the car's nested feed flags stay aligned.
vi.mock('@/services/onlineMusic/qishui/qishuiTransport', () => ({ requestQishui: vi.fn(), readQishuiSceneIcon: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') }));
const sceneRows = Array.from({ length: 45 }, (_, i) => ({ id: String(i + 1), name: i === 32 ? '驾车' : `场景 ${i + 1}`, group: '场景音乐',
    coverUrl: { urls: ['https://p3-luna.douyinpic.com/img/'], uri: `scene-${i}.png`, template_prefix: 'tplv-test' } }));
beforeEach(() => {
    clearQishuiRecommendations(); vi.mocked(requestQishui).mockReset();
    vi.mocked(requestQishui).mockImplementation(async operation => operation === 'feed_modes' ? sceneRows : { items: [track()] });
    usePersonalFmModeStore.setState({ selection: { mode: 'DEFAULT', scene: null }, providerSelections: {}, catalogs: {} });
});
afterEach(() => vi.unstubAllGlobals());
describe('Qishui radio modes', () => {
    it('lists all 45 live scenes and supplies distinct names, covers and direct playback choices', async () => {
        const catalog = await getQishuiFmCatalog();
        expect(catalog.scenes).toHaveLength(45);
        expect(catalog.modes.map(mode => mode.id)).toEqual(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD']);
        const cards = await qishuiRecommendations.getRecommendedCollections!(35);
        expect(cards).toHaveLength(35);
        expect(new Set(cards.map(card => card.name)).size).toBe(35);
        expect(cards[32]).toMatchObject({ id: 'scene-33', name: '驾车', type: 'radio', personalFm: { mode: 'SCENE_RCMD', scene: '33' } });
        expect(cards.every(card => card.coverUrl?.startsWith('data:image/svg+xml'))).toBe(true);
    });
    it('uses the same provider catalogue in the mode picker, including its own category and labels', async () => {
        const catalog = await getQishuiFmCatalog();
        const context = { shared: { t: (_key: string, fallback: string) => fallback },
            playback: { personalFmCatalog: catalog, personalFmSelection: { mode: 'DEFAULT', scene: null }, setPersonalFmSelection: vi.fn() } } as any;
        const matches = buildPersonalFmMatches(context, '');
        expect(matches).toHaveLength(49);
        expect(buildPersonalFmSections(matches, catalog).map(section => section.key)).toEqual(['mode', 'group-0']);
        const selected = buildPersonalFmMatches(context, '驾车')[0];
        selected.command.execute('', context);
        expect(context.playback.setPersonalFmSelection).toHaveBeenCalledWith({ mode: 'SCENE_RCMD', scene: '33' });
    });
    it('persists provider choices separately and uses the selected scene for implicit FM top-ups', async () => {
        const setItem = vi.fn();
        vi.stubGlobal('window', {}); vi.stubGlobal('localStorage', { setItem });
        const catalog = await getQishuiFmCatalog();
        const state = usePersonalFmModeStore.getState();
        state.setCatalog('qishui', catalog);
        state.setSelection({ mode: 'FAMILIAR', scene: null });
        state.setProviderSelection('qishui', { mode: 'SCENE_RCMD', scene: '33' });
        expect(getPersonalFmSelection()).toEqual({ mode: 'FAMILIAR', scene: null });
        expect(getPersonalFmSelection('qishui')).toEqual({ mode: 'SCENE_RCMD', scene: '33' });
        await qishuiRecommendations.getPersonalFm!();
        expect(requestQishui).toHaveBeenLastCalledWith('feed', expect.objectContaining({ scene: '33' }));
        expect(setItem).toHaveBeenCalledWith('folia.personalFm.providerSelections', expect.stringContaining('33'));
        expect(getPersonalFmSelectionLabel(getPersonalFmSelection('qishui'), (_key, fallback) => fallback || '', catalog)).toBe('Scene · 驾车');
        state.setCatalog('legacy', DEFAULT_PERSONAL_FM_CATALOG);
        expect(getPersonalFmSelection('legacy')).toEqual({ mode: 'FAMILIAR', scene: null });
    });
    it('normalizes a scene removed by the upstream catalog back to default', async () => {
        const catalog = await getQishuiFmCatalog();
        const state = usePersonalFmModeStore.getState();
        state.setCatalog('qishui', catalog);
        state.setProviderSelection('qishui', { mode: 'SCENE_RCMD', scene: '33' });
        state.setCatalog('qishui', { ...catalog, scenes: [] });
        expect(getPersonalFmSelection('qishui')).toEqual({ mode: 'DEFAULT', scene: null });
    });
});
