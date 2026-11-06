import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';
import { RENDERER_PACK as EXAMPLE_PACK } from '../../../stylePacks/code/example';
import { parseStylePack } from '../../../stylePacks/validate';
import type { AnyStylePack as StylePack } from '../../../stylePacks/code/contract';

// The selected bundle travels with visualizerTunings through backups, previews and OBS.
export interface StylePackTuning { pack: StylePack }
declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'stylePackTuning', 'handleSetStylePackTuning', 'handleResetStylePackTuning', StylePackTuning> {}
}
const read = (value: unknown): StylePackTuning => {
    try { return { pack: parseStylePack(JSON.stringify((value as StylePackTuning)?.pack)) }; }
    catch { return { pack: EXAMPLE_PACK }; }
};
export default defineVisualizerTuning<StylePackTuning>({
    mode: 'stylePack', defaults: { pack: EXAMPLE_PACK }, settingsKey: 'stylePackTuning',
    settingsSetterKey: 'handleSetStylePackTuning', settingsResetterKey: 'handleResetStylePackTuning',
    storage: { key: 'folia_style_pack_tuning_v1', read, merge: (held, patch) => read({ ...held, ...patch }) },
});
