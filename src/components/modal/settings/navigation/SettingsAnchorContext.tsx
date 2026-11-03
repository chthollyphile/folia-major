import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createSettingsAnchorStore, type SettingsAnchor as SettingsAnchorEntry, type SettingsAnchorStore } from './settingsAnchorStore';
import { SETTINGS_ANCHOR_SECTION, type SettingsAnchorId } from './settingsAnchorModel';
import type { SettingsSectionId } from './settingsNavModel';
// src/components/modal/settings/navigation/SettingsAnchorContext.tsx
// Lets a settings page declare its groups where they render, so the page header's tabs follow
// conditional and late-arriving groups without a second hand-maintained list.

const SettingsAnchorContext = createContext<SettingsAnchorStore | null>(null);

/** The category whose page is on screen; null outside the settings dialog. */
const SettingsAnchorSectionContext = createContext<SettingsSectionId | null>(null);

const EMPTY_ANCHORS: SettingsAnchorEntry[] = [];
const NOOP_SUBSCRIBE = () => () => {};
const EMPTY_SNAPSHOT = () => EMPTY_ANCHORS;

/**
 * Creates the registry.
 *
 * The owner holds it rather than the provider, because the sidebar reads the anchors while the
 * content column fills them in — both have to sit inside the same provider.
 */
export const useSettingsAnchorStore = (): SettingsAnchorStore => useMemo(() => createSettingsAnchorStore(), []);

export const SettingsAnchorProvider: React.FC<{
    store: SettingsAnchorStore;
    /** The category on screen. Given, an anchor that belongs to another category does not render. */
    section?: SettingsSectionId;
    children: React.ReactNode;
}> = ({ store, section = null, children }) => (
    <SettingsAnchorContext.Provider value={store}>
        <SettingsAnchorSectionContext.Provider value={section}>{children}</SettingsAnchorSectionContext.Provider>
    </SettingsAnchorContext.Provider>
);

/** Sections registered in `store`, in document order. */
export const useSettingsAnchorList = (store: SettingsAnchorStore | null): SettingsAnchorEntry[] => useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    store ? store.getSnapshot : EMPTY_SNAPSHOT,
    EMPTY_SNAPSHOT,
);

/** Same list, for components rendered inside the provider. */
export const useSettingsAnchors = (): SettingsAnchorEntry[] => useSettingsAnchorList(useContext(SettingsAnchorContext));

type SettingsAnchorProps = {
    anchorId: string;
    /** The text of the group's tab in the page header. */
    label: string;
    className?: string;
    children: React.ReactNode;
};

/**
 * A group of settings that publishes itself to the page header's tabs.
 *
 * Renders the same `<section>` the subviews used before, so swapping one in is not a visual change.
 * Registration is keyed on the element rather than the id, because StrictMode replays the mount as
 * register/unregister/register and an id-keyed teardown would drop the surviving registration.
 *
 * An anchor settingsAnchorModel places in another category than the one on screen renders nothing:
 * a group the table names shows only on the page the table gives it.
 */
export const SettingsAnchor: React.FC<SettingsAnchorProps> = ({ anchorId, label, className, children }) => {
    const nodeRef = useRef<HTMLElement | null>(null);
    const store = useContext(SettingsAnchorContext);
    const pageSection = useContext(SettingsAnchorSectionContext);
    const ownSection = SETTINGS_ANCHOR_SECTION[anchorId as SettingsAnchorId];
    const belongsElsewhere = pageSection !== null && ownSection !== undefined && ownSection !== pageSection;

    useLayoutEffect(() => {
        const node = nodeRef.current;
        if (!store || !node) {
            return;
        }

        return store.register({ id: anchorId, label, node });
    }, [store, anchorId, label, belongsElsewhere]);

    if (belongsElsewhere) {
        return null;
    }

    return (
        <section ref={nodeRef} id={`settings-${anchorId}`} data-settings-anchor={anchorId} className={className}>
            {children}
        </section>
    );
};

export default SettingsAnchor;
