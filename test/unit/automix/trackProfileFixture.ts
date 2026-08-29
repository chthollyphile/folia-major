import { TRACK_PROFILE_VERSION, type TrackProfile } from '@/services/automix/trackProfile';

// test/unit/automix/trackProfileFixture.ts
// One offline profile to override fields on, shared so that adding a field to TrackProfile does
// not mean editing the same sixteen-line literal in three test files.

export const makeProfile = (overrides: Partial<TrackProfile> = {}): TrackProfile => ({
    version: TRACK_PROFILE_VERSION,
    partial: false,
    duration: 200,
    leadIn: 0,
    vocalStart: null,
    sectionStart: null,
    sections: [],
    leadOut: 0,
    bodyOut: 0,
    startsHot: false,
    endsHot: false,
    introSlope: 0,
    outroSlope: 0,
    loudness: -14,
    headDb: -14,
    tailDb: -14,
    introTone: [1 / 3, 1 / 3, 1 / 3],
    outroTone: [1 / 3, 1 / 3, 1 / 3],
    bpm: 120,
    outroBpm: 120,
    beatOffset: 0,
    downbeatOffset: null,
    headDownbeatOffset: null,
    beatsPerBar: 4,
    key: -1,
    major: true,
    keyConfidence: 0,
    introKey: { key: -1, major: true, confidence: 0 },
    outroKey: { key: -1, major: true, confidence: 0 },
    ...overrides,
});
