'use strict';

// electron/modSystem/communityMods.cjs
// Folium 2.0: the mod system is on by default, and on its own installs and runs only official source mods
// (signed by an official key, `verified`, and a source mod: an override pack of a built-in source, a pack
// `sources:pack` makes). Every other mod from the user's folders is a community mod: third-party code with the
// app's full rights, installed and run only once the "community mods" switch is on. The switch is the main
// process's (the host's config store, MOD_COMMUNITY_ENABLED): the window shows it and asks for it through
// folia-mods:set-community, which confirms in a native dialog; save-settings never writes it.
//
// Which folders it covers: the user's mods folder and resources/mods (a per-user install can write there). The
// source tree's mods/ of a development build (tier 'repo', never in a packaged app) is the developer's own
// and stays as it was. Built-in copies are not mods from a folder at all.

const { isSourceManifest } = require('./manifest.cjs');

const MOD_SYSTEM_SETTING_KEY = 'MOD_SYSTEM_ENABLED';
const COMMUNITY_MODS_SETTING_KEY = 'MOD_COMMUNITY_ENABLED';

/** The folders whose mods the switch covers. */
const COMMUNITY_GATED_TIERS = Object.freeze(new Set(['user', 'resources']));

/**
 * An official source mod: a source mod whose signature checks out as `verified`, the state the app labels 官方认证 —
 * a key of the official or the reviewed (CI) channel in trustedKeys.cjs, not the beta one.
 */
const isOfficialSourceMod = (manifest, signature) => Boolean(
    manifest && signature?.status === 'verified' && isSourceManifest(manifest),
);

/** Whether a mod from a folder of tier `tier` may be installed and run while community mods are off. */
const isAllowedWithoutCommunity = ({ tier, manifest, signature }) => (
    !COMMUNITY_GATED_TIERS.has(tier ?? 'user') || isOfficialSourceMod(manifest, signature)
);

// The stored value as main.cjs readStoredBoolean reads it: a boolean, 'true' / 'false', a number; else undefined.
const storedBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    if (typeof value === 'number') return value !== 0;
    return undefined;
};

/*
 * Once per profile, before anything reads either switch: a profile that has no community record yet gets one.
 * Before Folium 2.0 the master switch was off by default and on meant "run the mods I installed": a profile
 * whose master switch was explicitly on keeps its mods running (community on); any other (fresh, never touched,
 * explicitly off) starts with it off. A profile that has the record is left as it is, so running it again
 * changes nothing. Returns what it wrote, or null.
 */
const migrateCommunityModsSetting = (store) => {
    if (storedBoolean(store.get(COMMUNITY_MODS_SETTING_KEY)) !== undefined) return null;
    const value = storedBoolean(store.get(MOD_SYSTEM_SETTING_KEY)) === true;
    store.set(COMMUNITY_MODS_SETTING_KEY, value);
    return value;
};

module.exports = {
    MOD_SYSTEM_SETTING_KEY,
    COMMUNITY_MODS_SETTING_KEY,
    COMMUNITY_GATED_TIERS,
    isOfficialSourceMod,
    isAllowedWithoutCommunity,
    migrateCommunityModsSetting,
    storedBoolean,
};
