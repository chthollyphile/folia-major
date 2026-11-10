import i18n from '../../../../i18n/config';
import { buildStoredMonetBackgroundImage, clearMonetBackgroundImage, isSupportedMonetBackgroundFile, saveMonetBackgroundImage } from '../../../../services/monetBackgroundImage';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { useVisualizerAssetStore } from '../../../../stores/useVisualizerAssetStore';
import type { MonetBackgroundTuning } from '../../../../types';
import type { HeldTuning } from '../../tuningDefinition';

// src/components/visualizer/backgrounds/monet/imageUpload.ts
// The settings store's actions for the listener's own background picture: one is uploaded, and
// it is cleared. Clearing it while the monet background's tuning names it puts that tuning back
// on the cover; nothing is written where the tuning did not name it.

export interface MonetBackgroundImageActions {
    handleUploadMonetBackgroundImage: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearMonetBackgroundImage: () => Promise<void>;
}

export const monetBackgroundImageActions = ({ held, hold }: HeldTuning<MonetBackgroundTuning>): MonetBackgroundImageActions => ({
    handleUploadMonetBackgroundImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        if (!isSupportedMonetBackgroundFile(file)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const image = buildStoredMonetBackgroundImage(file);
        await saveMonetBackgroundImage(image);
        useVisualizerAssetStore.setState({ storedMonetBackgroundImage: image });
        setStatusMessage({ type: 'success', text: i18n.t('notifications.monetBgUpdated') });
        return { ok: true };
    },
    handleClearMonetBackgroundImage: async () => {
        await clearMonetBackgroundImage();
        const prev = held();
        if (prev.backgroundSource === 'uploaded-global') {
            hold({ ...prev, backgroundSource: 'cover-derived' });
        }
        useVisualizerAssetStore.setState({
            storedMonetBackgroundImage: null,
            monetBackgroundImage: null,
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetBgCleared') });
    },
});
