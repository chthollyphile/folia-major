import React from 'react';
import LegacyPlaylistView from '../../PlaylistView';

// App-level wrapper for the playlist overlay view.
const PlaylistView: React.FC<React.ComponentProps<typeof LegacyPlaylistView>> = (props) => {
    return <LegacyPlaylistView {...props} />;
};

export default PlaylistView;
