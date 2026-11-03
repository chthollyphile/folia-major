import i18n from '../../../i18n/config';
import { buildStoredMonetPortraitImage, clearMonetPortraitImage, isSupportedMonetPortraitFile, saveMonetPortraitImage } from '../../../services/monetPortraitImage';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useVisualizerAssetStore } from '../../../stores/useVisualizerAssetStore';
import type { MonetTuning } from '../../../types';
import type { HeldTuning } from '../tuningDefinition';

// src/components/visualizer/monet/portraitUpload.ts
// The settings store's actions for Monet's own portrait picture: one is uploaded, and it is
// cleared. Clearing it while the tuning names it puts the tuning back on the cover; nothing is
// written where the tuning did not name it.

export interface MonetPortraitActions {
    handleUploadMonetPortraitImage: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearMonetPortraitImage: () => Promise<void>;
}

export const monetPortraitActions = ({ held, hold }: HeldTuning<MonetTuning>): MonetPortraitActions => ({
    handleUploadMonetPortraitImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        if (!isSupportedMonetPortraitFile(file)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const image = buildStoredMonetPortraitImage(file);
        await saveMonetPortraitImage(image);
        useVisualizerAssetStore.setState({ storedMonetPortraitImage: image });
        setStatusMessage({ type: 'success', text: i18n.t('notifications.monetPortraitUpdated') });
        return { ok: true };
    },
    handleClearMonetPortraitImage: async () => {
        await clearMonetPortraitImage();
        const prev = held();
        if (prev.portraitSource === 'custom') {
            hold({ ...prev, portraitSource: 'cover' });
        }
        useVisualizerAssetStore.setState({
            storedMonetPortraitImage: null,
            monetPortraitImage: null,
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetPortraitCleared') });
    },
});
