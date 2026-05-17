import React from 'react';
import LegacyArtistView from '../../ArtistView';

// App-level wrapper for the artist overlay view.
const ArtistView: React.FC<React.ComponentProps<typeof LegacyArtistView>> = (props) => {
    return <LegacyArtistView {...props} />;
};

export default ArtistView;
