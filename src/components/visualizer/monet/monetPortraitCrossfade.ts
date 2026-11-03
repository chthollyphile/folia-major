// src/components/visualizer/monet/monetPortraitCrossfade.ts
// The layer stack a Monet cover crossfade renders, kept pure so the ordering rules can be tested
// without a DOM.
//
// A cover swap is a stack rather than a pair because skipping tracks faster than one fade can
// finish is ordinary: with a pair the half-faded cover would have to be thrown away to make room,
// which shows the one underneath for a moment - the flash the crossfade exists to remove. Stacked,
// every new cover simply fades in over whatever is already there, and nothing is removed until the
// top one is fully opaque and hiding all of them.

export interface MonetPortraitLayer {
    /** Stable across the promotion to the bottom of the stack, so React keeps the decoded node. */
    key: string;
    src: string;
    /**
     * Where the blend's song hand-off stood when this cover's fade along it began; unset for a cover
     * fading on the clock (MonetPortraitImage's `progress`).
     */
    handoffFrom?: number;
    /** Fading back out: the cover a cancelled hand-off was bringing in. Drawn under nothing new. */
    leaving?: boolean;
}

/** Default crossfade length. Matches the Monet background layer's own image swap. */
export const MONET_PORTRAIT_FADE_MS = 900;

/**
 * How deep the stack may get before the bottom is dropped.
 *
 * Only reached by holding skip down, and by then the bottom layers are completely covered by the
 * ones above; the cap is there so a stuck fade cannot grow the stack without bound.
 */
export const MONET_PORTRAIT_MAX_LAYERS = 4;

/** The cover the stack is heading towards - the top layer not on its way back out. */
export const monetPortraitTargetSource = (layers: MonetPortraitLayer[]): string | null => {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (!layers[index].leaving) return layers[index].src;
    }
    return null;
};

/**
 * Stacks a decoded cover on top. A repeat of the cover already on top is dropped: the effect that
 * decodes re-runs whenever the URL changes, and a URL that changes to itself is not a new cover.
 *
 * `handoffAt`, given while a hand-off runs, is where it stands: the cover fades in along it. A
 * hand-off fades in one cover. A song's cover often comes again at another address while the
 * hand-off runs (the network copy, then the cached one): the newer one takes the place of the cover
 * fading along it, from where that one began, so the fade goes on as it was.
 */
export const pushMonetPortraitLayer = (
    layers: MonetPortraitLayer[],
    src: string,
    key: string,
    handoffAt?: number,
): MonetPortraitLayer[] => {
    if (monetPortraitTargetSource(layers) === src) {
        return layers;
    }
    const top = layers[layers.length - 1];
    if (handoffAt !== undefined && top?.handoffFrom !== undefined) {
        return [...layers.slice(0, -1), { key, src, handoffFrom: top.handoffFrom }];
    }
    const next = [...layers, handoffAt === undefined ? { key, src } : { key, src, handoffFrom: handoffAt }];
    return next.length > MONET_PORTRAIT_MAX_LAYERS
        ? next.slice(next.length - MONET_PORTRAIT_MAX_LAYERS)
        : next;
};

/**
 * Drops everything below `key` once that layer has finished fading in.
 *
 * Keyed rather than "keep the last one" because the timer that calls this is armed against a
 * particular layer, and a cover that arrived while it was running has its own timer behind it.
 * A key no longer in the stack has already been settled past, so the stack is left alone.
 */
export const settleMonetPortraitLayers = (
    layers: MonetPortraitLayer[],
    key: string,
): MonetPortraitLayer[] => {
    const index = layers.findIndex(layer => layer.key === key);
    return index <= 0 ? layers : layers.slice(index);
};

/**
 * The stack once the hand-off is over: no cover fades along it any more, nor along the next one.
 * `src` is the cover asked for now. When it is one beneath the cover that was fading in along the
 * hand-off, the blend went back to it (a cancel): that cover fades back out rather than on in, which
 * would brighten it only for the cover beneath to be stacked over it again.
 */
export const endMonetPortraitHandoff = (layers: MonetPortraitLayer[], src?: string | null): MonetPortraitLayer[] => {
    const handoffIndex = layers.findIndex(layer => layer.handoffFrom !== undefined);
    if (handoffIndex < 0) return layers;
    const wentBack = Boolean(src) && layers.slice(0, handoffIndex).some(layer => layer.src === src && !layer.leaving);
    return layers.map(layer => {
        if (layer.handoffFrom === undefined) return layer;
        return wentBack ? { key: layer.key, src: layer.src, leaving: true } : { key: layer.key, src: layer.src };
    });
};

/** The stack once the covers going back out have faded away. */
export const dropLeavingMonetPortraitLayers = (layers: MonetPortraitLayer[]): MonetPortraitLayer[] => (
    layers.some(layer => layer.leaving) ? layers.filter(layer => !layer.leaving) : layers
);
