import i18n from '../../../i18n/config';
import { buildStoredCappellaAvatar, clearCustomCappellaAvatar, isSupportedCappellaAvatarFile, saveCustomCappellaAvatar } from '../../../services/cappellaAvatarPack';
import { buildStoredCappellaEmojiPack, clearCustomCappellaEmojiPack, isSupportedCappellaEmojiFile, saveCustomCappellaEmojiPack } from '../../../services/cappellaEmojiPack';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useVisualizerAssetStore } from '../../../stores/useVisualizerAssetStore';
import type { CappellaTuning } from '../../../types';
import type { HeldTuning } from '../tuningDefinition';

// src/components/visualizer/cappella/customPacks.ts
// The settings store's actions for Cappella's own pictures: a listener's emoji pack and avatars
// are added to and cleared. Clearing the pack the tuning names puts the tuning back on the
// built-in one; nothing is written where the tuning did not name it.

type UploadResult = Promise<{ ok: boolean; error?: string; }>;

export interface CappellaPackActions {
    handleImportCustomCappellaEmojiPack: (files: File[]) => UploadResult;
    handleClearCustomCappellaEmojiPack: () => Promise<void>;
    handleImportCustomCappellaAvatar: (files: File[]) => UploadResult;
    handleClearCustomCappellaAvatar: () => Promise<void>;
}

export const cappellaPackActions = ({ held, hold }: HeldTuning<CappellaTuning>): CappellaPackActions => ({
    handleImportCustomCappellaEmojiPack: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaEmojiPack = useVisualizerAssetStore.getState().storedCappellaEmojiPack;

        if (!files.every(isSupportedCappellaEmojiFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const appendedPack = buildStoredCappellaEmojiPack(files);
        const storedPack = [...storedCappellaEmojiPack, ...appendedPack];
        await saveCustomCappellaEmojiPack(storedPack);
        useVisualizerAssetStore.setState({ storedCappellaEmojiPack: storedPack });
        setStatusMessage({
            type: 'success',
            text: i18n.t('notifications.emojiPackAdded', { added: appendedPack.length, total: storedPack.length }),
        });

        return { ok: true };
    },
    handleClearCustomCappellaEmojiPack: async () => {
        await clearCustomCappellaEmojiPack();
        const prev = held();
        if (prev.emojiPackSource === 'custom') {
            hold({ ...prev, emojiPackSource: 'builtin' });
        }
        useVisualizerAssetStore.setState({
            storedCappellaEmojiPack: [],
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.emojiPackCleared') });
    },
    handleImportCustomCappellaAvatar: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaAvatarPack = useVisualizerAssetStore.getState().storedCappellaAvatarPack;

        if (!files.every(isSupportedCappellaAvatarFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const builtPack = buildStoredCappellaAvatar(files);
        const storedPack = [...storedCappellaAvatarPack, ...builtPack];
        await saveCustomCappellaAvatar(storedPack);
        useVisualizerAssetStore.setState({ storedCappellaAvatarPack: storedPack });
        setStatusMessage({
            type: 'success',
            text: i18n.t('notifications.avatarAdded', { added: builtPack.length, total: storedPack.length }),
        });

        return { ok: true };
    },
    handleClearCustomCappellaAvatar: async () => {
        await clearCustomCappellaAvatar();
        const prev = held();
        if (prev.avatarSource === 'custom') {
            hold({ ...prev, avatarSource: 'builtin' });
        }
        useVisualizerAssetStore.setState({
            storedCappellaAvatarPack: [],
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.avatarCleared') });
    },
});
