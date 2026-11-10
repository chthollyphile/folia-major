import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateAdapter } from './adapter.mjs';
// packages/coven/src/host.mjs
// 找到宿主仓库、它的 Coven 配置和适配层。harness 不知道自己装在哪个项目里，项目的东西全部从这里来：
//   根目录：当前目录所在 git 仓库的顶层（工作 session 的 worktree 里就是那个 worktree）
//   配置：环境变量 COVEN_CONFIG > 根目录 package.json 的 "coven": { "config": "<路径>" } > 根目录的 coven.config.json
//   适配层：配置里的 "adapter"，相对配置文件所在目录

/** 当前目录所在 git 仓库的顶层目录。 */
export function hostRoot(cwd = process.cwd()) {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('要在一个 git 仓库里运行 coven');
    return path.resolve(result.stdout.trim());
}

/** 配置文件在哪。找不到就说清楚有哪几种写法。 */
export function configPathOf(root, env = process.env) {
    if (env.COVEN_CONFIG) return path.resolve(root, env.COVEN_CONFIG);
    const pkgFile = path.join(root, 'package.json');
    if (fs.existsSync(pkgFile)) {
        const configured = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).coven?.config;
        if (configured) return path.resolve(root, configured);
    }
    const fallback = path.join(root, 'coven.config.json');
    if (fs.existsSync(fallback)) return fallback;
    throw new Error('找不到 Coven 配置：在 package.json 里写 "coven": { "config": "<路径>" }，或者在根目录放 coven.config.json，或者设环境变量 COVEN_CONFIG');
}

const REQUIRED_CONFIG = ['repo', 'adapter', 'leaseHours', 'timeZone', 'timeZoneLabel', 'concurrency', 'maxReviewRounds', 'roles', 'risk'];

/** 配置的形状检查：缺字段直接报错，不要跑到一半才发现。 */
export function validateConfig(config, file) {
    const missing = REQUIRED_CONFIG.filter(key => config?.[key] === undefined);
    if (missing.length > 0) throw new Error(`${file} 缺这些字段：${missing.join('、')}`);
    if (!/^[\w.-]+\/[\w.-]+$/.test(config.repo)) throw new Error(`${file} 的 repo 要写成 owner/name`);
    for (const role of ['planner', 'generator', 'evaluator']) {
        if (!config.roles[role]?.model) throw new Error(`${file} 的 roles.${role} 要写 model 和 effort`);
    }
    return config;
}

/**
 * 读入宿主：根目录、配置、适配层。
 * @returns {Promise<{ root: string, config: any, configFile: string, adapter: any }>}
 */
export async function loadHost({ cwd = process.cwd(), env = process.env } = {}) {
    const root = hostRoot(cwd);
    const configFile = configPathOf(root, env);
    if (!fs.existsSync(configFile)) throw new Error(`找不到 Coven 配置 ${configFile}`);
    const config = validateConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')), path.relative(root, configFile));
    const adapterFile = path.resolve(path.dirname(configFile), config.adapter);
    if (!fs.existsSync(adapterFile)) throw new Error(`找不到适配层 ${path.relative(root, adapterFile)}（配置里的 adapter）`);
    const adapter = validateAdapter((await import(pathToFileURL(adapterFile).href)).default, { config });
    return { root, config, configFile, adapter };
}

/** 给人看的配置文件路径（相对根目录）。 */
export const configLabel = host => path.relative(host.root, host.configFile).replace(/\\/g, '/');
