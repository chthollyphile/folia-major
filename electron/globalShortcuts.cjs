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

/** The modifiers an accelerator may hold, each at most once, and at least one of them. */
const ACCELERATOR_MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Super']);
/** The named keys Electron knows besides the letters and digits: what the settings may bind. */
const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Return', 'Backspace', 'Delete', 'Insert',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown',
]);
/** Five chosen keys natively; on the Wayland portal every playback command, eight today. */
const MAX_SHORTCUTS = 10;

/** Whether a value is an accelerator this app registers: at least one modifier and one key on the list. */
function isAccelerator(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const parts = value.split('+');
  const key = parts.pop();
  if (parts.length === 0 || !isAcceleratorKey(key)) {
    return false;
  }
  const held = new Set();
  for (const part of parts) {
    if (!ACCELERATOR_MODIFIERS.has(part) || held.has(part)) {
      return false;
    }
    held.add(part);
  }
  return true;
}

function isAcceleratorKey(key) {
  return /^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key);
}

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
      ? [...new Set(accelerators.filter(isAccelerator))].slice(0, MAX_SHORTCUTS)
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
