import { useEffect, useRef, type RefObject } from 'react';
import { openCommandFilter, registerCommandFilter, useAppViewStore } from '../stores/useAppViewStore';
import type { LibraryQueryPort } from '../library/core/shared/session.contract';

// src/hooks/useGridCommandFilter.ts
// Hands one grid's filter box over to the command palette.
//
// The three grids each used to carry a window keydown listener that turned any printable character
// into "open my search panel", plus their own `<input>`. That is three copies of one idea, and it
// is also why the palette could not open on home: a bare key meant two different things at once.
// Now the grid says "I read typing, here is where the text goes and where the box belongs", and the
// palette does the rest.
//
// The two halves come from different places: the query port is whatever owns the text (component
// state, or a Library Core browse session), the anchor is always the renderer's own element. They
// are joined only here, at registration, so core code never has to know about the DOM.

type UseGridCommandFilterParams = {
    /** Only the grid the listener is actually looking at should claim the keyboard. */
    isInteractive: boolean;
    /** Reads and writes the filter text. Read through a latest-ref, so a fresh object per render is fine. */
    port: LibraryQueryPort;
    /** The element the filter box used to be positioned against; the palette portals into it. */
    anchorRef: RefObject<HTMLElement | null>;
    /**
     * The text outlives this component (a browse session): if it is already filtered the first time
     * this grid becomes interactive, put the box back up — otherwise the view is narrowed with nothing
     * on screen saying so.
     */
    reopenIfFiltered?: boolean;
    /** ↓ in the box: move the keyboard to the first result (see CommandFilterAnchor.focusResults). */
    onFocusResults?: () => boolean;
};

export const useGridCommandFilter = ({ isInteractive, port, anchorRef, reopenIfFiltered = false, onFocusResults }: UseGridCommandFilterParams) => {
    // Assigned during render, not in an effect: an effect leaves a window in which the palette
    // would write through the previous render's setter.
    const latestRef = useRef(port);
    latestRef.current = port;
    const focusResultsRef = useRef(onFocusResults);
    focusResultsRef.current = onFocusResults;
    const hasFocusResults = Boolean(onFocusResults);
    const isFiltering = useAppViewStore(state => state.isCommandFilterOpen);

    useEffect(() => {
        if (!isInteractive) {
            return;
        }

        return registerCommandFilter({
            getQuery: () => latestRef.current.getQuery(),
            setQuery: (next) => latestRef.current.setQuery(next),
            getAnchor: () => anchorRef.current,
            ...(hasFocusResults ? { focusResults: () => focusResultsRef.current?.() ?? false } : {}),
        });
    }, [anchorRef, hasFocusResults, isInteractive]);

    // Declared after the registration so that, on the same commit, the owner exists before the request.
    const reopenedRef = useRef(false);
    useEffect(() => {
        if (!reopenIfFiltered || reopenedRef.current || !isInteractive) return;
        reopenedRef.current = true;
        if (latestRef.current.getQuery()) openCommandFilter();
        // Checked once, the first time this grid becomes interactive.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInteractive]);

    /** True while the palette is filtering this grid, i.e. the old `showSearchPanel`. */
    return isFiltering;
};
