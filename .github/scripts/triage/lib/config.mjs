// .github/scripts/triage/lib/config.mjs
// triage 配置的校验与查询。结构不对就直接 throw：workflow 变红比带着错配置去改 issue 安全。

const REQUIRED_SECTIONS = ['labels', 'modules', 'aggregates', 'outOfScope', 'providerRequest', 'pausedAreas', 'thresholds', 'llm', 'breaker', 'pr', 'wishlist', 'stale'];

export const MODES = ['off', 'dry-run', 'live'];

// 校验并返回配置对象；只做结构检查，不补默认值，配置文件就是唯一真相。
export function validateConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('triage config: 不是对象');
    if (config.version !== 1) throw new Error(`triage config: 不支持的 version ${config.version}`);
    if (!MODES.includes(config.mode)) throw new Error(`triage config: mode 必须是 ${MODES.join('/')}`);
    for (const key of REQUIRED_SECTIONS) {
        if (config[key] === undefined) throw new Error(`triage config: 缺少 ${key}`);
    }
    if (!config.modules.general) throw new Error('triage config: modules 必须包含兜底的 general');
    for (const id of Object.keys(config.modules)) {
        if (!config.labels.managed[moduleLabel(id)]) throw new Error(`triage config: 模块 ${id} 没有对应的受管标签`);
    }
    for (const aggregate of config.aggregates) {
        if (!Number.isInteger(aggregate.issue) || !aggregate.provider) throw new Error(`triage config: 汇总 issue ${aggregate.id} 配置不完整`);
    }
    return config;
}

export const moduleLabel = id => `module: ${id}`;

// 标签白名单支持末尾 `*` 通配，例如 `module: *`。
export function matchesLabelPattern(name, patterns) {
    return patterns.some(pattern => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern));
}

export const canBotAdd = (config, name) => matchesLabelPattern(name, config.labels.botMayAdd);
export const canBotRemove = (config, name) => matchesLabelPattern(name, config.labels.botMayRemove);

export const isMaintainerAssociation = (config, association) => config.maintainerAssociations.includes(association);

// 生效模式：dispatch 勾选 dry_run 时强制 dry-run；否则仓库变量优先于配置。
// dispatch 不能把模式抬得比仓库变量更高，live 只能由仓库变量显式打开。
export function resolveMode({ dispatchDryRun, varMode, configMode }) {
    const base = MODES.includes(varMode) ? varMode : configMode;
    if (base === 'off') return 'off';
    if (dispatchDryRun) return 'dry-run';
    return base;
}
