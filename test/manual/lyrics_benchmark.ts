import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { detectTimedLyricFormat } from '../../src/utils/lyrics/formatDetection';
import { parseLyricsByFormat } from '../../src/utils/lyrics/parserCore';
import { splitCombinedTimeline } from '../../src/utils/lyrics/timelineSplitter';

interface BenchmarkCase {
    name: string;
    iterations: number;
    run: () => void;
}

interface BenchmarkStats {
    name: string;
    iterations: number;
    totalMs: number;
    meanMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, '..', '..');
const fixtureDir = path.join(repoRoot, 'test', 'test-song', 'test-lyric');

const readFixture = (filename: string) => {
    return fs.readFileSync(path.join(fixtureDir, filename), 'utf8');
};

const benchmark = (testCase: BenchmarkCase): BenchmarkStats => {
    for (let index = 0; index < 25; index += 1) {
        testCase.run();
    }

    const samples: number[] = [];
    const startedAt = performance.now();

    for (let index = 0; index < testCase.iterations; index += 1) {
        const started = performance.now();
        testCase.run();
        samples.push(performance.now() - started);
    }

    samples.sort((left, right) => left - right);

    return {
        name: testCase.name,
        iterations: testCase.iterations,
        totalMs: performance.now() - startedAt,
        meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
        p95Ms: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))],
        minMs: samples[0],
        maxMs: samples[samples.length - 1]
    };
};

const formatMs = (value: number) => value.toFixed(3).padStart(8, ' ');

const buildSyntheticLrc = (lineCount: number) => {
    const mainLines: string[] = [];
    const transLines: string[] = [];
    let currentTimeMs = 0;

    for (let index = 0; index < lineCount; index += 1) {
        const minute = Math.floor(currentTimeMs / 60000).toString().padStart(2, '0');
        const second = Math.floor((currentTimeMs % 60000) / 1000).toString().padStart(2, '0');
        const fraction = (currentTimeMs % 1000).toString().padStart(3, '0');
        const timestamp = `[${minute}:${second}.${fraction}]`;

        mainLines.push(`${timestamp}Synthetic lyric line ${index} with some repeated words for timing`);
        transLines.push(`${timestamp}Synthetic translation line ${index} for alignment testing`);
        currentTimeMs += 1200;
    }

    return {
        main: mainLines.join('\n'),
        trans: transLines.join('\n')
    };
};

const runCombinedPipeline = (content: string) => {
    const { main, trans } = splitCombinedTimeline(content);
    return parseLyricsByFormat(detectTimedLyricFormat(main), main, trans);
};

const fixtures = {
    lineLevelCombined: readFixture('＊菜乃 - ハロ／ハワユ (39676021)-逐行lrc.lrc'),
    normalLrc: readFixture('＊菜乃 - ハロ／ハワユ (39676021)-lrc-normal.lrc'),
    bracketEnhanced: readFixture('＊菜乃 - ハロ／ハワユ (39676021)-逐字lrc-format1.lrc'),
    angleEnhanced: readFixture('＊菜乃 - ハロ／ハワユ (39676021)-eslyric-format2.lrc')
};

const synthetic = buildSyntheticLrc(5000);

const cases: BenchmarkCase[] = [
    {
        name: 'real.normal-lrc',
        iterations: 400,
        run: () => {
            parseLyricsByFormat(
                detectTimedLyricFormat(fixtures.normalLrc),
                fixtures.normalLrc,
                ''
            );
        }
    },
    {
        name: 'real.line-level-combined',
        iterations: 300,
        run: () => {
            runCombinedPipeline(fixtures.lineLevelCombined);
        }
    },
    {
        name: 'real.bracket-enhanced-combined',
        iterations: 250,
        run: () => {
            runCombinedPipeline(fixtures.bracketEnhanced);
        }
    },
    {
        name: 'real.angle-enhanced-combined',
        iterations: 250,
        run: () => {
            runCombinedPipeline(fixtures.angleEnhanced);
        }
    },
    {
        name: 'synthetic.lrc-with-translation-5000',
        iterations: 40,
        run: () => {
            parseLyricsByFormat('lrc', synthetic.main, synthetic.trans);
        }
    }
];

const results = cases.map(benchmark);

console.log('Lyrics benchmark results');
console.log('case'.padEnd(34), 'iter'.padStart(6), 'mean'.padStart(10), 'p95'.padStart(10), 'min'.padStart(10), 'max'.padStart(10), 'total'.padStart(10));
for (const result of results) {
    console.log(
        result.name.padEnd(34),
        String(result.iterations).padStart(6),
        formatMs(result.meanMs),
        formatMs(result.p95Ms),
        formatMs(result.minMs),
        formatMs(result.maxMs),
        formatMs(result.totalMs)
    );
}
