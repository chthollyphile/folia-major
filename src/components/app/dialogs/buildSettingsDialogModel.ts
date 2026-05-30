import type React from 'react';
import type SettingsModal from '../../modal/SettingsModal';

// src/components/app/dialogs/buildSettingsDialogModel.ts

type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;

export type SettingsModalState = {
    isOpen: boolean;
    initialTab: NonNullable<SettingsDialogProps['initialTab']>;
};

type BuildSettingsDialogModelParams = Omit<SettingsDialogProps, 'onClose' | 'initialTab'> & {
    state: SettingsModalState;
    onClose: () => void;
};

// Builds the global settings dialog props without tying the modal to Home.
export const buildSettingsDialogModel = ({
    state,
    onClose,
    ...settingsProps
}: BuildSettingsDialogModelParams): SettingsDialogProps | null => {
    if (!state.isOpen) {
        return null;
    }

    return {
        ...settingsProps,
        initialTab: state.initialTab,
        onClose,
    };
};
