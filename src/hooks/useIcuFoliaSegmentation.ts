import { useEffect, useMemo } from 'react';
import type { VisualizerMode } from '../types';
import { setLyricsState, usePlaybackStore } from '../stores/usePlaybackStore';
import { getVisualizerRegistryEntry } from '../components/visualizer/registry';
import { applyAutoWordSegmentation, loadIcuFolia } from '../utils/lyrics/icuFolia';
import { reworkShownLyrics } from '../components/app/playback/createLyricsSetter';

// src/hooks/useIcuFoliaSegmentation.ts
// Loads icu-folia's engines when they would change something on screen, and bakes its split onto
// lyrics that reached the store before the engines were ready.
//
// The engines are ~4.4 MB of lazy chunks (~2 MB gzipped, ~30 MB resident once loaded), so they load
// only once a mode that lays text out by words is showing lyrics with Chinese or Japanese in them —
// the only text icu-folia cuts differently from plain ICU. Once loaded they stay loaded, and from then on the lyric setter bakes the split itself.
//
// The late bake mirrors useLyricWordSegmentation's: a pure transform over the lines already in the
// store, applied to the pre-transform lyrics with the extension transform re-run from there, and a
// no-op (same object back) when there is nothing to change. It is not a re-run of the lyric
// pipeline, which would re-apply the display filter and staff policy to text already filtered.

const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function useIcuFoliaSegmentation(visualizerMode: VisualizerMode) {
    const usesWords = Boolean(getVisualizerRegistryEntry(visualizerMode).usesWordSegmentation);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const hasCjText = useMemo(() => Boolean(lyrics?.lines.some(line => HAN_OR_KANA.test(line.fullText))), [lyrics]);
    const wanted = usesWords && hasCjText;

    useEffect(() => {
        if (!wanted) {
            return;
        }

        let cancelled = false;
        // loadIcuFolia starts the load once and hands every later caller the same promise, so this
        // effect re-running (StrictMode, a mode switch) does not load twice.
        void loadIcuFolia().then(ready => {
            if (cancelled || !ready) {
                return;
            }
            setLyricsState(previous => reworkShownLyrics(previous, applyAutoWordSegmentation));
        });

        return () => {
            cancelled = true;
        };
    }, [wanted]);
}
