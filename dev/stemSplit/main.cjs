const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mnn = require('../../electron/analysis/mnn.cjs');

// dev/stemSplit/main.cjs
// 全曲人声/伴奏分离的独立原型：用应用已有的 htdemucs（models/htdemucs-wgsl.bin）把一首歌整首分成
// 四个音源（另存人声和伴奏 = drums + bass + other），两种引擎都能跑——CPU 走主进程里的 MNN（electron/analysis/mnn.cjs），
// GPU 走页面里的 WebGPU 运行时（src/services/analysis/htdemucsWgsl）——并给出解码、加载、每段推理、
// 拼接、写盘的耗时和实时倍率。不碰应用自己的配置目录：userData 是临时目录。
//
//   node dev/stemSplit/run.mjs [音频文件]
//
// 无界面跑一遍再退出（打印结果）：
//
//   STEM_AUTO=cpu,gpu-f16 STEM_FILE=song.flac node dev/stemSplit/run.mjs
//
// 引擎名：cpu（STEM_THREADS 线程，默认 4，应用里 automix 用的数）、gpu（f32）、gpu-f16。
// 结果写到 系统临时目录/folia-stem-split/<歌名>-<引擎>/：drums / bass / other / vocals.wav、instrumental.wav、mix.wav（16 位）、timing.json。
// 界面里的调音台把四轨各接一个 0.0–2.0× 的强度滑块实时试听（dev/stemSplit/mixer.ts）。

const outDir = process.env.STEM_OUT_DIR;
if (!outDir) {
    console.error('用 node dev/stemSplit/run.mjs 启动（它先打包页面再设好 STEM_OUT_DIR）');
    process.exit(2);
}
const repoRoot = path.join(__dirname, '..', '..');
const weightsFile = path.join(repoRoot, 'models', 'htdemucs-wgsl.bin');
const ffmpegCandidates = [path.join(repoRoot, 'build', 'ffmpeg', `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'ffmpeg'];

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'folia-stem-split-userdata-')));

/** CPU 上的 htdemucs：线程数变了就重建（MNN 建图时定死线程数）。 */
let cpu = null;

ipcMain.handle('stem-config', () => ({
    weights: weightsFile,
    ffmpeg: ffmpegCandidates.find(file => file === 'ffmpeg' || fs.existsSync(file)),
    results: path.join(os.tmpdir(), 'folia-stem-split'),
    auto: (process.env.STEM_AUTO || '').split(',').filter(Boolean),
    file: process.env.STEM_FILE || process.argv.find(arg => /\.(mp3|flac|wav|m4a|ogg|opus|aac|ape|wma|dsf|dff)$/i.test(arg)) || '',
    threads: Number(process.env.STEM_THREADS || 4),
    cores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? '',
}));

ipcMain.handle('stem-pick', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '音频', extensions: ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus', 'aac', 'ape', 'wma', 'dsf', 'dff'] }] });
    return picked.canceled ? '' : picked.filePaths[0];
});

ipcMain.handle('stem-open', (_event, target) => shell.openPath(target));

ipcMain.handle('cpu-load', (_event, threads) => {
    if (cpu?.threads === threads) return { cached: true, ms: 0, threads, isa: mnn.isa(), fastCores: cpu.fastCores };
    cpu?.model.release();
    cpu = null;
    const fastCores = mnn.preferFastCores();
    const started = performance.now();
    const model = mnn.loadHtdemucs(weightsFile, { threads, scratchDir: app.getPath('temp') });
    const ms = performance.now() - started;
    cpu = { model, threads, fastCores };
    console.log(`[stemSplit] CPU htdemucs 加载 ${ms.toFixed(0)} ms，${threads} 线程，${mnn.isa()}，rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
    return { cached: false, ms, threads, isa: mnn.isa(), fastCores };
});

/** 一段 [2, 172032] 进，四个音源 [4, 2, 172032] 出，附上纯推理时间。 */
ipcMain.handle('cpu-run', async (_event, input) => {
    if (!cpu) throw new Error('CPU 模型还没加载');
    const segment = cpu.model.inputShape(0)[2];
    const started = performance.now();
    const [{ data }] = await cpu.model.run([{ data: input, dims: [1, 2, segment] }]);
    return { data, ms: performance.now() - started, rssMb: process.memoryUsage().rss / 1048576 };
});

ipcMain.handle('cpu-release', () => {
    cpu?.model.release();
    cpu = null;
});

ipcMain.on('stem-log', (_event, line) => console.log(line));
ipcMain.on('stem-done', (_event, code) => app.exit(code));

app.whenReady().then(() => {
    const auto = Boolean(process.env.STEM_AUTO);
    const win = new BrowserWindow({
        show: !auto,
        width: 1100,
        height: 860,
        title: 'htdemucs 全曲分离原型',
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
    });
    win.setMenuBarVisibility(false);
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error' || event.level === 'warning') console.log(`[renderer] ${event.message}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        console.error('renderer gone', details);
        app.exit(3);
    });
    win.loadFile(path.join(outDir, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
