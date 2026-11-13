// electron/modSystem/modSignature.cjs
// Official mod signatures. A mod that ships `folium.sig.json` carries an
// Ed25519 signature, made with a Folium signing key, over its signed digest,
// its id and its version. The loader checks it against the public keys built
// into the host (trustedKeys.cjs) and reports one of four states:
//   - verified: signed by a trusted key over exactly the files on disk;
//   - beta:     the same, but by a preview-channel key (`channel: 'beta'`): the
//     mod passed the security review only, not a review of whether it works;
//   - unsigned: no signature file (an unreviewed third-party mod);
//   - invalid:  a signature file that does not check out (edited after signing,
//     unknown or revoked key, revoked mod, malformed file).
// The state only labels a mod. It never enables one or skips the native enable
// confirmation: a signed mod is still trusted code with the app's full rights.
//
// The signed digest is deliberately NOT the trust digest in modDigest.cjs. The
// signer and the user's machine must agree on it byte for byte, so it avoids
// everything platform-dependent: paths are NFC-normalized and sorted by code
// unit (never localeCompare), symlinks make a tree unverifiable instead of
// being recorded, and OS clutter files (Finder's .DS_Store and friends) are
// skipped so browsing the folder cannot break the signature. The algorithm is
// mirrored in the folium-compound signing tools; both sides pin it with the
// same test vector (test/unit/mod-system/modSignature.test.ts).

'use strict';

const crypto = require('crypto');
// original-fs: a .asar file in a mod directory is a file here, not a directory (rawFs.cjs).
const { rawFs: fs } = require('./rawFs.cjs');
const path = require('path');
const { DIGEST_LIMITS } = require('./modDigest.cjs');
const { TRUSTED_SIGNING_KEYS, REVOKED_MOD_DIGESTS } = require('./trustedKeys.cjs');

const SIGNATURE_FILE = 'folium.sig.json';
const SIGNATURE_FORMAT = 'folium-signature';
const SIGNATURE_VERSION = 1;
const SIGNATURE_FILE_MAX_BYTES = 16 * 1024;
// Written by file browsers, never by mod authors, and never loadable as code.
const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/*
 * Every file the signature covers, as `{ relative, absolute }` sorted by
 * relative path. Throws on anything that cannot be hashed the same way on
 * every machine: symlinks, special files, two names that normalize to one,
 * or a tree past the digest limits.
 */
const collectSignedFiles = (rootDir) => {
    const files = [];
    let totalBytes = 0;

    const walk = (currentDir, prefix) => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const name = entry.name.normalize('NFC');
            const relative = prefix ? `${prefix}/${name}` : name;
            const absolute = path.join(currentDir, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`signed-tree-has-symlink:${relative}`);
            }
            if (entry.isDirectory()) {
                walk(absolute, relative);
                continue;
            }
            if (!entry.isFile()) {
                throw new Error(`signed-tree-has-special-file:${relative}`);
            }
            if (IGNORED_FILE_NAMES.has(name) || relative === SIGNATURE_FILE) {
                continue;
            }
            totalBytes += fs.statSync(absolute).size;
            files.push({ relative, absolute });
            if (files.length > DIGEST_LIMITS.maxFiles || totalBytes > DIGEST_LIMITS.maxTotalBytes) {
                throw new Error('signed-tree-too-large');
            }
        }
    };

    walk(rootDir, '');
    files.sort((left, right) => compareCodeUnits(left.relative, right.relative));
    for (let index = 1; index < files.length; index += 1) {
        if (files[index].relative === files[index - 1].relative) {
            throw new Error(`signed-tree-has-duplicate-path:${files[index].relative}`);
        }
    }
    return files;
};

/*
 * Signed digest v1: sha256 over the lines `<sha256 hex of file> <relative path>\n`
 * (UTF-8, sorted as above), as `sha256:<hex>`. The line list is exactly what
 * `sha256sum` prints, so a reviewer can reproduce it by hand.
 */
const computeSignedDigestDetailed = (dirPath) => {
    const files = collectSignedFiles(dirPath);
    const lines = files.map((file) => {
        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(file.absolute)).digest('hex');
        return `${fileHash} ${file.relative}\n`;
    });
    const digest = crypto.createHash('sha256').update(lines.join(''), 'utf8').digest('hex');
    return { digest: `sha256:${digest}`, lines };
};

/** The signed digest of a mod directory, or null when it cannot be computed. */
const computeSignedDigest = (dirPath) => {
    try {
        return computeSignedDigestDetailed(dirPath).digest;
    } catch {
        return null;
    }
};

const isSingleLine = (value, maxLength) => (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\r\n]/.test(value)
);

/*
 * The exact bytes that get signed. A fixed line format rather than JSON, so
 * the signer and the verifier cannot disagree about key order or escaping.
 */
