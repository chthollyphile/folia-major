import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopSettingsStore } from '../../../../../stores/useDesktopSettingsStore';
import { Row, type SettingsOptionDef } from '../../kit';
import { DisplayMap } from './DisplayMap';
import { chooseWallpaperDisplay, refreshWallpaperDisplays, useWallpaperDisplays } from './wallpaperDisplays';

// src/components/modal/settings/pages/desktop/WallpaperDisplayRow.tsx
// The row under the wallpaper switch that chooses the display wallpaper mode uses. It is drawn
// only where there is something to choose: more than one display connected, on a system whose
// wallpaper mode can use any of them. The choice holds while wallpaper mode is off and is used
// the next time it is entered.

export const WallpaperDisplayRow: React.FC<{ option: SettingsOptionDef }> = ({ option }) => {
    const { t } = useTranslation();
    const state = useWallpaperDisplays();
    const wallpaperMode = useDesktopSettingsStore(store => store.wallpaperMode);

    // Entering or leaving wallpaper mode changes which display is in use.
    useEffect(() => {
        refreshWallpaperDisplays();
    }, [wallpaperMode]);

    if (!state) {
        return null;
    }
    return (
        <Row sub option={option} hint={t('options.wallpaperDisplayDesc')}>
            <DisplayMap
                displays={state.displays}
                value={state.choice === null ? null : state.chosenId ?? undefined}
                activeId={state.activeId}
                onChange={chooseWallpaperDisplay}
                label={t(option.labelKey)}
                autoLabel={t('options.wallpaperDisplayAuto')}
                primaryLabel={t('options.wallpaperDisplayPrimary')}
            />
        </Row>
    );
};

export default WallpaperDisplayRow;
