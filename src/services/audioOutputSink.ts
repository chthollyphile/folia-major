// src/services/audioOutputSink.ts
// Puts a freshly created AudioContext on the saved output device.
//
// The context is only built on the first play, after useAudioOutputDevice has already applied the
// saved device - to the <audio> element, since there was no graph yet. Once the element feeds the
// graph its sinkId no longer decides anything, and a new context starts on the system default, so
// the saved device has to be set on the context when it is created.

type SinkableAudioContext = AudioContext & {
    sinkId?: unknown;
    setSinkId?: (sinkId: string) => Promise<void>;
};

/** Resolves true when the context ends up on the device; never throws. */
export const applySavedAudioOutputToContext = async (
    audioContext: AudioContext,
    deviceId: string,
): Promise<boolean> => {
    // '' and 'default' are both the system default, which is where a new context already is.
    if (!deviceId || deviceId === 'default') return true;
    const context = audioContext as SinkableAudioContext;
    if (typeof context.setSinkId !== 'function') return false;
    if (context.sinkId === deviceId) return true;
    try {
        await context.setSinkId(deviceId);
        return true;
    } catch (error) {
        console.warn('[AudioContext] Failed to apply saved audio output device', { error, deviceId });
        return false;
    }
};
