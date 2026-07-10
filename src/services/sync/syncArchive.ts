import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseSyncLibraryExportBundle } from './syncSchema';
import type { SyncLibraryExportBundle } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';

// src/services/sync/syncArchive.ts
// Builds and reads multi-file zip backups for the local-first sync library export.

const ARCHIVE_KIND = 'folia-sync-zip';
const encodeJson = (value: unknown) => strToU8(JSON.stringify(value, null, 2));

const parseZipJson = (files: Record<string, Uint8Array>, path: string): unknown => {
    const file = files[path];
    if (!file) {
        return null;
    }

    return JSON.parse(strFromU8(file));
};

export const createSyncLibraryZipBlob = (bundle: SyncLibraryExportBundle): Blob => {
    const files: Record<string, Uint8Array> = {
        'meta.json': encodeJson({
            kind: ARCHIVE_KIND,
            schemaVersion: SYNC_SCHEMA_VERSION,
            exportedAt: bundle.exportedAt,
        }),
        'themes/themes.json': encodeJson(bundle.themes),
    };

    if (bundle.settings) {
        files['settings/current.json'] = encodeJson(bundle.settings);
    }

    const zipped = zipSync(files, { level: 6 });
    return new Blob([zipped], { type: 'application/zip' });
};

export const readSyncLibraryZipFile = async (file: File): Promise<SyncLibraryExportBundle> => {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const meta = parseZipJson(files, 'meta.json') as { kind?: unknown; schemaVersion?: unknown; exportedAt?: unknown } | null;
    if (!meta || meta.kind !== ARCHIVE_KIND || meta.schemaVersion !== SYNC_SCHEMA_VERSION || typeof meta.exportedAt !== 'string') {
        throw new Error('Invalid Folia sync zip export');
    }

    const bundle = parseSyncLibraryExportBundle({
        kind: 'folia-sync-export',
        schemaVersion: SYNC_SCHEMA_VERSION,
        exportedAt: meta.exportedAt,
        settings: files['settings/current.json'] ? parseZipJson(files, 'settings/current.json') : null,
        themes: parseZipJson(files, 'themes/themes.json'),
    });
    if (!bundle) {
        throw new Error('Invalid Folia sync zip export');
    }
    return bundle;
};
