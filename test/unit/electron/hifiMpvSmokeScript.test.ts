import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 钉住 test/manual/hifiMpvSmoke.mjs 在 pactl 的列表里认 mpv 那路流的办法：按 mpv 起的时候用的 --audio-client-name
// （mpvArgs.cjs 的 AUDIO_CLIENT_NAME），不按字面的 "mpv"。脚本本身要真的 mpv，不能在这里跑：
// 那个函数从源码里原样取出来，把它用到的名字当参数传进去执行。

const require = createRequire(import.meta.url);
const { AUDIO_CLIENT_NAME } = require('../../../electron/hifi/mpvArgs.cjs') as { AUDIO_CLIENT_NAME: string };

const rootDir = path.resolve(__dirname, '../../../');
const smoke = readFileSync(path.join(rootDir, 'test/manual/hifiMpvSmoke.mjs'), 'utf8');
const sinkInputsBody = smoke.match(/const mpvSinkInputs = \(\) => \{\n([\s\S]*?)\n\};\n/)?.[1] ?? '';

type SpawnSync = (file: string, args: string[], options: Record<string, unknown>) => { status: number | null; stdout: unknown };

const compileSinkInputs = (spawnSync: SpawnSync) => new Function(
    'spawnSync',
    'AUDIO_CLIENT_NAME',
    `return () => {\n${sinkInputsBody}\n};`,
)(spawnSync, AUDIO_CLIENT_NAME) as () => string[] | null;

/** pactl list sink-inputs 的两块：Folia 起的 mpv，和用户自己开的另一个 mpv。 */
const PACTL_OUTPUT = [
    'Sink Input #101',
    '\tDriver: PipeWire',
    '\tProperties:',
    `\t\tapplication.name = "${AUDIO_CLIENT_NAME}"`,
    '\t\tnode.name = "Folia HiFi"',
    '',
    'Sink Input #102',
    '\tDriver: PipeWire',
    '\tProperties:',
    '\t\tapplication.name = "mpv"',
    '\t\tmedia.name = "movie.mkv - mpv"',
    '',
].join('\n');

describe('hifiMpvSmoke.mjs: finding mpv\'s stream in pactl', () => {
    it('takes AUDIO_CLIENT_NAME from mpvArgs.cjs', () => {
        expect(AUDIO_CLIENT_NAME).toBe('Folia HiFi');
        expect(smoke).toContain('const { AUDIO_CLIENT_NAME } = require(\'../../electron/hifi/mpvArgs.cjs\');');
        expect(sinkInputsBody).not.toBe('');
    });

    it('keeps the stream named by --audio-client-name and leaves out another mpv', () => {
        const calls: Array<[string, string[]]> = [];
        const sinkInputs = compileSinkInputs((file, args) => {
            calls.push([file, args]);
            return { status: 0, stdout: PACTL_OUTPUT };
        });
        const blocks = sinkInputs();
        expect(calls).toEqual([['pactl', ['list', 'sink-inputs']]]);
        expect(blocks).toHaveLength(1);
        expect(blocks?.[0]).toContain(`application.name = "${AUDIO_CLIENT_NAME}"`);
        expect(blocks?.[0]).not.toContain('movie.mkv');
    });

    it('is null without pactl', () => {
        expect(compileSinkInputs(() => ({ status: null, stdout: null }))()).toBeNull();
    });
});
