import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

type VisualizerMode = 'classic' | 'cadenza' | 'partita' | 'fume' | 'spatial';

interface VisualizerBenchmarkFixture {
    name: string;
    source: string;
    benchmarkWindow: {
        startSeconds: number;
        endSeconds: number;
        description: string;
    };
    lrc: string;
    tlyric: string;
}

interface BenchmarkOptions {
    mode: VisualizerMode;
    sampleIntervalMs: number;
    headless: boolean;
    speed: number;
}

interface MetricSample {
    sampledAtMs: number;
    elapsedMs: number;
    taskDurationSeconds: number;
    taskDurationDeltaSeconds: number;
    cpuBusyPercent: number;
    scriptDurationSeconds?: number;
    layoutDurationSeconds?: number;
    recalcStyleDurationSeconds?: number;
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    state?: unknown;
}

declare global {
    interface Window {
        __FOLIA_VISUALIZER_BENCHMARK_FIXTURE__?: VisualizerBenchmarkFixture;
        __foliaVisualizerBenchmark?: () => unknown;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDir, '..', '..');
const benchmarkPagePath = '/test/manual/visualizer-benchmark/index.html';
const visualizerModes = ['classic', 'cadenza', 'partita', 'fume', 'spatial'] as const satisfies readonly VisualizerMode[];
const validModes = new Set<VisualizerMode>(visualizerModes);

const parseArgs = (): BenchmarkOptions => {
    const args = process.argv.slice(2);
    const readOption = (name: string) => {
        const index = args.indexOf(name);
        if (index >= 0) {
            return args[index + 1];
        }

        const inline = args.find(arg => arg.startsWith(`${name}=`));
        return inline?.slice(name.length + 1);
    };

    const modeFromOption = readOption('--mode');
    const modeFromNpmConfig = process.env.npm_config_mode;
    const modeFromPosition = args.find(arg => validModes.has(arg as VisualizerMode));
    const mode = (modeFromOption || modeFromNpmConfig || modeFromPosition) as VisualizerMode | undefined;
    if (!mode || !validModes.has(mode)) {
        throw new Error(
            `Missing or invalid visualizer mode. Expected one of: ${Array.from(validModes).join(', ')}.\n` +
            'Examples:\n' +
            '  npm run benchmark:visualizer -- --mode classic\n' +
            '  npm run benchmark:visualizer -- --mode=classic\n' +
            '  npm run benchmark:visualizer -- classic'
        );
    }

    const sampleIntervalMs = Number(readOption('--sample-interval') ?? 250);
    const speed = Number(readOption('--speed') ?? 1);
    const headlessOption = readOption('--headless');

    return {
        mode,
        sampleIntervalMs: Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0 ? sampleIntervalMs : 250,
        headless: headlessOption === undefined ? true : headlessOption !== 'false',
        speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
    };
};

const getFreePort = () => new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
            server.close(() => reject(new Error('Could not allocate a TCP port')));
            return;
        }

        const port = address.port;
        server.close(() => resolve(port));
    });
});

const waitForServer = async (url: string, timeoutMs = 120_000) => {
    const startedAt = Date.now();
    let lastError: unknown;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
        } catch (error) {
            lastError = error;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for Vite server at ${url}. Last error: ${String(lastError)}`);
};

const startViteServer = async (port: number): Promise<ViteDevServer> => {
    process.env.VITE_NETEASE_API_BASE = `http://127.0.0.1:${port}/__visualizer_benchmark__`;
    const server = await createServer({
        root: repoRoot,
        configFile: path.join(repoRoot, 'vite.config.ts'),
        server: {
            host: '127.0.0.1',
            port,
            strictPort: true,
        },
    });
    await server.listen();
    await waitForServer(`http://127.0.0.1:${port}${benchmarkPagePath}`);
    return server;
};

const stopViteServer = async (server: ViteDevServer) => {
    await server.close();
};

const readFixture = (): VisualizerBenchmarkFixture => {
    const fixturePath = path.join(repoRoot, 'test', 'fixtures', 'visualizer', 'creditsEx_visualizerBenchmark.lyrics.json');
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as VisualizerBenchmarkFixture;
};

const getMetricValue = (metrics: Array<{ name: string; value: number }>, name: string) =>
    metrics.find(metric => metric.name === name)?.value;

