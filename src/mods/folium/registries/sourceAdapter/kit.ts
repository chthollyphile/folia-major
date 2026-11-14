import type { UnifiedSong } from '@/types';
import { OnlineProviderError, type ProviderCollection, type ProviderNotice } from '@/types/onlineMusic';
import type { FoliumSourceCollection } from '../../sources/contract';
import { foliumSourceMember, timeFoliumMod } from '../../../runtime/guard';
import { isFoliumText, type FoliumSourceTextBook } from '../sourceText';
import { isFoliumSourceSong, toHostCollection, toHostSong } from '../sourceDtos';

// src/mods/folium/registries/sourceAdapter/kit.ts
// What every part of the source adapter (this folder) shares: reading what a source answers (as `unknown`: a
// source is a mod's JavaScript, whatever its types say), calling its members (`run` through the gate for the
// async ones, `sync` made once for the hot-path ones, guard.ts), and turning its DTOs and texts into the host's.

/** The source being adapted. */
export interface SourceAdapterContext {
    modId: string;
    hostId: string;
    text: FoliumSourceTextBook;
    /** Every function `watch` was handed (omni.watchProviders), for `handle.notify`. */
    tells: Set<(notice: ProviderNotice) => void>;
}

export const record = (value: unknown): Record<string, unknown> | null => (
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
);

/** A string, or a number written out; '' for anything else. */
export const text = (value: unknown): string => (
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
);

export const optionalText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

export const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value as unknown[] : []);

/** One answer the source may give again as the same object, turned into the host's shape once. */
export const lastOf = <Out>(convert: (value: unknown) => Out) => {
    let lastIn: unknown = undefined;
    let lastOut: Out | undefined;
    let known = false;
    return (value: unknown): Out => {
        if (!known || value !== lastIn) {
            lastOut = convert(value);
            lastIn = value;
            known = true;
        }
        return lastOut as Out;
    };
};

/** The helpers one adapted source's parts are built with. */
export interface SourceAdapterKit {
    readonly context: SourceAdapterContext;
    /** `source <id>`, for log lines and the gate. */
    readonly label: string;
    /** Calls an async member through the gate; a source's error comes out as the host's OnlineProviderError of it. */
    run(where: string, work: () => unknown): Promise<unknown>;
    /** A sync member as the host calls it on its hot paths, made once (guard.ts foliumSourceMember). */
    /** A synchronous member; a throw answers `fallback(...args)`, the member's cautious answer (guard.ts). */
    sync<Args extends unknown[], Result>(where: string, member: (...args: Args) => Result, fallback: (...args: Args) => Result): (...args: Args) => Result;
    readonly song: (value: unknown) => UnifiedSong | null;
    readonly songs: (value: unknown) => UnifiedSong[];
    readonly collection: (value: unknown) => ProviderCollection | null;
    readonly collections: (value: unknown) => ProviderCollection[];
    /** The i18n key of a FoliumText; undefined for none, or for a value that is no FoliumText. */
    key(value: unknown, field: string): string | undefined;
    /** A text as the host's `{ labelKey, labelFallback }` (fallback in the UI language now). */
    labelOf(value: unknown, field: string): { labelKey: string; labelFallback: string };
    /** A text in the UI language now. */
    now(value: unknown, field: string): string;
}

export const createSourceAdapterKit = (context: SourceAdapterContext): SourceAdapterKit => {
    const { modId, hostId, text: book } = context;
    const label = `source ${hostId}`;
    // A source's failure as the host's, named after this source (folium.sources.error makes one without a name).
    const hostError = (error: unknown): unknown => {
        if (error instanceof OnlineProviderError && !error.providerId) {
            return new OnlineProviderError(error.code, error.message, hostId, error.cause, error.httpStatus, error.retryAfterMs);
        }
        return error;
    };
    const song = (value: unknown): UnifiedSong | null => (isFoliumSourceSong(value) ? toHostSong(hostId, value) : null);
    const collection = (value: unknown): ProviderCollection | null => {
        const entry = record(value);
        return entry && typeof entry.id === 'string' ? toHostCollection(hostId, entry as unknown as FoliumSourceCollection) : null;
    };
    const key = (value: unknown, field: string) => (isFoliumText(value) ? book.key(value, field) : undefined);
    const now = (value: unknown, field: string) => (isFoliumText(value) ? book.now(value, field) : '');
    return Object.freeze({
        context,
        label,
        run: async (where: string, work: () => unknown): Promise<unknown> => {
            try {
                return await timeFoliumMod(modId, `${label} ${where}`, work);
            } catch (error) {
                throw hostError(error);
            }
        },
        sync: <Args extends unknown[], Result>(where: string, member: (...args: Args) => Result, fallback: (...args: Args) => Result) => (
            foliumSourceMember(modId, `${label} ${where}`, member, fallback)
        ),
        song,
        songs: (value: unknown) => list(value).map(song).filter((item): item is UnifiedSong => item !== null),
        collection,
        collections: (value: unknown) => list(value).map(collection).filter((item): item is ProviderCollection => item !== null),
        key,
        labelOf: (value: unknown, field: string) => ({ labelKey: key(value, field) ?? '', labelFallback: now(value, field) }),
        now,
    });
};
