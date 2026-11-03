// electron/globalShortcuts.cjs
// The system-wide playback shortcuts. The renderer decides which keys run which commands
// (src/components/command-palette/globalShortcuts); this side only registers the accelerators it is
// handed, reports which ones the system refused, and tells the main window which one was pressed.
//
// On the native Wayland backend there is no way to grab a key: Chromium hands the shortcuts to the
// desktop's GlobalShortcuts portal instead, and the desktop decides which keys trigger them. The
// listener binds them in their desktop's own settings, so the keys picked in Folia are only a
// suggestion there and a refusal cannot be seen.

const { resolveLinuxOzonePlatform } = require('./windowAlwaysOnTopSupport.cjs');

/** The only accelerators accepted: the fixed modifiers plus one letter or digit. */
const ACCELERATOR_PATTERN = /^Control\+Alt\+Shift\+[A-Z0-9]$/;
/** Five chosen keys natively; on the Wayland portal every playback command, eight today. */
const MAX_SHORTCUTS = 10;

/** Whether shortcuts go through the desktop portal: true only on the native Wayland backend. */
function usesGlobalShortcutsPortal(options) {
  return resolveLinuxOzonePlatform(options) === 'wayland';
}

/**
 * Registers and unregisters on `globalShortcut`. `apply` is handed the whole set each time, so a
 * renderer that reloads, or a window that is rebuilt, can send the full list again without leaving
 * old keys behind. Only the difference is touched: a key already held stays registered, and a set
 * sent again unchanged registers nothing. On the portal each registration may make the desktop ask
 * the listener again, and on Windows a key let go for a moment can be taken by another program.
 * A key the system refused is tried again on every apply, in case its holder has gone.
 */
function createGlobalShortcutController({ globalShortcut, onTrigger, backend }) {
  const registered = new Set();

  const unregister = (accelerator) => {
    try {
      globalShortcut.unregister(accelerator);
    } catch (error) {
      console.warn('[GlobalShortcut] unregister failed', accelerator, error);
    }
    registered.delete(accelerator);
  };

  const register = (accelerator) => {
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => onTrigger(accelerator));
    } catch (error) {
      console.warn('[GlobalShortcut] register threw', accelerator, error);
    }
    if (ok) {
      registered.add(accelerator);
    }
    return ok;
  };

  const apply = (accelerators) => {
    const requested = Array.isArray(accelerators)
      ? [...new Set(accelerators.filter(value => typeof value === 'string' && ACCELERATOR_PATTERN.test(value)))].slice(0, MAX_SHORTCUTS)
      : [];
    const added = [];
    const removed = [];

    for (const accelerator of [...registered]) {
      if (!requested.includes(accelerator)) {
        unregister(accelerator);
        removed.push(accelerator);
      }
    }

    const results = requested.map((accelerator) => {
      if (registered.has(accelerator)) {
        return { accelerator, registered: true };
      }
      const ok = register(accelerator);
      if (ok) {
        added.push(accelerator);
      }
      return { accelerator, registered: ok };
    });

    const refused = results.filter(result => !result.registered).map(result => result.accelerator);
    if (added.length > 0 || removed.length > 0 || refused.length > 0) {
      const parts = [`${registered.size} registered`];
      if (added.length) parts.push(`added ${added.join(' ')}`);
      if (removed.length) parts.push(`removed ${removed.join(' ')}`);
      if (refused.length) parts.push(`refused ${refused.join(' ')}`);
      console.info(`[GlobalShortcut] ${backend}: ${parts.join(', ')}`);
    }
    return { backend, results };
  };

  const dispose = () => {
    for (const accelerator of [...registered]) {
      unregister(accelerator);
    }
  };

  return { apply, dispose };
}

module.exports = {
  createGlobalShortcutController,
  usesGlobalShortcutsPortal,
};
