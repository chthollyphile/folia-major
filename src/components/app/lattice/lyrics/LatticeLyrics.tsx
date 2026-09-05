import { useMemo, useRef } from 'react';
import { useFontsEpoch } from '../../../../hooks/useFontsEpoch';
import { useLatticeLyrics } from './LatticeLyricsProvider';
import { useLatticeLyricCanvas } from './useLatticeLyricCanvas';
import type { LatticeTile } from '../latticeModel';
import './LatticeLyrics.css';

// src/components/app/lattice/lyrics/LatticeLyrics.tsx
export default function LatticeLyrics({ tile, reducedMotion }: { tile: LatticeTile; reducedMotion: boolean }) {
    const source = useLatticeLyrics();
    const fontsEpoch = useFontsEpoch();
    const host = useRef<HTMLDivElement>(null);
    const input = useMemo(() => source && source.songKey === tile.id
        ? { ...source, fontsEpoch, reducedMotion } : null, [source, tile.id, fontsEpoch, reducedMotion]);
    const ready = useLatticeLyricCanvas(host, input);
    const line = input?.lines[input.currentLineIndex];
    return <>
        <span className={`lattice-poster-copy ${ready ? 'lattice-lyric-metadata' : ''}`}>
            <strong>{tile.title}</strong><small>{tile.artist}</small>
        </span>
        <div className={`lattice-lyrics ${ready ? 'is-ready' : ''}`}>
            <div ref={host} className="lattice-lyrics-canvas" aria-hidden="true" />
            {ready && <span className="sr-only">{line?.fullText}</span>}
        </div>
    </>;
}
