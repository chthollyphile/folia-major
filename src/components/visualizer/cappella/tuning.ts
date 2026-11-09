import i18n from '../../../i18n/config';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useVisualizerAssetStore } from '../../../stores/useVisualizerAssetStore';
import { DEFAULT_CAPPELLA_TUNING, type CappellaAvatarSource, type CappellaTuning } from '../../../types';
import { defineVisualizerTuning, MOD_SWITCH, modChoice, type StoredTuningFields } from '../tuningDefinition';
import { cappellaPackActions, type CappellaPackActions } from './customPacks';

// src/components/visualizer/cappella/tuning.ts
// Cappella's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, its actions for the listener's own pictures, and the
// renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends
        StoredTuningFields<'cappellaTuning', 'handleSetCappellaTuning', 'handleResetCappellaTuning', CappellaTuning>,
        CappellaPackActions {}
}

const avatarSource = (source: CappellaAvatarSource | undefined): CappellaAvatarSource => (
    source === 'builtin' || source === 'color' || source === 'cover' || source === 'custom'
        ? source
        : DEFAULT_CAPPELLA_TUNING.avatarSource
);

/** A stored tuning, or a part of one, as a whole valid tuning. */
export const resolveStoredCappellaTuning = (parsed: Partial<CappellaTuning>): CappellaTuning => ({
    showEmoMessages: parsed.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: parsed.emojiPackSource === 'custom' ? 'custom' : 'builtin',
    avatarSource: avatarSource(parsed.avatarSource),
});

/** The listener's own emoji pack can be chosen only while one is there. */
const asksForMissingEmojiPack = (patch: Partial<CappellaTuning>) => (
    patch.emojiPackSource === 'custom' && useVisualizerAssetStore.getState().storedCappellaEmojiPack.length === 0
);

export default defineVisualizerTuning<CappellaTuning>({
    mode: 'cappella',
    defaults: DEFAULT_CAPPELLA_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        showEmoMessages: MOD_SWITCH,
        // 'custom' needs a picture the listener uploaded: left to the listener.
        avatarSource: modChoice(['cover', 'builtin', 'color']),
    },
    settingsKey: 'cappellaTuning',
    settingsSetterKey: 'handleSetCappellaTuning',
    settingsResetterKey: 'handleResetCappellaTuning',
    storage: {
        key: 'cappella_tuning',
        read: resolveStoredCappellaTuning,
        merge: (held, patch) => ({
            showEmoMessages: patch.showEmoMessages ?? held.showEmoMessages,
            emojiPackSource: asksForMissingEmojiPack(patch)
                ? 'builtin' as const
                : (patch.emojiPackSource ?? held.emojiPackSource),
            avatarSource: avatarSource(patch.avatarSource ?? held.avatarSource),
        }),
        onChange: (patch) => {
            if (asksForMissingEmojiPack(patch)) {
                setStatusMessage({ type: 'info', text: i18n.t('notifications.uploadEmojiFirst') });
            }
        },
        resetNotice: 'notifications.cappellaReset',
        actions: cappellaPackActions,
    },
    apply: (props, tuning) => ({ ...props, cappellaTuning: tuning }),
});
