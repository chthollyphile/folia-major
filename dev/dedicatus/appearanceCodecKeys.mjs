import fs from 'node:fs';
import path from 'node:path';
// dev/dedicatus/appearanceCodecKeys.mjs
// 从 src/utils/appearanceCodec.ts 读出外观配置码的“字段 → 短键”对照（D512），和 visualConfigTransfer 导入时认的字段（D511）。
// 按文本读：`minified.vm = config.visualizerMode`、`n: t.name`（compressX 函数里）、`lightIntensity: 'li'`（*_SHORT_KEYS 表）。

const CODEC = 'src/utils/appearanceCodec.ts';
const TRANSFER = 'src/components/modal/settings/pages/storage/visualConfigTransfer.ts';

/**
 * 每一对写成 `<作用域>.<字段>=<短键>`：作用域是 config（顶层）、compress 函数名，或 *_SHORT_KEYS 表名。
 * @returns {string[]} 排好序
 */
export function readCodecShortKeys(root) {
    const lines = fs.readFileSync(path.join(root, CODEC), 'utf8').split('\n');
    const pairs = new Set();
    let scope = null;
    for (const line of lines) {
        const opens = /^(?:export )?const (compress\w+|\w+_SHORT_KEYS) = /.exec(line);
        if (opens) scope = opens[1];
        else if (/^(?:export )?(?:const|function) /.test(line)) scope = null;
        // 新字段按类型写成 `(minified as ConfigFields).x = (config as ConfigFields).y`，一样认
        const top = /\bminified(?: as \w+\))?\.(\w+) = .*?\bconfig(?: as \w+\))?\.(\w+)/.exec(line);
        if (top) {
            pairs.add(`config.${top[2]}=${top[1]}`);
            continue;
        }
        if (!scope) continue;
        const field = scope.endsWith('_SHORT_KEYS')
            ? /^\s+(\w+): '(\w+)',?$/.exec(line)
            : /^\s+(\w+): \w+\??\.(\w+)\b/.exec(line);
        if (!field) continue;
        // *_SHORT_KEYS 是“字段: 短键”，compress 函数里是“短键: 来源.字段”
        pairs.add(scope.endsWith('_SHORT_KEYS') ? `${scope}.${field[1]}=${field[2]}` : `${scope}.${field[2]}=${field[1]}`);
    }
    return [...pairs].sort();
}

/** compressConfig 顶层编码的字段。 */
export const readEncodedConfigFields = root => new Set(readCodecShortKeys(root)
    .filter(pair => pair.startsWith('config.'))
    .map(pair => pair.slice('config.'.length, pair.indexOf('='))));

/** applyImportedConfig 认的字段（`has('字段')`）。 */
export const readImportedConfigFields = root => new Set([...fs.readFileSync(path.join(root, TRANSFER), 'utf8').matchAll(/\bhas\('(\w+)'\)/g)].map(match => match[1]));