const buildSignedMessage = ({ modId, modVersion, digest, keyId, signedAt }) => Buffer.from([
    `${SIGNATURE_FORMAT}/${SIGNATURE_VERSION}`,
    `modId=${modId}`,
    `modVersion=${modVersion}`,
    `digest=${digest}`,
    `keyId=${keyId}`,
    `signedAt=${signedAt}`,
    '',
].join('\n'), 'utf8');

/** Checks the signature file's shape; returns the record or null. */
const parseSignatureRecord = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { format, version, modId, modVersion, digest, keyId, signedAt, signature } = raw;
    if (format !== SIGNATURE_FORMAT || version !== SIGNATURE_VERSION) return null;
    if (!isSingleLine(modId, 64) || !MOD_ID_PATTERN.test(modId)) return null;
    if (!isSingleLine(modVersion, 64)) return null;
    if (!isSingleLine(digest, 80) || !DIGEST_PATTERN.test(digest)) return null;
    if (!isSingleLine(keyId, 64) || !KEY_ID_PATTERN.test(keyId)) return null;
    if (!isSingleLine(signedAt, 64) || Number.isNaN(Date.parse(signedAt))) return null;
    if (!isSingleLine(signature, 200)) return null;
    return { modId, modVersion, digest, keyId, signedAt, signature };
};

// Keyed by the key entry itself, so a different entry reusing a key id never gets a stale key.
const publicKeyCache = new WeakMap();

const publicKeyFor = (key) => {
    let publicKey = publicKeyCache.get(key);
    if (!publicKey) {
        publicKey = crypto.createPublicKey({ key: key.publicKey, format: 'jwk' });
        publicKeyCache.set(key, publicKey);
    }
    return publicKey;
};

const invalid = (reason, extra = {}) => ({ status: 'invalid', reason, ...extra });

// The status a valid signature reports, by the signing key's `channel`. A key
// without one is a release key. Any other channel is not one this host knows,
// so its signatures show as invalid (`unknown-key`) instead of falling back to
// officially verified.
const CHANNEL_STATUS = Object.freeze({ release: 'verified', beta: 'beta' });

/*
 * Verifies a mod directory's signature against the host's trusted keys.
 * `manifest` is the validated manifest; the signature must name the same id
 * and version. Returns `{ status, reason?, keyId?, keyLabel?, signedAt? }`.
 * `options` overrides the key list and revocations (tests only).
 */
const verifyModSignature = (dirPath, manifest, options = {}) => {
    const keys = options.keys ?? TRUSTED_SIGNING_KEYS;
    const revokedDigests = options.revokedDigests ?? REVOKED_MOD_DIGESTS;
    const signaturePath = path.join(dirPath, SIGNATURE_FILE);

    let rawText;
    try {
        const stat = fs.lstatSync(signaturePath);
        if (!stat.isFile()) return invalid('malformed');
        if (stat.size > SIGNATURE_FILE_MAX_BYTES) return invalid('malformed');
        rawText = fs.readFileSync(signaturePath, 'utf8');
    } catch (error) {
        return error && error.code === 'ENOENT' ? { status: 'unsigned' } : invalid('malformed');
    }

    let record;
    try {
        record = parseSignatureRecord(JSON.parse(rawText));
    } catch {
        record = null;
    }
    if (!record) return invalid('malformed');

    const base = { keyId: record.keyId, signedAt: record.signedAt };
    const key = keys.find((candidate) => candidate.keyId === record.keyId);
    if (!key) return invalid('unknown-key', base);
    // Only an absent channel means release; null, '' or anything unlisted is unknown.
    const channel = key.channel === undefined ? 'release' : key.channel;
    if (!Object.hasOwn(CHANNEL_STATUS, channel)) return invalid('unknown-key', base);
    const withKey = { ...base, keyLabel: key.label ?? null };
    if (key.revoked) return invalid('revoked-key', withKey);
    if (record.modId !== manifest?.id || record.modVersion !== manifest?.version) {
        return invalid('mod-mismatch', withKey);
    }

    let signatureValid = false;
    try {
        signatureValid = crypto.verify(
            null,
            buildSignedMessage(record),
            publicKeyFor(key),
            Buffer.from(record.signature, 'base64'),
        );
    } catch {
        signatureValid = false;
    }
    if (!signatureValid) return invalid('bad-signature', withKey);

    // Only now is the digest in the record known to be one the key signed.
    const actual = computeSignedDigest(dirPath);
    if (!actual) return invalid('unverifiable', withKey);
    if (actual !== record.digest) return invalid('digest-mismatch', withKey);
    if (revokedDigests.includes(actual)) return invalid('revoked-mod', withKey);
    return { status: CHANNEL_STATUS[channel], ...withKey };
};

module.exports = {
    CHANNEL_STATUS,
    SIGNATURE_FILE,
    SIGNATURE_FORMAT,
    SIGNATURE_VERSION,
    IGNORED_FILE_NAMES,
    buildSignedMessage,
    computeSignedDigest,
    computeSignedDigestDetailed,
    parseSignatureRecord,
    verifyModSignature,
};
