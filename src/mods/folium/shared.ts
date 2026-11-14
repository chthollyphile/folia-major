import shared from '../../../electron/modSystem/foliumShared.json';

// src/mods/folium/shared.ts
// The window side's reading of the one file that holds what both sides of the
// mod system must agree on: the Folium version, the permission ids (each with
// the member paths it guards) and the names of the experimental surfaces
// (electron/modSystem/foliumShared.json, which the main process reads too; it
// sits there because only that folder is in the packaged app for the main
// process to read). Nothing here is written a second time: contract.ts, which
// imports nothing, keeps its own FOLIUM_VERSION, and a unit test holds it to
// this file (test/unit/mod-system/foliumShared.test.ts).

/** The Folium version this host implements: what a mod reads as `folium.host.folium`. */
export const FOLIUM_HOST_VERSION = Object.freeze({ ...shared.version });

/** Folium 2.0 (plan §9): the version a `folium: 1` mod reads, the one its interface stays at. */
export const FOLIUM_ONE_VERSION = Object.freeze({ ...shared.foliumOneVersion });

/**
 * Folium 2.0 (plan §10, delivery): the source interface (`folium.sources` and the main entry's source `api`) is a
 * preview until all nine built-in sources use it, and may change until then. The mod panel marks third-party
 * source mods with it, and the reference and type file say so (dev/folium/api-docs.mjs, types.mjs). S8 sets it
 * to false.
 */
export const FOLIUM_SOURCES_PREVIEW: boolean = shared.sourcesPreview;

/** Folium 2.0: the limits of ordinary mods and of source mods, side by side (plan §5.2). */
export const FOLIUM_SHARED_LIMITS = shared.limits;

/** The experimental surfaces a mod can opt into in mod.json. */
export const FOLIUM_EXPERIMENTAL = Object.freeze({ ...shared.experimental });

/** A permission id, as a mod writes it in mod.json: 'filesystem.data', 'playback.control', 'stageLayers'. */
export type FoliumPermissionId = keyof typeof shared.permissions;
