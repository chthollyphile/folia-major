import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { MutableRefObject, RefObject } from 'react';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';

// src/hooks/useAudioOutputDevice.ts
//
// Routes playback to the chosen output device and keeps it there.
//
// Two sinks, not one: when the Web Audio graph is in use the AudioContext owns the output, and the
// <audio> element's own sinkId no longer decides anything - so the device has to be set on whichever
// of the two is actually terminating the chain. Re-applied on `loadedmetadata` and `canplay`
// because a fresh element starts on the default device regardless of what was chosen before.

type AudioOutputDeviceParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    gainNodeRef: MutableRefObject<GainNode | null>;
};

export const useAudioOutputDevice = ({
    audioRef,
    audioContextRef,
    gainNodeRef,
}: AudioOutputDeviceParams) => {
    const { t } = useTranslation();
    const audioOutputDeviceId = useAudioSettingsStore(state => state.audioOutputDeviceId);
    const persistAudioOutputDeviceId = useAudioSettingsStore(state => state.handleSetAudioOutputDeviceId);
    const audioSrc = usePlaybackStore(state => state.audioSrc);

    const applyAudioOutputDevice = useCallback(async (
        targetDeviceId: string,
        reportError = true,
    ) => {
        const audioElement = audioRef.current as (HTMLAudioElement & {
            setSinkId?: (sinkId: string) => Promise<void>;
            sinkId?: string;
        }) | null;
        const audioContext = audioContextRef.current as (AudioContext & {
            setSinkId?: (sinkId: string) => Promise<void>;
            sinkId?: string;
        }) | null;
        const audioSinkTarget = gainNodeRef.current && audioContext?.setSinkId
            ? audioContext
            : audioElement;

        if (!audioSinkTarget?.setSinkId) {
            persistAudioOutputDeviceId(targetDeviceId);
            return true;
        }

        const normalizedTargetDeviceId = targetDeviceId || '';
        if (audioSinkTarget.sinkId === normalizedTargetDeviceId) {
            persistAudioOutputDeviceId(targetDeviceId);
            return true;
        }

        let attempt = 0;
        const maxRetryCount = 4;
        let shouldPauseBeforeSwitch = normalizedTargetDeviceId === 'default' || normalizedTargetDeviceId === 'communications';

        while (attempt <= maxRetryCount) {
            const wasPlaying = Boolean(audioElement && !audioElement.paused && !audioElement.ended);
            try {
                if (audioElement && shouldPauseBeforeSwitch && wasPlaying) {
                    audioElement.pause();
                }

                await audioSinkTarget.setSinkId(normalizedTargetDeviceId);
                persistAudioOutputDeviceId(targetDeviceId);

                if (audioElement && shouldPauseBeforeSwitch && wasPlaying) {
                    try {
                        await audioElement.play();
                    } catch (resumeError) {
                        console.warn('[App] Audio output switched but playback did not resume automatically', {
                            resumeError,
                            targetDeviceId: normalizedTargetDeviceId,
                            audioSrc,
                        });
                    }
                }

                return true;
            } catch (error) {
                const isAbortError = error instanceof DOMException && error.name === 'AbortError';
                if (isAbortError && attempt < maxRetryCount) {
                    if (audioElement && wasPlaying && audioElement.paused) {
                        try {
                            await audioElement.play();
                        } catch {
                            // Ignore resume failures during retry path; a later successful switch will attempt again.
                        }
                    }
                    attempt += 1;
                    shouldPauseBeforeSwitch = true;
                    await new Promise(resolve => window.setTimeout(resolve, 180));
                    continue;
                }

                console.warn('[App] Failed to apply audio output device', {
                    error,
                    targetDeviceId: normalizedTargetDeviceId,
                    sinkTarget: audioSinkTarget === audioContext ? 'audio-context' : 'audio-element',
                });

                if (audioElement && wasPlaying && audioElement.paused) {
                    try {
                        await audioElement.play();
                    } catch {
                        // Ignore resume failures on final error; user will see the status message.
                    }
                }

                if (reportError) {
                    setStatusMsg({
                        type: 'error',
                        text: t('options.audioOutputSelectFailed'),
                    });
                }
                return false;
            }
        }

        return false;
    }, [persistAudioOutputDeviceId]);

    useEffect(() => {
        const audioElement = audioRef.current as HTMLAudioElement | null;

        if (!audioElement) {
            return;
        }

        let isDisposed = false;
        const handleAudioDeviceRetry = () => {
            if (isDisposed) {
                return;
            }
            void applyAudioOutputDevice(audioOutputDeviceId, false);
        };

        // 蓝牙断连自动回退：设备变化时检查当前选中设备是否还在，不在则回退默认
        const handleDeviceChange = async () => {
            if (isDisposed) return;
            if (!audioOutputDeviceId || audioOutputDeviceId === 'default') return;
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const stillExists = devices.some(d => d.deviceId === audioOutputDeviceId);
                if (!stillExists) {
                    persistAudioOutputDeviceId('default');
                    void applyAudioOutputDevice('default', false);
                }
            } catch {
                // enumerateDevices 可能失败，忽略
            }
        };

        audioElement.addEventListener('loadedmetadata', handleAudioDeviceRetry);
        audioElement.addEventListener('canplay', handleAudioDeviceRetry);
        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
        void applyAudioOutputDevice(audioOutputDeviceId, false);
        return () => {
            isDisposed = true;
            audioElement.removeEventListener('loadedmetadata', handleAudioDeviceRetry);
            audioElement.removeEventListener('canplay', handleAudioDeviceRetry);
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
    }, [applyAudioOutputDevice, audioOutputDeviceId, audioSrc, persistAudioOutputDeviceId]);

    const handleAudioOutputDeviceChange = useCallback(async (deviceId: string) => (
        await applyAudioOutputDevice(deviceId, true)
    ), [applyAudioOutputDevice]);

    return { handleAudioOutputDeviceChange };
};
