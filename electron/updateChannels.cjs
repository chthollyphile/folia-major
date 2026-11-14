// electron/updateChannels.cjs
// Resolves the user-facing release lane to the electron-updater channel stored in packaged metadata.

const RELEASE_CHANNELS = {
  realeco: {
    id: 'realeco',
    label: 'Realeco',
    updaterChannel: 'latest',
    allowPrerelease: false,
    updateEnabled: true,
    rollingReleaseTag: null,
  },
  limo: {
    id: 'limo',
    label: 'Limo',
    updaterChannel: 'beta',
    allowPrerelease: true,
    updateEnabled: true,
    rollingReleaseTag: 'limo',
  },
  cielo: {
    id: 'cielo',
    label: 'Cielo',
    updaterChannel: 'alpha',
    allowPrerelease: true,
    updateEnabled: true,
    rollingReleaseTag: 'cielo',
  },
  internal: {
    id: 'internal',
    label: 'Internal',
    updaterChannel: null,
    allowPrerelease: false,
    updateEnabled: false,
    rollingReleaseTag: null,
  },
};

function normalizeReleaseChannel(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolveReleaseChannel(version, declaredChannel) {
  const declared = normalizeReleaseChannel(declaredChannel);
  if (RELEASE_CHANNELS[declared]) {
    return RELEASE_CHANNELS[declared];
  }

  const normalizedVersion = typeof version === 'string' ? version.toLowerCase() : '';
  if (/-alpha(?:[.\-]|$)/.test(normalizedVersion)) {
    return RELEASE_CHANNELS.cielo;
  }
  if (/-beta(?:[.\-]|$)/.test(normalizedVersion)) {
    return RELEASE_CHANNELS.limo;
  }
  return RELEASE_CHANNELS.realeco;
}

function getReleaseUrl(channel, version, releasesUrl) {
  const release = resolveReleaseChannel(version, channel);
  if (release.rollingReleaseTag) {
    return `${releasesUrl}/tag/${release.rollingReleaseTag}`;
  }

  const normalizedVersion = typeof version === 'string' ? version.trim().replace(/^v/i, '') : '';
  return normalizedVersion ? `${releasesUrl}/tag/v${normalizedVersion}` : releasesUrl;
}

// Windows installers are published separately; ARM64 must never consume the x64 feed.
function getUpdaterChannel(releaseChannel, { platform = process.platform, arch = process.arch } = {}) {
  const channel = releaseChannel.updaterChannel;
  return channel && platform === 'win32' && arch === 'arm64' ? `${channel}-arm64` : channel;
}

// Builds a provider configuration that can read rolling prerelease assets without GitHub's release-feed selection.
function getUpdateProviderConfig(releaseChannel, github, target) {
  if (!releaseChannel?.updateEnabled) {
    return null;
  }

  if (releaseChannel.rollingReleaseTag) {
    return {
      provider: 'generic',
      url: `https://github.com/${github.owner}/${github.repo}/releases/download/${releaseChannel.rollingReleaseTag}/`,
      channel: getUpdaterChannel(releaseChannel, target),
      useMultipleRangeRequest: false,
    };
  }

  return {
    provider: 'github',
    owner: github.owner,
    repo: github.repo,
    channel: getUpdaterChannel(releaseChannel, target),
  };
}

function getUpdateDiscoveryConfig(releaseChannel, github, target) {
  if (!releaseChannel?.updateEnabled) {
    return null;
  }

  if (releaseChannel.rollingReleaseTag) {
    return {
      format: 'yaml',
      url: `https://github.com/${github.owner}/${github.repo}/releases/download/${releaseChannel.rollingReleaseTag}/${getUpdaterChannel(releaseChannel, target)}.yml`,
    };
  }

  return {
    format: 'yaml',
    url: `https://github.com/${github.owner}/${github.repo}/releases/latest/download/${getUpdaterChannel(releaseChannel, target)}.yml`,
  };
}

function normalizeVersion(value) {
  return typeof value === 'string' ? value.trim().replace(/^v/i, '') : '';
}

// Compares the stable and timestamped prerelease versions used by all three Folia channels.
function compareVersions(leftValue, rightValue) {
  const parse = (value) => {
    const normalized = normalizeVersion(value).split('+', 1)[0];
    const [core, prerelease = ''] = normalized.split('-', 2);
    const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    return { numbers, prerelease: prerelease ? prerelease.split('.') : [] };
  };
  const left = parse(leftValue);
  const right = parse(rightValue);
  const coreLength = Math.max(left.numbers.length, right.numbers.length, 3);

  for (let index = 0; index < coreLength; index += 1) {
    const difference = (left.numbers[index] || 0) - (right.numbers[index] || 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null || rightNumber !== null) return leftNumber !== null ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

function parseUpdateMetadataVersion(text) {
  if (typeof text !== 'string') return '';
  const match = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text);
  return normalizeVersion(match?.[1]);
}

module.exports = {
  RELEASE_CHANNELS,
  compareVersions,
  getReleaseUrl,
  getUpdateDiscoveryConfig,
  getUpdateProviderConfig,
  parseUpdateMetadataVersion,
  resolveReleaseChannel,
};
