// Snaps the progress fill to quarter device pixels so the bar repaints only when its edge visibly moves.

/** Sub-steps per device pixel. A quarter pixel keeps the anti-aliased edge's coverage steps below what reads on screen. */
export const PROGRESS_FILL_STEPS_PER_DEVICE_PIXEL = 4;

/**
 * Which drawable step a progress fraction falls on, for a track `deviceWidth` device pixels wide.
 * Returns null when the width is not known yet; the caller then paints every value as before.
 */
export const getProgressFillStep = (progress: number, deviceWidth: number): number | null => {
    if (!(deviceWidth > 0)) return null;
    const clamped = Math.min(1, Math.max(0, progress));
    return Math.round(clamped * deviceWidth * PROGRESS_FILL_STEPS_PER_DEVICE_PIXEL);
};

/** The progress fraction a step stands for, so every frame on the same step paints the same edge. */
export const getProgressFillStepFraction = (step: number, deviceWidth: number): number =>
    Math.min(1, step / (deviceWidth * PROGRESS_FILL_STEPS_PER_DEVICE_PIXEL));
