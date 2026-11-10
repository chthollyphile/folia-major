import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, type MotionValue } from 'framer-motion';
import { progressSince } from '../../../services/automix/handoffProgress';
import {
    dropLeavingMonetPortraitLayers,
    endMonetPortraitHandoff,
    MONET_PORTRAIT_FADE_MS,
    pushMonetPortraitLayer,
    settleMonetPortraitLayers,
    type MonetPortraitLayer,
} from './monetPortraitCrossfade';

// src/components/visualizer/monet/MonetPortraitImage.tsx

type MonetPortraitImageProps = {
    src?: string | null;
    /** Crossfade length in milliseconds. */
    fadeMs?: number;
    /**
     * A blend's song hand-off, 0..1, while it runs: a cover that arrives then fades in along it, as long
     * as the blend, instead of over `fadeMs`. Once it is gone the rest of that fade takes `fadeMs`.
     */
    progress?: MotionValue<number>;
};

type MonetPortraitLayerImageProps = {
    src: string;
    opacity: number;
    fadeMs: number;
    progress?: MotionValue<number>;
    /** Where `progress` stood when this cover's fade along it began (MonetPortraitLayer.handoffFrom). */
    from: number;
};

/** One cover of the stack, fading to `opacity` over `fadeMs`, or along `progress` while it is given. */
const MonetPortraitLayerImage: React.FC<MonetPortraitLayerImageProps> = ({ src, opacity: target, fadeMs, progress, from }) => {
    // A cover that takes the place of one fading along the hand-off shows where that one was.
    // Counted from where its fade began, so a cover that decodes late fades in rather than jumping.
    const opacity = useMotionValue(progress ? target * progressSince(progress.get(), from) : 0);

    useEffect(() => {
        if (progress) {
            const follow = (value: number) => opacity.set(target * progressSince(value, from));
            follow(progress.get());
            return progress.on('change', follow);
        }
        const fade = animate(opacity, target, { duration: fadeMs / 1000, ease: 'easeInOut' });
        return () => fade.stop();
    }, [opacity, target, fadeMs, progress, from]);

    return (
        <motion.img
            src={src}
            style={{ opacity }}
            decoding="async"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            data-monet-portrait-image
        />
    );
};

/**
 * Hands the cover over in place instead of replacing it.
 *
 * The frame used to swap the image node the moment a new URL arrived, so it stood empty for as
 * long as that URL took to reach the screen - the flash at a track change, and a long one whenever
 * the cover resolved from the network rather than the cache. Here the URL is decoded off-screen
 * first and only then stacked over the cover already showing, which means the frame is never empty
 * and a URL that never decodes at all (a revoked blob, the failure this component was originally
 * written for) leaves the previous cover up rather than punching a hole.
 */
const MonetPortraitImage: React.FC<MonetPortraitImageProps> = ({ src, fadeMs = MONET_PORTRAIT_FADE_MS, progress }) => {
    const [layers, setLayers] = useState<MonetPortraitLayer[]>([]);
    const layerKeyRef = useRef(0);
    const progressRef = useRef(progress);
    // The cover asked for, as the hand-off's end reads it: before the effects of the same commit.
    const srcRef = useRef(src);
    useLayoutEffect(() => {
        srcRef.current = src;
    });
    useEffect(() => {
        progressRef.current = progress;
        // Once the hand-off is over no cover follows it, so none is tied to the next one. A cancel asks
        // for the cover beneath again in the same commit, and the one that was coming in fades back out.
        if (!progress) setLayers(current => endMonetPortraitHandoff(current, srcRef.current));
    }, [progress]);

    useEffect(() => {
        if (!src) {
            return undefined;
        }
        let cancelled = false;
        const stack = () => {
            if (cancelled) return;
            layerKeyRef.current += 1;
            const key = `monet-portrait-${layerKeyRef.current}`;
            // One that decodes once the hand-off has come to its end fades in on the clock.
            const handoffAt = progressRef.current?.get();
            const along = handoffAt !== undefined && handoffAt < 1 ? Math.max(0, handoffAt) : undefined;
            setLayers(current => pushMonetPortraitLayer(current, src, key, along));
        };

        // Decoded on a detached element so the frame keeps showing the old cover until this one can
        // be painted whole. The rendered <img> below then hits the same decoded entry.
        const loader = new Image();
        loader.decoding = 'async';
        loader.src = src;
        if (typeof loader.decode === 'function') {
            // A rejection is a cover that cannot be shown - a dead blob URL, a 404, a truncated
            // body. Swallowed on purpose: the stack is left as it is, which keeps the cover that is
            // already on screen rather than fading to an empty frame.
            loader.decode().then(stack, () => {});
        } else {
            loader.onload = stack;
        }

        return () => {
            cancelled = true;
        };
    }, [src]);

    // Armed against the top layer only. A cover that arrives mid-fade pushes a new top and re-arms
    // this, so the whole stack is dropped in one go once that last cover is opaque - no layer is
    // ever removed while something below it is still visible through it. A cover fading in along a
    // hand-off is opaque when the hand-off says so, so the timer waits for the hand-off to be over.
    const top = layers.length > 1 ? layers[layers.length - 1] : null;
    const settlingKey = top && top.handoffFrom === undefined && !top.leaving ? top.key : null;
    useEffect(() => {
        if (!settlingKey) {
            return undefined;
        }
        const timer = window.setTimeout(
            () => setLayers(current => settleMonetPortraitLayers(current, settlingKey)),
            fadeMs,
        );
        return () => window.clearTimeout(timer);
    }, [fadeMs, settlingKey]);

    // A cover going back out (a cancelled hand-off) is dropped once it has faded away.
    const hasLeaving = layers.some(layer => layer.leaving);
    useEffect(() => {
        if (!hasLeaving) {
            return undefined;
        }
        const timer = window.setTimeout(() => setLayers(dropLeavingMonetPortraitLayers), fadeMs);
        return () => window.clearTimeout(timer);
    }, [fadeMs, hasLeaving]);

    // A song with no cover at all fades the stack out and keeps it, so the next cover has something
    // to fade in over instead of appearing against the bare frame.
    const targetOpacity = src ? 1 : 0;

    return (
        <div className="relative h-full w-full">
            {layers.map(layer => (
                <MonetPortraitLayerImage
                    key={layer.key}
                    src={layer.src}
                    opacity={layer.leaving ? 0 : targetOpacity}
                    fadeMs={fadeMs}
                    progress={layer.handoffFrom !== undefined ? progress : undefined}
                    from={layer.handoffFrom ?? 0}
                />
            ))}
        </div>
    );
};

export default MonetPortraitImage;
