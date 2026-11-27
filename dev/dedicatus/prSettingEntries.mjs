import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSettingEntriesInPrBody } from './checks/settingEntries.mjs';
import { DEFAULT_MODE } from './codes.mjs';
import { parseDiff, renames } from './diff.mjs';
import { diffFrom, resolveBase, showAt } from './git.mjs';
import { levelOf, printGithub, printText } from './report.mjs';
// dev/dedicatus/prSettingEntries.mjs
// D516：PR 拿掉了设置入口（dev/dedicatus/settingEntries.json 比目标分支少了），PR 描述里要写明。
// CI 的 .github/workflows/pr-setting-entries.yml 跑它：PR 描述改了也会重跑，所以不放进 pr-unit-tests（那边一改描述就要重跑全部单测）。
// 本机试：node dev/dedicatus/prSettingEntries.mjs --base origin/main --body-file <PR 描述的文本文件>
//   --base <ref>      比较基点（CI 传 HEAD^1，即合并提交的第一个父提交）
//   --body-file <路径> PR 描述；不给时读 GitHub Actions 的事件文件（GITHUB_EVENT_PATH 的 pull_request.body）
//   --github          GitHub 注解 + job summary

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
    const options = { base: 'origin/main', bodyFile: null, github: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--base') options.base = argv[++i];
        else if (arg === '--body-file') options.bodyFile = argv[++i];
        else if (arg === '--github') options.github = true;
        else throw new Error(`不认识的参数：${arg}`);
    }
    return options;
}

function readPrBody(options) {
    if (options.bodyFile) return fs.readFileSync(options.bodyFile, 'utf8');
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) throw new Error('没有 PR 描述：给 --body-file，或者在 GitHub Actions 的 pull_request 事件里跑');
    return JSON.parse(fs.readFileSync(eventPath, 'utf8')).pull_request?.body ?? '';
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const mode = process.env.DEDICATUS_MODE ?? DEFAULT_MODE;
    const base = resolveBase(root, options.base);
    const io = {
        readBase: file => showAt(root, base, file),
        readCurrent: file => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null),
        renameMap: renames(parseDiff(diffFrom(root, base))),
    };
    const fresh = checkSettingEntriesInPrBody(io, readPrBody(options));
    const hasError = fresh.some(finding => levelOf(finding) === 'error');
    const exitCode = mode === 'enforce' && hasError ? 1 : 0;
    const result = { mode, base, fresh, known: [], exitCode };
    if (options.github) printGithub(result);
    else printText(result);
    process.exitCode = exitCode;
}

// 工具自己出错（找不到比较基点、登记表解析不了、没有 PR 描述）报 D004，退出码 2，和 cli.mjs 一样不显示成“通过”。
try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes('--github')) console.log(`::error title=D004::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    console.error(`[prSettingEntries] D004 ${message}`);
    process.exitCode = 2;
}
