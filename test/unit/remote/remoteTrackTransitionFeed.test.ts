import { afterEach, describe, expect, it } from 'vitest';
import { announceTransition } from '../../../src/services/automix/transitionCue';
import { createRemoteTrackTransitionFeed } from '../../../src/components/app/playback/bridges/remoteTrackTransitionFeed';
import { buildRemoteControlSnapshotFromPlaybackSyncBridge } from '../../../src/utils/playbackSyncBridge';

// test/unit/remote/remoteTrackTransitionFeed.test.ts
// An automix blend's cue reaches the remote window's snapshot, where the remote aligns its faces,
// lyric line and layout to it - and only while the blend is on and audible.

const cue = { seconds: 18, crossover: 0.6, periodSec: 0.5 };

const snapshotWith = (trackTransition: ReturnType<ReturnType<typeof createRemoteTrackTransitionFeed>['read']>) => (
    // Only the field under test matters here; the rest of the model is not read for it.
    buildRemoteControlSnapshotFromPlaybackSyncBridge(
        { playQueue: [], currentIndex: -1 } as unknown as Parameters<typeof buildRemoteControlSnapshotFromPlaybackSyncBridge>[0],
        { playerChromeVisibilityMode: 'auto-hide', subtitleContentMode: 'both', trackTransition },
    )
);

describe('remote track transition feed', () => {
    const feeds: Array<{ dispose: () => void }> = [];
    const createFeed = (canPublish: () => boolean) => {
        const feed = createRemoteTrackTransitionFeed(canPublish, () => 50_000);
        feeds.push(feed);
        return feed;
    };

    afterEach(() => {
        announceTransition(null);
        feeds.splice(0).forEach(feed => feed.dispose());
    });

    it('puts an automix blend in the snapshot for its whole length', () => {
        const feed = createFeed(() => true);
        announceTransition(cue);

        expect(snapshotWith(feed.read()).trackTransition).toEqual({ startedAtMs: 50_000, durationSec: 18, crossover: 0.6 });

        announceTransition(null);
        expect(snapshotWith(feed.read()).trackTransition).toBeNull();
    });

    it('publishes nothing once the blend is no longer audible, or with automix off', () => {
        let audible = true;
        const feed = createFeed(() => audible);
        announceTransition(cue);
        audible = false;
        expect(feed.read()).toBeNull();

        const off = createFeed(() => false);
        announceTransition(cue);
        expect(off.read()).toBeNull();
    });

    it('does not publish a blend that was not audible when it was announced', () => {
        let audible = false;
        const feed = createFeed(() => audible);
        announceTransition(cue);
        audible = true;
        expect(feed.read()).toBeNull();
    });

    it('lets a settings preview neither start nor end the hand-off', () => {
        const feed = createFeed(() => true);
        announceTransition({ ...cue, preview: 'ring' });
        expect(feed.read()).toBeNull();

        announceTransition(cue);
        announceTransition({ ...cue, preview: 'ring' });
        expect(feed.read()?.durationSec).toBe(18);
    });
});
