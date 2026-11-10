const { execFile } = require('node:child_process');

// electron/spotify/soloistBuild.cjs
// What a Spotify Soloist program on this computer says of itself, and how long it is good for.
// Spotify lets a build run for 90 days from its build date and then refuses to start it (exit
// code 10); a new one is downloaded from Spotify's own page (Folia may not hand the program out).
// The build date is read from what `soloist --version` prints. Its exact form is not documented
// ("version, build timestamp, build identifiers, platform, architecture"), so it is read loosely:
// a Unix time in seconds next to the word "build", or failing that an ISO date. A program whose
// date cannot be read is 'unknown': it is used, and the setup says its lifetime is not known.

const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_DAYS = 90;
// From this many days before the end, the setup says to fetch a new build.
const WARN_DAYS = 14;
// `--version` is a quick question; a program that does not answer in this time is no Soloist.
const VERSION_LIMIT_MS = 5000;
const EXIT_EXPIRED = 10;
// 2020-01-01 to 2100-01-01 in Unix seconds: a number outside is no build time.
const EARLIEST_S = 1_577_836_800;
const LATEST_S = 4_102_444_800;

const buildTimeOf = output => {
  const stamped = /build\D{0,12}?(\d{10})(?!\d)/i.exec(output)?.[1] ?? /(?<!\d)(\d{10})(?!\d)/.exec(output)?.[1];
  if (stamped) {
    const seconds = Number(stamped);
    if (seconds >= EARLIEST_S && seconds < LATEST_S) return seconds * 1000;
  }
  const dated = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(output);
  if (dated) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = dated;
    const at = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (Number.isFinite(at) && at >= EARLIEST_S * 1000 && at < LATEST_S * 1000) return at;
  }
  return null;
};

/**
 * What `--version` printed, read: the version, the build time, when it stops running and how
 * many days are left. state: 'valid' | 'expiring' (WARN_DAYS or fewer left) | 'expired' |
 * 'unknown' (no build time to be read) | 'clock' (built more than a day in the future: the
 * computer's clock is wrong, and the days left cannot be trusted).
 */
function describeBuild(output, now = Date.now()) {
  const text = String(output ?? '');
  const version = /soloist\D{0,3}?(\d+(?:\.\d+)+[\w.+-]*)/i.exec(text)?.[1] ?? /(?<![\w.])(\d+\.\d+(?:\.\d+)*[\w.+-]*)/.exec(text)?.[1] ?? null;
  const builtAt = buildTimeOf(text);
  if (builtAt === null) return { state: 'unknown', version, builtAt: null, expiresAt: null, daysLeft: null };
  const expiresAt = builtAt + LIFETIME_DAYS * DAY_MS;
  const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
  const state = builtAt > now + DAY_MS ? 'clock'
    : expiresAt <= now ? 'expired'
      : daysLeft <= WARN_DAYS ? 'expiring' : 'valid';
  return { state, version, builtAt, expiresAt, daysLeft };
}

const runVersion = executable => new Promise(resolve => {
  execFile(executable, ['--version'], { timeout: VERSION_LIMIT_MS, maxBuffer: 16 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, failed: Boolean(error), output: `${stdout ?? ''}\n${stderr ?? ''}` });
  });
});

/**
 * Looks at the program at `executable`: 'missing' (no such file), 'invalid' (it is not a Soloist,
 * or does not answer), 'expired' (it says so with its exit code), or what describeBuild reads.
 * The answer is kept for a file that has not changed (same path, size and time).
 */
function createSoloistBuildReader({ fs = require('node:fs'), run = runVersion, now = Date.now } = {}) {
  let kept = null;
  return async executable => {
    let stat;
    try {
      stat = await fs.promises.stat(executable);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      return { path: executable, state: 'missing', version: null, builtAt: null, expiresAt: null, daysLeft: null };
    }
    const identity = `${executable}\n${stat.size}\n${stat.mtimeMs}`;
    if (kept?.identity === identity && kept.answer.state !== 'invalid') {
      // The days left go down while the app runs; the output is read again, the program is not.
      return kept.answer.output === null ? kept.answer.result : { path: executable, ...describeBuild(kept.answer.output, now()) };
    }
    const { code, failed, output } = await run(executable);
    let result;
    let read = null;
    if (code === EXIT_EXPIRED) {
      result = { path: executable, ...describeBuild(output, now()), state: 'expired', daysLeft: 0 };
    } else if (failed || !/soloist/i.test(output)) {
      result = { path: executable, state: 'invalid', version: null, builtAt: null, expiresAt: null, daysLeft: null };
    } else {
      read = output;
      result = { path: executable, ...describeBuild(output, now()) };
    }
    kept = { identity, answer: { output: read, result, state: result.state } };
    return result;
  };
}

module.exports = { DAY_MS, LIFETIME_DAYS, WARN_DAYS, EXIT_EXPIRED, describeBuild, createSoloistBuildReader };
