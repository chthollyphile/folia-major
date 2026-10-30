import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bundleFiles, buildStrokeData, CHANGE_NOTICE, nebbiaStrokesPlugin, readCache } from '../../../dev/nebbia/nebbiaStrokesPlugin.mjs';

// test/unit/visualizer/nebbiaStrokesPlugin.test.ts
// 构建时从 AnimCJK graphics 数据抽笔画中线：y 翻成向下、丢掉方格外的辅助笔画、同一个字先出现的文件优先；
// 产物里 JSON 自带修改说明、附 NOTICE 和授权原文（APL 第 2(a) 条）；坏了的缓存不拿来用；
// 开发服务器的中间件只接这几个文件，别的请求（包括坏的百分号编码）原样放过、不触发下载。

const line = (character: string, medians: [number, number][][]) => JSON.stringify({ character, strokes: ['M0,0'], medians });

describe('buildStrokeData', () => {
    it('keeps only the medians, with y pointing down from the 900 baseline', () => {
        const data = buildStrokeData([line('一', [[[100, 400], [900, 400]]])]);
        expect(data).toEqual({ 一: [[[100, 500], [900, 500]]] });
    });

    it('drops strokes that leave the 1024 grid (kana animation helpers)', () => {
        const data = buildStrokeData([line('あ', [[[100, 400], [200, 400]], [[100, 400], [1100, 400]]])]);
        expect(data['あ']).toEqual([[[100, 500], [200, 500]]]);
    });

    it('lets the first file win when a character appears twice, and skips blank lines', () => {
        const data = buildStrokeData([
            `${line('中', [[[1, 900]]])}\n\n`,
            line('中', [[[2, 900]]]),
        ]);
        expect(data['中']).toEqual([[[1, 0]]]);
    });
});

describe('nebbiaStrokesPlugin dev middleware', () => {
    type Middleware = (req: { url?: string }, res: unknown, next: () => void) => Promise<void> | void;

    const middleware = () => {
        let handler: Middleware | undefined;
        const server = { config: { base: '/', logger: { warn: vi.fn() } }, middlewares: { use: (fn: Middleware) => { handler = fn; } } };
        (nebbiaStrokesPlugin() as unknown as { configureServer: (s: typeof server) => void }).configureServer(server);
        return handler!;
    };

    it('passes unrelated and malformed URLs on without throwing or downloading', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const handle = middleware();
        for (const url of ['/%', '/%E0%A4%A', '/index.html', '/licenses/other.txt']) {
            const next = vi.fn();
            await handle({ url }, {}, next);
            expect(next).toHaveBeenCalledTimes(1);
        }
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});

describe('bundleFiles', () => {
    it('puts the modification notice into the JSON and ships NOTICE and the license texts beside it', () => {
        const files = bundleFiles({
            strokes: { 一: [[[100, 500], [900, 500]]] },
            licenses: [['COPYING.txt', Buffer.from('copying')], ['ARPHICPL.TXT', Buffer.from('apl')]],
        });
        expect([...files.keys()].sort()).toEqual([
            'licenses/nebbia-strokes/ARPHICPL.TXT',
            'licenses/nebbia-strokes/COPYING.txt',
            'licenses/nebbia-strokes/NOTICE.txt',
            'nebbia-strokes.json',
        ]);
        const json = JSON.parse(files.get('nebbia-strokes.json')!.toString('utf8'));
        expect(json[' notice']).toBe(CHANGE_NOTICE);
        expect(json['一']).toEqual([[[100, 500], [900, 500]]]);
        expect(CHANGE_NOTICE).toMatch(/Modified on \d{4}-\d{2}-\d{2}/);
        expect(files.get('licenses/nebbia-strokes/NOTICE.txt')!.toString('utf8')).toContain(CHANGE_NOTICE);
        expect(files.get('licenses/nebbia-strokes/ARPHICPL.TXT')!.toString('utf8')).toBe('apl');
    });
});

describe('readCache', () => {
    const withCache = async (strokesJson: string, run: (dir: string) => Promise<void>) => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nebbia-strokes-cache-'));
        try {
            await fs.writeFile(path.join(dir, 'COPYING.txt'), 'copying');
            await fs.writeFile(path.join(dir, 'ARPHICPL.TXT'), 'apl');
            await fs.writeFile(path.join(dir, 'nebbia-strokes.json'), strokesJson);
            await run(dir);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    };

    it('uses a complete cache', () => withCache('{"一":[[[1,2]]]}', async (dir) => {
        expect((await readCache(dir))?.strokes).toEqual({ 一: [[[1, 2]]] });
    }));

    it('rejects a cache whose JSON was cut off half-written', () => withCache('{"一":[[[1,', async (dir) => {
        expect(await readCache(dir)).toBeNull();
    }));

    it('rejects a cache with a license text missing', () => withCache('{}', async (dir) => {
        await fs.rm(path.join(dir, 'ARPHICPL.TXT'));
        expect(await readCache(dir)).toBeNull();
    }));
});
