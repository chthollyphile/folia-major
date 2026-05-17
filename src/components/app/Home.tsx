import React from 'react';
import LegacyHome from '../Home';
import type { HomeViewModel } from './view-models/useHomeViewModel';

// App-level entry for the home surface backed by a view model.
type AppHomeProps = {
    model: HomeViewModel;
};

const Home: React.FC<AppHomeProps> = ({ model }) => {
    return <LegacyHome {...model.legacyProps} />;
};

export default Home;
