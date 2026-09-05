import { useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
        <AnimatePresence initial={false}>
            <motion.span
                key={ready ? 'lyrics-ready' : 'lyrics-loading'}
                className={`lattice-poster-copy ${ready ? 'lattice-lyric-metadata' : ''}`}
                initial={{ opacity: reducedMotion ? 1 : 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: reducedMotion ? 1 : 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.24, ease: 'easeInOut' }}
            >
                <strong>{tile.title}</strong><small>{tile.artist}</small>
            </motion.span>
        </AnimatePresence>
        <div className={`lattice-lyrics ${ready ? 'is-ready' : ''}`}>
            <div ref={host} className="lattice-lyrics-canvas" aria-hidden="true" />
            {ready && <span className="sr-only">{line?.fullText}</span>}
        </div>
    </>;
}
