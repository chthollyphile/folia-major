import React from 'react';
import LegacyHome from '../Home';
import Grid3D from '../Grid3D';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import GridViewOverlayHost from './home/GridViewOverlayHost';
import type { HomeViewModel } from './home/buildHomeModel';

// App-level entry for the home surface backed by a view model.
type AppHomeProps = {
    model: HomeViewModel;
    isHomeFullyHidden?: boolean;
};

const Home: React.FC<AppHomeProps> = ({ model, isHomeFullyHidden }) => {
    const homeLayoutStyle = useSettingsUiStore(state => state.homeLayoutStyle);

    if (isHomeFullyHidden) {
        return null;
    }

    if (homeLayoutStyle === 'grid') {
        return (
            <GridViewOverlayHost legacyProps={model.legacyProps}>
                {(openGridView) => (
                    <Grid3D
                        {...model.legacyProps}
                        onOpenGridView={openGridView}
                    />
                )}
            </GridViewOverlayHost>
        );
    }
    return <LegacyHome {...model.legacyProps} />;
};

export default Home;
