import { useEffect, useRef } from 'react';
import type { ObservedMedia } from '../../services/mediaShim';

// Distinguish intentional timeline changes from routine late position samples without React state updates.
export function useRemoteSeekRevision(media: ObservedMedia | null) {
    const revision = useRef(0);
    useEffect(() => {
        if (!media) return;
        const advance = () => { revision.current++; };
        advance();
        const events = ['seeking', 'seeked', 'loadedmetadata'];
        for (const event of events) media.addEventListener(event, advance);
        return () => {
            for (const event of events) media.removeEventListener(event, advance);
        };
    }, [media]);
    return revision;
}
