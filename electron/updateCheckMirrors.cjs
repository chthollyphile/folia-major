const { parseUpdateMetadataVersion } = require('./updateChannels.cjs');

// electron/updateCheckMirrors.cjs
// Public GitHub proxies the update check falls back to when GitHub itself cannot be read (common on
// mainland China networks). Only the small metadata file that names the newest version goes through
// them: installers are always downloaded from GitHub, against the metadata GitHub itself serves, so a
// proxy that misbehaves can at worst report a wrong version, never hand over a file to install.

// Tried all at once; the first that answers with a version wins. ghfast.top refuses requests from
// outside mainland China, the gh-proxy.com family and ghproxy.net answer from anywhere.
const UPDATE_CHECK_MIRROR_PREFIXES = [
  'https://ghfast.top/',
  'https://edgeone.gh-proxy.com/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
];

// How long one read of the metadata (GitHub's, or all the mirrors' together) may take.
const UPDATE_METADATA_TIMEOUT_MS = 15000;

// Release versions as Folia publishes them: 0.7.26, 0.7.26-beta.1794017588. Anything else a proxy
// answers is not shown to the listener.
const PUBLISHED_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

// The same metadata file through each proxy: they take the full GitHub URL after their own address.
function getUpdateMetadataMirrorUrls(githubUrl, prefixes = UPDATE_CHECK_MIRROR_PREFIXES) {
  if (typeof githubUrl !== 'string' || !githubUrl.startsWith('https://github.com/')) {
    return [];
  }
  return prefixes.map((prefix) => `${prefix}${githubUrl}`);
}

// Reads the version from the first of `urls` whose metadata names one. `readText(url, signal)` fetches
// one URL and throws on a failed request; the rest are aborted once one answers, or all of them when
// `timeoutMs` runs out. Rejects with the first URL's error when none gives a version.
async function readFirstUpdateMetadataVersion(urls, readText, timeoutMs) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('No update metadata URL to read.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const attempts = urls.map(async (url) => {
    const text = await readText(url, controller.signal);
    const version = parseUpdateMetadataVersion(text);
    if (!version || !PUBLISHED_VERSION_PATTERN.test(version)) {
      throw new Error(`Update metadata from ${new URL(url).host} did not include a release version.`);
    }
    return { url, version };
  });

  try {
    return await Promise.any(attempts);
  } catch (error) {
    throw error instanceof AggregateError && error.errors.length > 0 ? error.errors[0] : error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

// Finds the newest version: from GitHub, then from the mirrors when GitHub cannot be read. `githubError`
// is a failure to read GitHub the caller already had, which skips straight to the mirrors. Resolves to
// { version, via: 'github' | 'mirror' }; rejects with GitHub's error when no mirror answers either.
async function discoverUpdateVersion({ githubUrl, readText, githubError = null, timeoutMs = UPDATE_METADATA_TIMEOUT_MS, logger = console }) {
  let githubFailure = githubError;
  if (!githubFailure) {
    try {
      const { version } = await readFirstUpdateMetadataVersion([githubUrl], readText, timeoutMs);
      return { version, via: 'github' };
    } catch (error) {
      logger.warn('[Updater] GitHub update metadata unreachable, asking the mirrors', error);
      githubFailure = error;
    }
  }

  // Each mirror's failure is logged on its own: only the first would reach the caller.
  const readMirrorText = async (url, signal) => {
    try {
      return await readText(url, signal);
    } catch (error) {
      if (!signal.aborted) {
        logger.warn('[Updater] mirror did not answer', { mirror: new URL(url).host }, error);
      }
      throw error;
    }
  };

  try {
    const { url, version } = await readFirstUpdateMetadataVersion(getUpdateMetadataMirrorUrls(githubUrl), readMirrorText, timeoutMs);
    logger.info('[Updater] update metadata read through a mirror', { mirror: new URL(url).host, version });
    return { version, via: 'mirror' };
  } catch (error) {
    logger.warn('[Updater] no mirror answered the update check', error);
    throw githubFailure;
  }
}

// Resolves or rejects with `promise`, or rejects with `message` once `ms` have passed. The promise
// itself keeps running; its later outcome is ignored here.
function settleWithin(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  UPDATE_CHECK_MIRROR_PREFIXES,
  UPDATE_METADATA_TIMEOUT_MS,
  discoverUpdateVersion,
  getUpdateMetadataMirrorUrls,
  readFirstUpdateMetadataVersion,
  settleWithin,
};
