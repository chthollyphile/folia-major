import React from 'react';
import LocalSongLyricMatch from './LocalSongLyricMatch';
import NavidromeSongLyricMatch from './NavidromeSongLyricMatch';
import OnlineSongLyricMatch from './OnlineSongLyricMatch';

// src/components/modal/lyric-match/LyricMatchDialog.tsx
// Matching lyrics to a song by hand. The window is one (LyricMatchWindow); each kind of song has
// a file of its own here that fills it. A new kind of song: one such file, and its line below.

const KINDS = {
    local: LocalSongLyricMatch,
    navidrome: NavidromeSongLyricMatch,
    online: OnlineSongLyricMatch,
};

export type LyricMatchDialogProps = {
    [Kind in keyof typeof KINDS]: { kind: Kind } & React.ComponentProps<(typeof KINDS)[Kind]>
}[keyof typeof KINDS];

const LyricMatchDialog: React.FC<LyricMatchDialogProps> = ({ kind, ...props }) => {
    // The props are those of `kind`'s own component: LyricMatchDialogProps pairs them.
    const Kind = KINDS[kind] as React.ComponentType<typeof props>;
    return <Kind {...props} />;
};

export default LyricMatchDialog;