const collectTrace = async (cdp: CDPSession, outputPath: string) => {
    const tracingComplete = new Promise<string>(resolve => {
        cdp.once('Tracing.tracingComplete', event => {
            resolve((event as { stream: string }).stream);
        });
    });

    await cdp.send('Tracing.end');
    const stream = await tracingComplete;
    const output = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    try {
        while (true) {
            const chunk = await cdp.send('IO.read', { handle: stream });
            if (chunk.data) {
                if (!output.write(chunk.data)) {
                    await new Promise<void>(resolve => output.once('drain', resolve));
                }
            }

            if (chunk.eof) {
                break;
            }
        }
    } finally {
        await cdp.send('IO.close', { handle: stream });
        await new Promise<void>((resolve, reject) => {
            output.end(error => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }
};

const summarizeSamples = (samples: MetricSample[]) => {
    const cpuSamples = samples.map(sample => sample.cpuBusyPercent).filter(value => Number.isFinite(value));
    const meanCpu = cpuSamples.reduce((sum, value) => sum + value, 0) / Math.max(cpuSamples.length, 1);
    const maxCpu = Math.max(...cpuSamples, 0);
    const sortedCpu = [...cpuSamples].sort((left, right) => left - right);
    const p95Cpu = sortedCpu[Math.min(sortedCpu.length - 1, Math.floor(sortedCpu.length * 0.95))] ?? 0;

    return {
        samples: samples.length,
        meanCpuBusyPercent: meanCpu,
        p95CpuBusyPercent: p95Cpu,
        maxCpuBusyPercent: maxCpu,
    };
};

const runBenchmark = async () => {
    const options = parseArgs();
    const fixture = readFixture();
    const port = await getFreePort();
    const outputDir = path.join(
        repoRoot,
        'test-results',
        'visualizer-benchmark',
        `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.mode}`,
    );
    fs.mkdirSync(outputDir, { recursive: true });

    const vite = await startViteServer(port);
    const browser = await chromium.launch({
        headless: options.headless,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    try {
        const page = await browser.newPage({
            viewport: { width: 3840, height: 2160 },
            deviceScaleFactor: 1,
        });
        page.on('pageerror', error => {
            throw error;
        });

        await page.addInitScript((payload: VisualizerBenchmarkFixture) => {
            window.__FOLIA_VISUALIZER_BENCHMARK_FIXTURE__ = payload;
            localStorage.setItem('i18nextLng', 'en');
        }, fixture);

        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
        await cdp.send('Tracing.start', {
            categories: 'toplevel,devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing',
            transferMode: 'ReturnAsStream',
        });

        const params = new URLSearchParams({
            mode: options.mode,
            speed: String(options.speed),
        });

        await page.goto(`http://127.0.0.1:${port}${benchmarkPagePath}?${params.toString()}`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(window.__foliaVisualizerBenchmark?.().ready), null, { timeout: 30_000 });

        const samples: MetricSample[] = [];
        let previousTaskDuration = 0;
        let previousSampleAt = performance.now();
        const startedAt = previousSampleAt;

        while (true) {
            await page.waitForTimeout(options.sampleIntervalMs);

            const now = performance.now();
            const metrics = (await cdp.send('Performance.getMetrics')).metrics;
            const taskDuration = getMetricValue(metrics, 'TaskDuration') ?? previousTaskDuration;
            const taskDurationDelta = Math.max(0, taskDuration - previousTaskDuration);
            const elapsedSincePrevious = Math.max((now - previousSampleAt) / 1000, 0.001);
            const state = await page.evaluate(() => window.__foliaVisualizerBenchmark?.());

            samples.push({
                sampledAtMs: now,
                elapsedMs: now - startedAt,
                taskDurationSeconds: taskDuration,
                taskDurationDeltaSeconds: taskDurationDelta,
                cpuBusyPercent: Math.min(100, (taskDurationDelta / elapsedSincePrevious) * 100),
                scriptDurationSeconds: getMetricValue(metrics, 'ScriptDuration'),
                layoutDurationSeconds: getMetricValue(metrics, 'LayoutDuration'),
                recalcStyleDurationSeconds: getMetricValue(metrics, 'RecalcStyleDuration'),
                usedJSHeapSize: getMetricValue(metrics, 'JSHeapUsedSize'),
                totalJSHeapSize: getMetricValue(metrics, 'JSHeapTotalSize'),
                state,
            });

            previousTaskDuration = taskDuration;
            previousSampleAt = now;

            if ((state as { done?: boolean } | undefined)?.done) {
                break;
            }
        }

        await collectTrace(cdp, path.join(outputDir, 'trace.json'));
        const finalState = await page.evaluate(() => window.__foliaVisualizerBenchmark?.());
        const sampleSummary = summarizeSamples(samples);
        const summary = {
            mode: options.mode,
            fixture: {
                name: fixture.name,
                source: fixture.source,
                benchmarkWindow: fixture.benchmarkWindow,
            },
            options,
            outputDir,
            ...sampleSummary,
            finalState,
        };

        fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
        fs.writeFileSync(path.join(outputDir, 'samples.json'), `${JSON.stringify(samples, null, 2)}\n`);

        console.log('Visualizer benchmark complete');
        console.log(`mode: ${options.mode}`);
        console.log(`samples: ${sampleSummary.samples}`);
        console.log(`mean CPU busy: ${sampleSummary.meanCpuBusyPercent.toFixed(2)}%`);
        console.log(`p95 CPU busy: ${sampleSummary.p95CpuBusyPercent.toFixed(2)}%`);
        console.log(`max CPU busy: ${sampleSummary.maxCpuBusyPercent.toFixed(2)}%`);
        console.log(`output: ${outputDir}`);
    } finally {
        await browser.close();
        await stopViteServer(vite);
    }
};

runBenchmark().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
