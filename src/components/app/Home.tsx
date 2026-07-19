import React from 'react';
import Grid3D from '../Grid3D';
import GridViewOverlayHost from './home/GridViewOverlayHost';
import type { HomeViewModel } from './home/buildHomeModel';

// App-level entry for the home surface backed by a view model.
type AppHomeProps = {
    model: HomeViewModel;
    isHomeFullyHidden?: boolean;
};

const Home: React.FC<AppHomeProps> = ({ model, isHomeFullyHidden }) => {
    if (isHomeFullyHidden) {
        return null;
    }

    return (
        <GridViewOverlayHost
            surfaceProps={model.surfaceProps}
            onOpenCollection={model.onOpenCollection}
            onPushCollection={model.onPushCollection}
            onBackCollection={model.onBackCollection}
        >
            {(openGridView) => (
                <Grid3D
                    {...model.surfaceProps}
                    onlineProviderPlatform={model.onlineProviderPlatform}
                    onOpenGridView={openGridView}
                />
            )}
        </GridViewOverlayHost>
    );
};

export default Home;
