"use strict";

// electron/tempDirEnvironment.cjs
// Windows 上 TEMP / TMP 有时被存成不展开的字符串类型（优化工具或手动改注册表），值里留着字面的
// %USERPROFILE%。os.tmpdir() 原样返回它，path.resolve 再把它拼到当前目录下，变成一个不存在的
// 相对路径（#690：D:\ruanjian\Folia\%USERPROFILE%\AppData\Local\Temp）。网易上游、分析 sidecar
// 都按 os.tmpdir() 取临时目录，所以在 main.cjs 最前面就地展开，而不是在各处另选目录。

// os.tmpdir() 在 Windows 上依次读 TEMP、TMP。
const TEMP_KEYS = ['TEMP', 'TMP'];
const ENV_REFERENCE = /%([^%]+)%/g;

// Windows 的环境变量名不分大小写；process.env 本身已经如此，测试传进来的普通对象不是。
const lookup = (env, name) => {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
};

/**
 * 展开 TEMP / TMP 里的 %NAME% 引用并写回 env，返回实际改动的项（{ key, from, to }）。
 * 只展开一层、只认已定义的变量，与系统展开 REG_EXPAND_SZ 的行为一致；引用不到的原样留着。
 * 非 Windows 平台不做任何事。
 */
function repairTempDirEnvironment({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return [];
  const repairs = [];
  for (const key of TEMP_KEYS) {
    const from = env[key];
    if (typeof from !== 'string' || !from.includes('%')) continue;
    const to = from.replace(ENV_REFERENCE, (reference, name) => {
      const value = lookup(env, name);
      return typeof value === 'string' && value && !value.includes('%') ? value : reference;
    });
    if (to === from) continue;
    env[key] = to;
    repairs.push({ key, from, to });
  }
  return repairs;
}

module.exports = {
  repairTempDirEnvironment,
};
