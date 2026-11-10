import { describe, expect, it } from 'vitest';
import type { PlaybackRepresentation } from '../../../src/types/playbackRecovery';
import type { HifiSignalPath, HifiSignalVerdict } from '../../../src/types/hifi';
import { playbackRouteSummary } from '../../../src/components/hifi/playbackRouteSummary';
import { webAudioSignal } from '../../../src/components/hifi/webAudioSignal';

// 转码判断必须绑定正在使用的源，预热记录和旧源不能使普通播放被误报为转码。

const representation: PlaybackRepresentation = {
    songKey: 'local:one', sourceRevision: 'revision', representationId: 'copy',
    kind: 'transcoded', url: 'blob:converted', mimeType: 'audio/wav', timelineOffsetSec: 0,
};

describe('Web Audio signal', () => {
    it('reports no loaded audio even if a transcoded copy is cached', () => {
        expect(webAudioSignal(null, representation)).toMatchObject({ active: false, transcode: 'noSource', mimeType: null });
    });

    it('ignores a representation that is not the active source', () => {
        expect(webAudioSignal('blob:original', representation)).toMatchObject({ transcode: 'notTranscoded', mimeType: null });
    });

    it('reports the format only for the matching active representation', () => {
        expect(webAudioSignal('blob:converted', representation)).toMatchObject({ transcode: 'transcoded', mimeType: 'audio/wav' });
    });

    it('recognizes the desktop transcode protocol without a registry entry', () => {
        expect(webAudioSignal('folia-transcode://cache/copy', null).transcode).toBe('transcoded');
    });

    it('does not infer remote transcoding from a filename or query string', () => {
        expect(webAudioSignal('https://server/stream?format=mp3', null).transcode).toBe('notTranscoded');
    });
});

describe('playback route summary', () => {
    const path = (verdict: HifiSignalVerdict) => ({ verdict }) as HifiSignalPath;
    const web = webAudioSignal('blob:original', null);

    it('splits the native route into passthrough, processed and unconfirmed', () => {
        expect(playbackRouteSummary(path('bit-perfect'), web)).toBe('nativePassthrough');
        expect(playbackRouteSummary(path('dop'), web)).toBe('nativePassthrough');
        expect(playbackRouteSummary(path('rate-passthrough'), web)).toBe('nativeProcessed');
        expect(playbackRouteSummary(path('converted'), web)).toBe('nativeProcessed');
        expect(playbackRouteSummary(path('shared-mixer'), web)).toBe('nativeProcessed');
        expect(playbackRouteSummary(path('unknown'), web)).toBe('nativeUnconfirmed');
    });

    it('tells transcoded playback from the plain web engine, and says nothing without audio', () => {
        expect(playbackRouteSummary(null, webAudioSignal('folia-transcode://cache/copy', null))).toBe('transcoded');
        expect(playbackRouteSummary(null, web)).toBe('webEngine');
        expect(playbackRouteSummary(null, webAudioSignal(null, null))).toBeNull();
    });
});
