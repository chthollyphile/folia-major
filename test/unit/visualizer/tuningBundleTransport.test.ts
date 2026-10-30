import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { applyVisualizerTuningsToSettings, collectVisualizerTunings } from '@/components/visualizer/tuningRegistry';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { applySyncedVisualSettings, buildSyncedSettingsRecord, readSyncableSettingsState } from '@/services/sync/settingsSnapshot';
import { parseSyncedSettingsRecord } from '@/services/sync/syncSchema';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { buildImportPlan } from '@/utils/appearanceImportPlan';
import { buildObsAppearanceFromShortcode } from '@/utils/obsWebAppearance';

// test/unit/visualizer/tuningBundleTransport.test.ts
// Pins the rule that a lyric style's settings leave this machine in the visualizerTunings bundle
// and need no field of their own.
//
// Export, sync and the OBS link each still write one field per style for the 13 styles that existed
// before the bundle (classicTuning ... lumiereTuning). Those fields are frozen. Each test here
// removes them from the outgoing document and expects every style to arrive anyway, so a style that
// only has a tuning.ts travels without a line in the sync, config, codec or import files.
//
// The styles come from the folders, not from a list: a new tuning.ts is covered without an edit.

interface TuningFile {
    mode: string;
    settingsKey: string;
    settingsSetterKey: string;
}

// Loaded in beforeAll rather than with the imports above, so this file decides nothing about the
// order in which the visualizer modules start.
const tuningFileLoaders = import.meta.glob<{ default: TuningFile; }>('../../../src/components/visualizer/*/tuning.ts');
let tuningFiles: TuningFile[] = [];

const readStore = () => useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>;
const readTunings = () => structuredClone(collectVisualizerTunings(readStore())) as Record<string, unknown>;

const createLocalStorageMock = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length() {
            return values.size;
        },
        getItem: (key) => values.get(key) ?? null,
        key: (index) => Array.from(values.keys())[index] ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
};

describe('lyric style tunings travel in the bundle alone', () => {
    let defaults: Record<string, unknown>;

    const restoreDefaults = () => {
        useVisualizerSettingsStore.setState(structuredClone(defaults));
    };

    // A style whose fields are all named choices (no switch or number to nudge) gets a hand-picked change.
    const CHOICE_PATCHES: Record<string, Record<string, unknown>> = {
        machi: { weather: 'snow' },
    };

    // Moves every style off its defaults through the store's own setter, so what is exported is a
    // value the store accepts. Returns the tunings the store then holds.
    const customiseEveryStyle = () => {
        for (const { mode, settingsKey, settingsSetterKey } of tuningFiles) {
            const current = readStore()[settingsKey] as Record<string, unknown>;
            const patch: Record<string, unknown> = { ...CHOICE_PATCHES[mode] };
            for (const [field, value] of Object.entries(current)) {
                if (typeof value === 'boolean') patch[field] = !value;
                if (typeof value === 'number') patch[field] = value * 0.9;
            }
            (readStore()[settingsSetterKey] as (value: unknown) => void)(patch);
        }
        const customised = readTunings();
        for (const { mode, settingsKey } of tuningFiles) {
            expect(customised[mode], `${mode} left its defaults`).not.toEqual(defaults[settingsKey]);
        }
        return customised;
    };

    const withoutSingleFields = <T extends object>(document: T): T => {
        const copy = { ...document } as Record<string, unknown>;
        for (const { settingsKey } of tuningFiles) delete copy[settingsKey];
        return copy as T;
    };

    beforeAll(async () => {
        const modules = await Promise.all(Object.values(tuningFileLoaders).map(load => load()));
        tuningFiles = modules.map(module => module.default);
    });

    beforeEach(() => {
        const storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        defaults ??= structuredClone(Object.fromEntries(
            tuningFiles.map(({ settingsKey }) => [settingsKey, readStore()[settingsKey]]),
        ));
        restoreDefaults();
    });

    afterEach(() => {
        restoreDefaults();
        vi.unstubAllGlobals();
    });

    it('collects a tuning from the store for every tuning file', () => {
        expect(tuningFiles.length).toBeGreaterThan(0);
        expect(Object.keys(readTunings()).sort()).toEqual(tuningFiles.map(file => file.mode).sort());
    });

    it('restores every style from an exported short code that has no single fields, through the call the import makes', () => {
        const exported = customiseEveryStyle();
        const incoming = decompressConfig(compressConfig(withoutSingleFields(buildVisualSettingsConfig())));
        restoreDefaults();

        // The confirmation dialog offers one row for the bundle, with something to change in every style.
        const plan = buildImportPlan({
            incoming,
            current: buildVisualSettingsConfig(),
            switches: { isCustomThemePreferred: false, songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false },
        });
        const offered = plan.changes.find(change => change.key === 'visualizerTunings');
        expect(new Set(offered?.children?.map(child => child.key.split('.')[0])))
            .toEqual(new Set(tuningFiles.map(file => file.mode)));

        // What applyImportedConfig (pages/storage/visualConfigTransfer.ts) does when that row is taken.
        applyVisualizerTuningsToSettings(readStore(), incoming.visualizerTunings);

        expect(readTunings()).toEqual(exported);
    });

    it('applies every style from a synced record that has no single fields', () => {
        const exported = customiseEveryStyle();
        const record = buildSyncedSettingsRecord(readSyncableSettingsState());
        const received = parseSyncedSettingsRecord(JSON.parse(JSON.stringify({
            ...record,
            data: withoutSingleFields(record.data),
        })));
        restoreDefaults();

        applySyncedVisualSettings(readSyncableSettingsState(), received!.data);

        expect(readTunings()).toEqual(exported);
    });

    it('hands the OBS web page every style from a link that has no single fields', () => {
        const exported = customiseEveryStyle();
        const cfg = compressConfig(withoutSingleFields(buildVisualSettingsConfig()));

        const appearance = buildObsAppearanceFromShortcode(cfg, { isDaylight: false, transparent: false });

        expect(appearance.visualizerTunings).toEqual(exported);
    });
});
