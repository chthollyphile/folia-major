import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import StudioWindow from '../../components/shared/StudioWindow';
import { MOD_KIT_CLASSES } from '../manager/modManagerClasses';
import { ModsWorkbench } from './ModsWorkbench';

// src/mods/market/ModsWindow.tsx
// The mods window: Settings → Mods → Open, and the palette's "Open the mod market". The settings window's
// work-window frame (StudioWindow, 1240 by 780 at most) without a stage, the whole body given to the mods
// view, so the list and the detail beside it have the room the settings page could not give them.
// The settings window opens and closes it, and closes it on Escape like its other work windows.

type ModsWindowProps = {
    isDaylight: boolean;
    theme: Theme | null;
    onClose: () => void;
};

const ModsWindow: React.FC<ModsWindowProps> = ({ isDaylight, theme, onClose }) => {
    const { t } = useTranslation();
    return (
        <StudioWindow
            title={t('mods.windowTitle')}
            onBack={onClose}
            backLabel={t('ui.back')}
            isDaylight={isDaylight}
            theme={theme ?? undefined}
        >
            <ModsWorkbench classes={MOD_KIT_CLASSES} isDaylight={isDaylight} theme={theme} fill />
        </StudioWindow>
    );
};

export default ModsWindow;
