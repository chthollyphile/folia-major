// Computes and applies frame-local styles for draggable folia hex card wrappers.
import { HEX_CARD_CENTER_SCALE, computeHexCardFrame, type HexCardPointerEvents, type HexCardFrameOptions, type HexCardFrame, type HexCardFrameStyleCache, type HexCardStyleTarget } from '../../../../utils/hexCardFalloff';

export { HEX_CARD_CENTER_SCALE, computeHexCardFrame };
export type { HexCardPointerEvents, HexCardFrameOptions, HexCardFrame, HexCardFrameStyleCache, HexCardStyleTarget };

export const createHexCardFrameStyleCache = (frame: HexCardFrame): HexCardFrameStyleCache => ({
    display: frame.display,
    transform: frame.transform,
    opacity: frame.opacity,
    zIndex: frame.zIndex,
    queueOpacity: frame.queueOpacity,
    queuePointerEvents: frame.queuePointerEvents,
    playOpacity: frame.playOpacity,
    playScale: frame.playScale,
    playPointerEvents: frame.playPointerEvents,
});

// Applies only changed style values so the drag rAF loop avoids redundant DOM writes.
export const applyHexCardFrameStyles = (
    target: HexCardStyleTarget,
    frame: HexCardFrame,
    cache: HexCardFrameStyleCache
): boolean => {
    let didWrite = false;
    const { style } = target;

    if (cache.display !== frame.display) {
        style.display = frame.display;
        cache.display = frame.display;
        didWrite = true;
    }

    if (!frame.visible) {
        return didWrite;
    }

    if (cache.transform !== frame.transform) {
        style.transform = frame.transform;
        cache.transform = frame.transform;
        didWrite = true;
    }

    if (cache.opacity !== frame.opacity) {
        style.opacity = frame.opacity;
        cache.opacity = frame.opacity;
        didWrite = true;
    }

    if (cache.zIndex !== frame.zIndex) {
        style.zIndex = frame.zIndex;
        cache.zIndex = frame.zIndex;
        didWrite = true;
    }

    const setCustomProperty = (
        property: string,
        cacheKey: keyof HexCardFrameStyleCache,
        value: string
    ) => {
        if (cache[cacheKey] === value) return;
        style.setProperty(property, value);
        cache[cacheKey] = value;
        didWrite = true;
    };

    setCustomProperty('--queue-opacity', 'queueOpacity', frame.queueOpacity);
    setCustomProperty('--queue-pe', 'queuePointerEvents', frame.queuePointerEvents);
    setCustomProperty('--play-opacity', 'playOpacity', frame.playOpacity);
    setCustomProperty('--play-scale', 'playScale', frame.playScale);
    setCustomProperty('--play-pe', 'playPointerEvents', frame.playPointerEvents);

    return didWrite;
};
