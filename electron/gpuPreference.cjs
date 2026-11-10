// electron/gpuPreference.cjs
// Which GPU Chromium renders on, chosen in Settings > Performance (Windows only, issue #825).
// Chromium takes the first adapter DXGI lists, which on a hybrid laptop is the integrated one the
// built-in screen hangs off. Its own --force_high_performance_gpu / --force_low_power_gpu
// switches make the GPU process ask DXGI for the adapter by preference instead
// (gpu/ipc/service/gpu_init.cc, SetupGLDisplayManagerEGL). A per-app choice in Windows' graphics
// settings still wins over them: DXGI then answers with that adapter whatever is asked for.
// macOS and Linux get nothing: on Linux the switches reach no code, Apple Silicon has one GPU, and
// on an Intel Mac Chromium only picks the adapter with ANGLE on Metal while Folia uses ANGLE on GL.

const GPU_PREFERENCE_SETTING_KEY = 'GPU_PREFERENCE';
const GPU_PREFERENCES = ['auto', 'high-performance', 'low-power'];
const SWITCHES = {
  'high-performance': 'force_high_performance_gpu',
  'low-power': 'force_low_power_gpu',
};

/** A stored value read as one of the three choices; anything else is 'auto'. */
function normalizeGpuPreference(value) {
  return GPU_PREFERENCES.includes(value) ? value : 'auto';
}

/** The Chromium switch a choice adds on this platform, or null for none. */
function gpuPreferenceSwitch(preference, platform) {
  if (platform !== 'win32') return null;
  return SWITCHES[normalizeGpuPreference(preference)] ?? null;
}

/**
 * Adds the switch for the stored choice. Must run before the ready event, while the GPU process has
 * not started yet. Either switch passed on the command line wins, and then the stored choice is
 * left alone. Answers the choice in effect for this run of the app.
 */
function applyGpuPreference({ app, store, platform = process.platform }) {
  const preference = normalizeGpuPreference(store.get(GPU_PREFERENCE_SETTING_KEY));
  if (platform !== 'win32') {
    return { preference: 'auto', source: 'platform' };
  }
  const passed = Object.entries(SWITCHES).find(([, name]) => app.commandLine.hasSwitch(name));
  if (passed) {
    return { preference: passed[0], source: 'command-line' };
  }
  const switchName = gpuPreferenceSwitch(preference, platform);
  if (switchName) {
    app.commandLine.appendSwitch(switchName);
  }
  return { preference, source: 'setting' };
}

/** The name of the adapter a GPU info object marks active, or null when none is (software rendering). */
function activeGpuName(info) {
  const device = (info?.gpuDevice ?? []).find(candidate => candidate.active);
  if (!device) return null;
  return device.deviceString || `vendor 0x${device.vendorId.toString(16)}, device 0x${device.deviceId.toString(16)}`;
}

/**
 * Reads the name of the adapter Chromium renders on, once per run, and logs it the first time.
 * Only the 'complete' level marks the active adapter, and on Windows it also gathers DxDiag data
 * (about half a second), so the answer is kept: the adapter does not change within a run. A failed
 * read is not kept.
 */
function createActiveGpuReader(app) {
  let pending = null;
  return () => {
    pending ??= app.getGPUInfo('complete').then((info) => {
      const name = activeGpuName(info);
      console.info(`[Gpu] Rendering on ${name ?? 'no hardware adapter'}`);
      return name;
    }).catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/** Logs the choice this run started with and where it came from. */
function logGpuPreference(applied) {
  if (applied.source === 'platform') return;
  const how = applied.source === 'command-line' ? 'a command-line switch' : 'the setting';
  console.info(`[Gpu] Preference ${applied.preference}, from ${how}`);
}

module.exports = {
  GPU_PREFERENCE_SETTING_KEY,
  activeGpuName,
  applyGpuPreference,
  createActiveGpuReader,
  gpuPreferenceSwitch,
  logGpuPreference,
  normalizeGpuPreference,
};
