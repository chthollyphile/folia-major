import { createContext, useCallback, useContext, useLayoutEffect } from 'react';

// src/components/visualizer/styleTransition/firstFrame.ts
// How a lyric style with a slow start (shaders to compile, a whole song to lay out) tells the style
// switch that it has drawn its first frame. The switch's transition starts then (VisualizerStyleTransition),
// so the start does not stop the transition halfway. A style that never asks is ready the moment it
// mounts: a new style needs nothing here unless it starts slowly. A background copy mounted for a new
// song or type says the same once what it loads first is there (VisualizerBackgroundTransition).

/** What a style layer gives the style in it. */
export interface FirstFrameReport {
    /** The style will say when it has drawn its first frame. */
    claim: () => void;
    /** The style has drawn its first frame. */
    drawn: () => void;
}

export const FirstFrameContext = createContext<FirstFrameReport | null>(null);

/**
 * For a style with a slow start: the function to call once it has drawn its first frame (and also
 * where it has failed and shows something else). Calling the hook is the promise to call it. Outside
 * a style switch (a picture, a host that cuts) it does nothing.
 */
export const useFirstFrameDrawn = (): (() => void) => {
    const report = useContext(FirstFrameContext);
    // A layout effect: the style layer looks in its own, which runs after this one, whether it is to wait.
    useLayoutEffect(() => {
        report?.claim();
    }, [report]);
    return useCallback(() => report?.drawn(), [report]);
};

/** True while the background copy around waits unseen for its change to start; false anywhere else. */
export const LayerUnseenContext = createContext(false);

/** Whether what is drawn now is still unseen: a background's own fade-in need not play then. */
export const useLayerUnseen = (): boolean => useContext(LayerUnseenContext);
