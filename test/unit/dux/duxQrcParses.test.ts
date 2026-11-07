import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseQRC } from '../../../src/utils/lyrics/parserCore';

// Dux 的逐字歌词先经过 QRC 文本，再交给 Folia 自己的 QRC 解析器；这个测试保证两边的时间格式对得上。

const require = createRequire(import.meta.url);
const { buildDuxLyricPayload } = require('../../../electron/dux/qrcLyrics.cjs') as {
    buildDuxLyricPayload: (result: unknown) => { karaokeLyric: string | null } | null;
};

describe('Dux QRC payload', () => {
    it('parses into word-timed lines with spaces preserved', () => {
        const payload = buildDuxLyricPayload({
            found: true,
            synced: [
                {
                    t: 0.79,
                    e: 4.451,
                    x: "Lately I've been",
                    w: [
                        { t: 0.79, e: 1.072, x: 'Lately ' },
                        { t: 1.072, e: 1.862, x: "I've " },
                        { t: 1.862, e: 2.395, x: 'been' },
                    ],
                },
            ],
        });
        expect(payload?.karaokeLyric).toBe("[790,3661](790,282)Lately (1072,790)I've (1862,533)been");
        const parsed = parseQRC(payload!.karaokeLyric!);
        expect(parsed.lines).toHaveLength(1);
        expect(parsed.lines[0].fullText).toBe("Lately I've been");
        expect(parsed.lines[0].words.map(word => word.text)).toEqual(['Lately ', "I've ", 'been']);
    });
});
