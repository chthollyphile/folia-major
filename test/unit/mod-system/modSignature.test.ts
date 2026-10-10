import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSignature.test.ts
// Official mod signatures. The vector here is shared with the folium-compound
// signing tools (test/signing.test.mjs there): the signed digest and the signed
// message must match byte for byte, or signatures made there fail here. Also
// pins that the key built into the host verifies a mod signed with it, and that
// the loader carries the signature state into the confirm dialog and the list.
//
// TEST_KEY is a test-only key ("folium-test-vector"), in no trusted key list.

const require = createRequire(import.meta.url);

const VECTOR_DIGEST = 'sha256:954b2e8f88ba256336eebe96506da418cdd089553b1cc3f1e460dcf467d373eb';
const TEST_KEY = {
    keyId: 'folium-test-vector',
    publicKey: { kty: 'OKP', crv: 'Ed25519', x: 'eFPb57OC44VB-NMjj74WnUVLARt7gz38aBcXpykspvE' },
    privateKey: { kty: 'OKP', crv: 'Ed25519', x: 'eFPb57OC44VB-NMjj74WnUVLARt7gz38aBcXpykspvE', d: 'CmEPWKhK8Rtwoh4xPYIMdKzUh34cc1pJhKqPFaOCWJI' },
};
const VECTOR_FIELDS = {
    modId: 'vector',
    modVersion: '1.0.0',
    digest: VECTOR_DIGEST,
    keyId: 'folium-test-vector',
    signedAt: '2026-01-01T00:00:00.000Z',
};
const VECTOR_SIGNATURE = 'PoZgJ8TJCS17TyAV2UizP6m7JZSt8KeCzB9TPXgYwffq3w9kT5PvJPu3S0sUF1tviFA4fA4LphBDzu00K9VcAA==';
const TEST_KEYS = [{ keyId: TEST_KEY.keyId, label: 'Test', publicKey: TEST_KEY.publicKey, revoked: false }];
const VECTOR_MANIFEST = { id: 'vector', version: '1.0.0' };
const OFFICIAL_FIXTURE = path.resolve(__dirname, '../../fixtures/folium-signature/official-fixture');

// Electron is replaced before the loader is required (see modSystemFileGrants.test.ts).
let dialogDetails: string[] = [];
const persisted = new Map<string, unknown>();
class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}
const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron', {
    dialog: {
        showMessageBox: async (...args: unknown[]) => {
            const options = args[args.length - 1] as { detail: string };
            dialogDetails.push(options.detail);
            return { response: 0 };
        },
    },
    ipcMain: { handle: () => {}, removeHandler: () => {} },
    protocol: { handle: () => {} },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const {
    SIGNATURE_FILE,
    buildSignedMessage,
    computeSignedDigest,
    computeSignedDigestDetailed,
    verifyModSignature,
} = require('../../../electron/modSystem/modSignature.cjs');
const { TRUSTED_SIGNING_KEYS } = require('../../../electron/modSystem/trustedKeys.cjs');
const { createModSystem } = require('../../../electron/modSystem/modSystem.cjs');

const tempDirs: string[] = [];
const tempDir = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
};

/*
 * The shared vector tree: code-unit order (B before a), CRLF bytes kept as is,
 * an NFD file name hashed as NFC, and skipped files (OS clutter, the signature).
 */
const writeVectorTree = () => {
    const dir = tempDir('folium-vector-');
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'mod.json'), '{"folium":1,"id":"vector","name":"Vector","version":"1.0.0","client":"client.mjs"}\n');
    fs.writeFileSync(path.join(dir, 'client.mjs'), 'export default function activate() {}\n');
    fs.writeFileSync(path.join(dir, 'B.txt'), 'upper\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'lower\n');
    fs.writeFileSync(path.join(dir, 'lib', 'crlf.txt'), 'crlf\r\nline\r\n');
    fs.writeFileSync(path.join(dir, 'lib', 'café.mjs'), 'nfd\n');
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk');
    fs.writeFileSync(path.join(dir, 'lib', 'Thumbs.db'), 'junk');
    fs.writeFileSync(path.join(dir, SIGNATURE_FILE), '{}');
    return dir;
};

const writeSignature = (dir: string, fields: typeof VECTOR_FIELDS) => {
    const privateKey = crypto.createPrivateKey({ key: TEST_KEY.privateKey, format: 'jwk' });
    const signature = crypto.sign(null, buildSignedMessage(fields), privateKey).toString('base64');
    fs.writeFileSync(path.join(dir, SIGNATURE_FILE), JSON.stringify({ format: 'folium-signature', version: 1, ...fields, signature }));
};

