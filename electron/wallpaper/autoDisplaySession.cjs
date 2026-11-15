const { AUTO_DISPLAY_KEY, createAutoDisplayController } = require('./autoDisplay.cjs');
const { createWindowsWorkWindowReader } = require('./windowsWorkWindows.cjs');
const { normalizeWallpaperDisplayChoice } = require('./wallpaperDisplay.cjs');

// Own the opt-in Windows policy, transient target and native sampler outside the main entry point.
function createAutoDisplaySession({ platform, screen, store, canMove, getCurrentDisplay, applyChoice,
    onChange, readWindows = createWindowsWorkWindowReader(), logError = console.warn }) {
    let choice = null;
    const isEnabled = () => platform === 'win32' && store.get(AUTO_DISPLAY_KEY) === true;
    const isActive = () => isEnabled() && canMove();
    const controller = createAutoDisplayController({
        isActive,
        // A topology fallback can reach the policy target without an automatic move. Forget
        // the disconnected choice so reconnecting it cannot resurrect an obsolete target.
        onCurrentTarget: display => { choice = normalizeWallpaperDisplayChoice(display); },
        getSnapshot: () => {
            const displays = screen.getAllDisplays();
            const primary = screen.getPrimaryDisplay();
            return { displays, primary,
                primaryScreenBounds: screen.dipToScreenRect(null, primary.bounds),
                primaryWorkArea: screen.dipToScreenRect(null, primary.workArea),
                windows: displays.length > 1 ? readWindows() : [],
                current: getCurrentDisplay() };
        },
        move: async display => {
            const previous = choice;
            const target = normalizeWallpaperDisplayChoice(display);
            choice = target;
            try {
                const moved = await applyChoice({ choiceChanged: true, canApply: isActive });
                if (moved) {
                    onChange();
                    console.log('[AutoDisplay] wallpaper display:', display.id);
                } else if (choice === target && getCurrentDisplay()?.id !== target.id) {
                    choice = previous;
                }
            } catch (error) {
                if (choice === target) choice = previous;
                throw error;
            }
        },
        onError: logError,
    });

    return {
        isEnabled,
        getChoice: () => choice,
        tick: controller.tick,
        start: () => { if (platform === 'win32') controller.start(); },
        stop: controller.stop,
        selectManual() {
            if (platform !== 'win32') return;
            store.set(AUTO_DISPLAY_KEY, false);
            choice = null;
            controller.reset();
        },
        toggle() {
            if (platform !== 'win32') return;
            store.set(AUTO_DISPLAY_KEY, !isEnabled());
            choice = null;
            controller.reset();
            if (!isEnabled()) {
                void applyChoice({ choiceChanged: true })
                    .catch(error => logError('[AutoDisplay] restoring manual display failed', error));
            }
            onChange();
        },
    };
}

module.exports = { createAutoDisplaySession };
