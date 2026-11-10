// electron/linuxVulkan.cjs
// Whether the Linux build turns Chromium's Vulkan feature on (FOLIA_LINUX_VULKAN=1, issue #752).
// On the X11 backend Chromium leaves Vulkan off, and WebGPU then finds no adapter at all, so the
// smart beat effects never run. On the native Wayland backend the opposite holds: WebGPU works
// without Vulkan, and turning it on makes Chromium log "'--ozone-platform=wayland' is not compatible
// with Vulkan" and lose the GPU process. So the opt-in is honoured only on X11.

const { resolveLinuxOzonePlatform } = require('./windowAlwaysOnTopSupport.cjs');

/**
 * Decides whether to enable Vulkan. `refused` names why a requested opt-in was ignored
 * ('graphics-mode' or 'not-x11'), and is null when it was honoured or never asked for.
 */
function resolveLinuxVulkanChoice({
  platform = process.platform,
  env = process.env,
  ozonePlatform = '',
  graphicsMode = 'system',
} = {}) {
  if (platform !== 'linux' || env.FOLIA_LINUX_VULKAN !== '1') {
    return { enabled: false, refused: null, ozonePlatform: null };
  }

  const resolvedOzonePlatform = resolveLinuxOzonePlatform({ platform, ozonePlatform, env });
  // swiftshader and software modes keep Chromium off the host GPU stack on purpose.
  if (graphicsMode !== 'system') {
    return { enabled: false, refused: 'graphics-mode', ozonePlatform: resolvedOzonePlatform };
  }
  if (resolvedOzonePlatform !== 'x11') {
    return { enabled: false, refused: 'not-x11', ozonePlatform: resolvedOzonePlatform };
  }
  return { enabled: true, refused: null, ozonePlatform: resolvedOzonePlatform };
}

/** Records the decision when the user asked for Vulkan; stays quiet otherwise. */
function logLinuxVulkanChoice(choice, graphicsMode) {
  if (choice.enabled) {
    console.info('[LinuxGraphics] Vulkan enabled by FOLIA_LINUX_VULKAN=1 on the x11 backend');
  } else if (choice.refused === 'graphics-mode') {
    console.warn(`[LinuxGraphics] FOLIA_LINUX_VULKAN=1 ignored: graphics mode is ${graphicsMode}, not system`);
  } else if (choice.refused === 'not-x11') {
    console.warn(`[LinuxGraphics] FOLIA_LINUX_VULKAN=1 ignored: backend is ${choice.ozonePlatform}, Vulkan only works on x11 (--ozone-platform=x11)`);
  }
}

module.exports = {
  resolveLinuxVulkanChoice,
  logLinuxVulkanChoice,
};
