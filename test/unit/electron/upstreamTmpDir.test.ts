import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// test/unit/electron/upstreamTmpDir.test.ts
// 上游包的临时目录怎么定（#1304：/tmp 全机共有，别的用户的文件读不出也盖不掉）。指不成时退回系统临时目录。

const require = createRequire(import.meta.url);
const { resolveUpstreamTmpDir } = require('../../../electron/netease/upstreamTmpDir.cjs') as {
    resolveUpstreamTmpDir: (options: {
        requestedDir?: string;
        systemTmpDir: string;
        ensureDirectory: (dir: string) => void;
    }) => { dir: string; fallback: string | null };
};

describe('upstream tmp dir', () => {
    it('uses the per-user dir when it can be created', () => {
        const created: string[] = [];
        const result = resolveUpstreamTmpDir({
            requestedDir: '/home/someone/.config/Folia/netease-api-tmp',
            systemTmpDir: '/tmp',
            ensureDirectory: (dir) => { created.push(dir); },
        });

        expect(result).toEqual({ dir: '/home/someone/.config/Folia/netease-api-tmp', fallback: null });
        expect(created).toEqual(['/home/someone/.config/Folia/netease-api-tmp']);
    });

    it('falls back to the system tmp dir when the per-user dir cannot be created', () => {
        const result = resolveUpstreamTmpDir({
            requestedDir: '/home/someone/.config/Folia/netease-api-tmp',
            systemTmpDir: '/tmp',
            ensureDirectory: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); },
        });

        expect(result.dir).toBe('/tmp');
        expect(result.fallback).toContain('netease-api-tmp');
        expect(result.fallback).toContain('EACCES');
    });

    it('stays on the system tmp dir when the main process did not pass a per-user dir', () => {
        const result = resolveUpstreamTmpDir({
            systemTmpDir: '/tmp',
            ensureDirectory: () => { throw new Error('must not be called'); },
        });

        expect(result).toEqual({ dir: '/tmp', fallback: 'not requested' });
    });

    // 上游在首次 require 时就按 os.tmpdir() 算出 anonymous_token 等文件的路径，替换必须赶在这之前。
    it('patches os.tmpdir in the worker before the upstream package is loaded', () => {
        const worker = readFileSync(new URL('../../../electron/netease/neteaseApiWorker.cjs', import.meta.url), 'utf8');
        const patchedAt = worker.indexOf('os.tmpdir = () => upstreamTmp.dir;');
        expect(patchedAt).toBeGreaterThan(-1);
        expect(patchedAt).toBeLessThan(worker.indexOf('upstream = loadUpstream();'));
    });
});