const signedVectorTree = () => {
    const dir = writeVectorTree();
    writeSignature(dir, VECTOR_FIELDS);
    return dir;
};

afterEach(() => {
    tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('signed digest and message (shared vector)', () => {
    it('matches the vector digest and covers exactly the expected files', () => {
        const { digest, lines } = computeSignedDigestDetailed(writeVectorTree());
        expect(digest).toBe(VECTOR_DIGEST);
        expect(lines.map((line: string) => line.slice(65, -1))).toEqual(['B.txt', 'a.txt', 'client.mjs', 'lib/café.mjs', 'lib/crlf.txt', 'mod.json']);
    });

    it('builds the vector message and reproduces the vector signature', () => {
        expect(buildSignedMessage(VECTOR_FIELDS).toString('utf8')).toBe([
            'folium-signature/1',
            'modId=vector',
            'modVersion=1.0.0',
            `digest=${VECTOR_DIGEST}`,
            'keyId=folium-test-vector',
            'signedAt=2026-01-01T00:00:00.000Z',
            '',
        ].join('\n'));
        const privateKey = crypto.createPrivateKey({ key: TEST_KEY.privateKey, format: 'jwk' });
        expect(crypto.sign(null, buildSignedMessage(VECTOR_FIELDS), privateKey).toString('base64')).toBe(VECTOR_SIGNATURE);
    });

    // Windows 非管理员/未开开发者模式时没有创建 symlink 的权限（EPERM），前提不成立：
    // 建不出链接就无从断言「含链接的树不可哈希」，只能跳过而不是假装通过。
    // 建链接需要 symlink 权限：Windows 未提权/未开开发者模式时 symlinkSync 会 EPERM，
    // 前提不成立就只能跳过，不能当成通过。
    const lacksSymlinkPrivilege = () => {
        try {
            const probe = path.join(os.tmpdir(), `folia-symlink-probe-${process.pid}`);
            fs.symlinkSync('probe-target.mjs', probe);
            fs.rmSync(probe, { force: true });
            return false;
        } catch {
            return true;
        }
    };
    it.skipIf(lacksSymlinkPrivilege())('refuses trees that cannot hash the same on every machine', () => {
        const dir = writeVectorTree();
        fs.symlinkSync('client.mjs', path.join(dir, 'link.mjs'));
        expect(computeSignedDigest(dir)).toBeNull();
    });
});

describe('verifyModSignature', () => {
    it('verifies a signed tree, and ignores OS clutter added afterwards', () => {
        const dir = signedVectorTree();
        expect(verifyModSignature(dir, VECTOR_MANIFEST, { keys: TEST_KEYS })).toEqual({
            status: 'verified', keyId: TEST_KEY.keyId, keyLabel: 'Test', signedAt: VECTOR_FIELDS.signedAt,
        });
        fs.writeFileSync(path.join(dir, 'lib', '.DS_Store'), 'more junk');
        expect(verifyModSignature(dir, VECTOR_MANIFEST, { keys: TEST_KEYS }).status).toBe('verified');
    });

    it('reports an unsigned mod as unsigned', () => {
        const dir = writeVectorTree();
        fs.rmSync(path.join(dir, SIGNATURE_FILE));
        expect(verifyModSignature(dir, VECTOR_MANIFEST, { keys: TEST_KEYS })).toEqual({ status: 'unsigned' });
    });

    it('marks every kind of broken signature invalid, with the reason', () => {
        const reasonFor = (dir: string, options: Record<string, unknown> = {}, manifest = VECTOR_MANIFEST) => (
            verifyModSignature(dir, manifest, { keys: TEST_KEYS, ...options }).reason
        );

        const edited = signedVectorTree();
        fs.appendFileSync(path.join(edited, 'client.mjs'), '// changed\n');
        expect(reasonFor(edited)).toBe('digest-mismatch');

        const signed = signedVectorTree();
        expect(reasonFor(signed, {}, { id: 'vector', version: '1.0.1' })).toBe('mod-mismatch');
        expect(reasonFor(signed, {}, { id: 'other', version: '1.0.0' })).toBe('mod-mismatch');
        expect(reasonFor(signed, { keys: [] })).toBe('unknown-key');
        expect(reasonFor(signed, { keys: [{ ...TEST_KEYS[0], revoked: true }] })).toBe('revoked-key');
        expect(reasonFor(signed, { revokedDigests: [VECTOR_DIGEST] })).toBe('revoked-mod');
        const otherKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
        expect(reasonFor(signed, { keys: [{ ...TEST_KEYS[0], publicKey: otherKey }] })).toBe('bad-signature');

        // A digest the key never signed: the record is rejected before the tree is even hashed.
        const forged = writeVectorTree();
        writeSignature(forged, VECTOR_FIELDS);
        const record = JSON.parse(fs.readFileSync(path.join(forged, SIGNATURE_FILE), 'utf8'));
        fs.writeFileSync(path.join(forged, SIGNATURE_FILE), JSON.stringify({ ...record, digest: `sha256:${'0'.repeat(64)}` }));
        expect(reasonFor(forged)).toBe('bad-signature');

        const malformed = writeVectorTree();
        fs.writeFileSync(path.join(malformed, SIGNATURE_FILE), 'not json');
        expect(reasonFor(malformed)).toBe('malformed');
        fs.writeFileSync(path.join(malformed, SIGNATURE_FILE), JSON.stringify({ ...record, signedAt: 'x\nkeyId=evil' }));
        expect(reasonFor(malformed)).toBe('malformed');
    });

    it('verifies a mod signed with the official key built into the host', () => {
        expect(TRUSTED_SIGNING_KEYS.length).toBeGreaterThan(0);
        TRUSTED_SIGNING_KEYS.forEach((key: { publicKey: Record<string, unknown> }) => expect(key.publicKey.d).toBeUndefined());
        expect(verifyModSignature(OFFICIAL_FIXTURE, { id: 'signature-fixture', version: '1.0.0' })).toMatchObject({
            status: 'verified',
            keyId: 'folium-2026-1',
        });
    });
});

describe('loader integration', () => {
    let root = '';

    beforeEach(() => {
        root = tempDir('folium-loader-');
        persisted.clear();
        dialogDetails = [];
    });

    const writeMod = (source: string) => {
        const target = path.join(root, 'app', 'mods', path.basename(source));
        fs.cpSync(source, target, { recursive: true });
        return target;
    };

    const launch = () => {
        const system = createModSystem({
            app: {
                getPath: () => path.join(root, 'userData'),
                getAppPath: () => path.join(root, 'app'),
                getVersion: () => '0.8.0',
                isPackaged: false,
            },
            BrowserWindow: { getAllWindows: () => [] },
            getMainWindow: () => null,
            getLocaleKey: () => 'en',
            isFeatureEnabled: () => true,
        });
        system.loadAll();
        return system;
    };

    it('lists the signature state and shows it in the enable confirmation', async () => {
        writeMod(OFFICIAL_FIXTURE);
        const tampered = writeMod(signedVectorTree());
        fs.renameSync(tampered, path.join(root, 'app', 'mods', 'vector'));
        const unsigned = path.join(root, 'app', 'mods', 'plain');
        fs.mkdirSync(unsigned);
        fs.writeFileSync(path.join(unsigned, 'mod.json'), JSON.stringify({ folium: 1, id: 'plain', name: 'Plain', version: '1.0.0', client: 'client.mjs' }));
        fs.writeFileSync(path.join(unsigned, 'client.mjs'), 'export default function activate() {}\n');

        const system = launch();
        const byId = Object.fromEntries(system.listMods().map((mod: { id: string }) => [mod.id, mod]));
        expect(byId['signature-fixture'].signature).toEqual({
            status: 'verified', reason: null, keyId: 'folium-2026-1', keyLabel: 'Folium official', signedAt: expect.any(String),
        });
        // Signed with the test key, which the host does not trust.
        expect(byId.vector.signature).toMatchObject({ status: 'invalid', reason: 'unknown-key' });
        expect(byId.plain.signature).toEqual({ status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null });

        // The label never enables anything: every mod still goes through the (declined) confirmation.
        for (const modId of ['signature-fixture', 'vector', 'plain']) {
            expect((await system.setModEnabled(modId, true)).error).toBe('enable-declined');
        }
        expect(dialogDetails[0]).toContain('Signature: officially verified (Folium official, folium-2026-1)');
        expect(dialogDetails[0]).toContain('reviewed by Folium');
        expect(dialogDetails[1]).toContain('Signature: does not match (unknown-key)');
        expect(dialogDetails[1]).toContain('not security-audited');
        expect(dialogDetails[2]).toContain('Signature: none');
    });
});
