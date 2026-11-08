import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// 调试工具，用于获取解析流水线输出的歌词json
// 
// 用法：
// npm run manual:lyrics -- 2027067479
// 文件保存到 test/manual/lyric-output/2027067479.json 

// 从项目的 .env.local 中加载环境变量
const loadEnvLocal = () => {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        return;
    }
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) {
            return;
        }
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }
        if (key && !(key in process.env)) {
            process.env[key] = value;
        }
    });
};
loadEnvLocal();
import { neteaseApi } from '../../src/services/onlineMusic/netease/netease';
import type { LyricData } from '../../src/types';
import { applyDetectedChorusEffects } from '../../src/utils/lyrics/chorusEffects';
import { detectTimedLyricFormat } from '../../src/utils/lyrics/formatDetection';
import { resolveLyricProcessingOptions } from '../../src/utils/lyrics/filtering';
import { applyLyricLineRules, compileLyricLineRules } from '../../src/utils/lyrics/lyricLineRules';
import { extractNeteaseLyricPayload } from '../../src/utils/lyrics/neteaseProcessing';
import { parseLyricsByFormat } from '../../src/utils/lyrics/parserCore';
import type { LyricParseFormat } from '../../src/utils/lyrics/parserCore';
import type { LyricProcessingOptions, RawNeteaseLyric } from '../../src/utils/lyrics/types';

// Manual CLI for fetching a Netease lyric payload by song id and parsing it with the app lyric pipeline.

interface CliOptions {
    songId: number;
    apiBase?: string;
    includeInterludes?: boolean;
    filterPattern?: string;
    outputPath?: string;
}

interface ParsedCliArgs {
    options?: CliOptions;
    shouldShowHelp: boolean;
}

const usage = `Usage:
  npx tsx test/manual/netease_lyrics_cli.ts <songId> [options]
  npm run manual:lyrics -- <songId> [options]

Options:
  --api-base <url>          Override VITE_NETEASE_API_BASE for this run.
  --include-interludes      Keep parser-generated interlude lines.
  --filter-pattern <regex>  Apply the same lyric display filter used by the app.
  --out <path>              Write parsed lyric JSON to a file instead of stdout.
  -h, --help                Show this help.
`;

const readValue = (args: string[], index: number, optionName: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${optionName} requires a value.`);
    }
    return value;
};

const parseSongId = (value: string | undefined): number => {
    const songId = Number(value);
    if (!Number.isInteger(songId) || songId <= 0) {
        throw new Error('songId must be a positive integer.');
    }
    return songId;
};

const parseArgs = (args: string[]): ParsedCliArgs => {
    if (args.includes('-h') || args.includes('--help')) {
        return { shouldShowHelp: true };
    }

    const positional: string[] = [];
    const options: Partial<CliOptions> = {};

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        switch (arg) {
            case '--api-base':
                options.apiBase = readValue(args, index, arg);
                index += 1;
                break;
            case '--include-interludes':
                options.includeInterludes = true;
                break;
            case '--filter-pattern':
                options.filterPattern = readValue(args, index, arg);
                index += 1;
                break;
            case '--out':
                options.outputPath = readValue(args, index, arg);
                index += 1;
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`Unknown option: ${arg}`);
                }
                positional.push(arg);
                break;
        }
    }

    if (positional.length !== 1) {
        throw new Error('Expected exactly one songId.');
    }

    return {
        options: {
            songId: parseSongId(positional[0]),
            ...options,
        },
        shouldShowHelp: false,
    };
};

const parseNeteaseLyricsForCli = (
    source: RawNeteaseLyric,
    options: LyricProcessingOptions & { filterPattern?: string }
): LyricData | null => {
    const payload = extractNeteaseLyricPayload(source);
    const primaryLyrics = payload.yrcLrc || payload.mainLrc;

    if (!primaryLyrics || payload.isPureMusic) {
        return null;
    }

    const resolvedOptions = resolveLyricProcessingOptions(options);
    const format: LyricParseFormat = payload.yrcLrc
        ? 'yrc'
        : detectTimedLyricFormat(payload.mainLrc || primaryLyrics);

    let lyrics = parseLyricsByFormat(
        format,
        primaryLyrics,
        payload.transLrc || '',
        resolvedOptions
    );

    if (lyrics && payload.mainLrc) {
        lyrics = applyDetectedChorusEffects(lyrics, payload.mainLrc);
    }

    const rules = options.filterPattern ? [{ id: 'cli', on: true, shape: 'written' as const, text: options.filterPattern }] : [];
    return applyLyricLineRules(lyrics, compileLyricLineRules(rules));
};

const main = async () => {
    const { options, shouldShowHelp } = parseArgs(process.argv.slice(2));

    if (shouldShowHelp) {
        console.log(usage);
        return;
    }

    if (!options) {
        throw new Error('Missing CLI options.');
    }

    if (options.apiBase) {
        process.env.VITE_NETEASE_API_BASE = options.apiBase;
    }

    const rawPayload = await neteaseApi.getLyric(options.songId);
    const lyricSource = neteaseApi.getProcessedLyricPayload(rawPayload);
    const lyrics = parseNeteaseLyricsForCli(lyricSource, {
        includeInterludes: options.includeInterludes,
        filterPattern: options.filterPattern,
    });
    const json = `${JSON.stringify(lyrics, null, 2)}\n`;

    const finalOutputPath = options.outputPath || path.resolve(process.cwd(), 'test/manual/lyric-output', `${options.songId}.json`);
    const outputDir = path.dirname(finalOutputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(finalOutputPath, json, 'utf8');
    console.error(`Wrote parsed lyrics to ${finalOutputPath}`);
};

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    console.error('');
    console.error(usage);
    process.exitCode = 1;
});
