// src/components/app/playback/externalPlayerWake.ts
// The setting that wakes the players Folia steers but does not own (another program's player) when
// the app starts. A player that cannot be started is not a reason to stop the launch: the listener
// still gets Folia, and the first song starts that player itself if it can.

/**
 * Runs the launch wake-up when the listener asked for it. A player that fails to start is logged
 * and dropped: the app's own start never waits on another program.
 */
export const runExternalPlayerWarmUp = async (
    askedFor: boolean,
    warmUp: () => Promise<void>,
): Promise<void> => {
    if (!askedFor) return;
    try {
        await warmUp();
    } catch (error) {
        console.warn('[ExternalPlayback] the external player could not be woken at launch', error);
    }
};
