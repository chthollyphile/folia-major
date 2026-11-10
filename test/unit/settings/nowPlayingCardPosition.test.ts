// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cardPositionBounds, clampCardPoint, normalizeNowPlayingCardPosition, relativeCardPosition, resolveCardPoint } from '../../../src/utils/nowPlayingCardPosition';
import { useStageSettingsStore } from '../../../src/stores/useStageSettingsStore';
import { compressConfig, decompressConfig } from '../../../src/utils/appearanceCodec';
import { applyImportedConfig, planConfigImport, type ConfigThemeControls } from '../../../src/components/modal/settings/pages/storage/visualConfigTransfer';
import { buildVisualSettingsConfig } from '../../../src/services/obs/visualSettingsConfig';

// Positions remain usable after window changes, and travel with the existing appearance backup.
const viewport = { width: 1200, height: 800, cardWidth: 300, cardHeight: 64 };
beforeEach(() => { localStorage.clear(); useStageSettingsStore.setState({ stageTrackPillPosition: null }); });
describe('now playing card positions', () => {
    it('applies only the selected position and leaves it untouched for old backups', () => {
        const controls: ConfigThemeControls = {
            bgMode: 'default', isCustomThemePreferred: false, songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false,
            onSaveCustomTheme: () => {}, onApplyCustomTheme: () => {}, onToggleSongThemeAutoSwitch: () => {},
            onToggleSongThemeAutoGenerate: () => {}, onChangeThemeGenerationSource: () => {},
        };
        const { config, plan } = planConfigImport('{"stpp":{"x":0.8,"y":0.2}}', controls);
        expect(plan.changes.map(change => change.key)).toEqual(['stageTrackPillPosition']);
        applyImportedConfig(config, [], controls);
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toBeNull();
        applyImportedConfig(config, ['stageTrackPillPosition'], controls);
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toEqual({ x: 0.8, y: 0.2 });
        applyImportedConfig({ stageTrackPillMode: 'always' }, ['stageTrackPillMode'], controls);
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toEqual({ x: 0.8, y: 0.2 });
    });
    it('preserves the original left margin and bottom-bar alignment by default', () => {
        expect(resolveCardPoint(null, viewport, 32)).toEqual({ x: 24, y: 704 });
        expect(resolveCardPoint(null, viewport, 120)).toEqual({ x: 24, y: 616 });
    });
    it('clamps dragged cards inside all four viewport edges', () => {
        expect(clampCardPoint({ x: -1000, y: -1000 }, viewport)).toEqual({ x: 24, y: 24 });
        expect(clampCardPoint({ x: 5000, y: 5000 }, viewport)).toEqual({ x: 876, y: 712 });
    });
    it('preserves relative placement when resized and when the card changes width', () => {
        const saved = relativeCardPosition({ x: 876, y: 712 }, viewport);
        expect(saved).toEqual({ x: 1, y: 1 });
        expect(resolveCardPoint(saved, { width: 400, height: 500, cardWidth: 350, cardHeight: 80 }, 32))
            .toEqual({ x: 26, y: 396 });
    });
    it('keeps a single valid placement when the window has no remaining drag range', () => {
        const tiny = { width: 250, height: 64, cardWidth: 240, cardHeight: 64 };
        expect(cardPositionBounds(tiny)).toEqual({ left: 5, top: 0, right: 5, bottom: 0 });
        expect(relativeCardPosition({ x: 100, y: 100 }, tiny)).toEqual({ x: 0, y: 0 });
    });
    it.each([null, undefined, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: '1', y: 0 }])('rejects corrupt stored position %j', value => {
        expect(normalizeNowPlayingCardPosition(value)).toBeNull();
    });
    it('normalizes imported values and persists reset explicitly', () => {
        useStageSettingsStore.getState().handleSetStageTrackPillPosition({ x: -1, y: 2 });
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toEqual({ x: 0, y: 1 });
        expect(JSON.parse(localStorage.getItem('stage_track_pill_position')!)).toEqual({ x: 0, y: 1 });
        useStageSettingsStore.getState().handleSetStageTrackPillPosition(null);
        expect(localStorage.getItem('stage_track_pill_position')).toBe('null');
    });
    it.each([{ x: 0.75, y: 0.25 }, null])('round-trips position %j through both full and single-field backups', position => {
        useStageSettingsStore.getState().handleSetStageTrackPillPosition(position);
        expect(decompressConfig(compressConfig(buildVisualSettingsConfig())).stageTrackPillPosition).toEqual(position);
        expect(decompressConfig(JSON.stringify({ stpp: position }))).toEqual({ stageTrackPillPosition: position });
        expect(decompressConfig(JSON.stringify({ stageTrackPillPosition: position }))).toEqual({ stageTrackPillPosition: position });
    });
});
