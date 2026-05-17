import React from 'react';
import LegacyAlbumView from '../../AlbumView';

// App-level wrapper for the album overlay view.
const AlbumView: React.FC<React.ComponentProps<typeof LegacyAlbumView>> = (props) => {
    return <LegacyAlbumView {...props} />;
};

export default AlbumView;
