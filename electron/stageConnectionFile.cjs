const fs = require('fs');
const path = require('path');

// electron/stageConnectionFile.cjs
// Stage API 的连接文件：Stage API 开着时把地址和 bearer token 写进一个只有本用户能读的文件，
// 本机的外部程序（播放器插件、桥接脚本）读它就能连上，不用让用户去设置里复制 token。
// token 照旧要带：它挡的是浏览器里的网页（Stage API 回 CORS *），本机同一用户的程序本来就读得到 Folia 的配置。
// Linux 放 $XDG_RUNTIME_DIR/folia/stage.json（tmpfs，注销即清）；别的系统和没有 XDG_RUNTIME_DIR 时放 userData/stage/connection.json。

const CONNECTION_FILE_VERSION = 1;

/** 连接文件的位置。 */
function resolveStageConnectionFilePath({ platform = process.platform, env = process.env, userDataDir }) {
  const runtimeDir = env.XDG_RUNTIME_DIR;
  if (platform === 'linux' && typeof runtimeDir === 'string' && path.isAbsolute(runtimeDir)) {
    return path.join(runtimeDir, 'folia', 'stage.json');
  }
  return path.join(userDataDir, 'stage', 'connection.json');
}

/** 写、删连接文件：写的时候先写临时文件再改名，删的时候只删自己这个进程写的那份。 */
function createStageConnectionFile({ filePath, pid = process.pid, log = () => {} }) {
  let written = false;

  const write = ({ port, token }) => {
    if (!filePath || !Number.isInteger(port) || typeof token !== 'string' || !token) return false;
    const body = JSON.stringify({
      version: CONNECTION_FILE_VERSION,
      pid,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      token,
    }, null, 2);
    const temporary = `${filePath}.${pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, body, { mode: 0o600 });
      fs.renameSync(temporary, filePath);
      written = true;
      log('info', 'Wrote the Stage connection file.', { filePath, port });
      return true;
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* already gone */ }
      log('warn', 'Failed to write the Stage connection file.', error);
      return false;
    }
  };

  const remove = () => {
    if (!filePath || !written) return false;
    written = false;
    try {
      // 另一个 Folia 进程可能已经写了自己的那份：只删 pid 是自己的
      const current = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (current?.pid !== pid) return false;
      fs.rmSync(filePath, { force: true });
      log('info', 'Removed the Stage connection file.', { filePath });
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') log('warn', 'Failed to remove the Stage connection file.', error);
      return false;
    }
  };

  return { filePath, write, remove };
}

module.exports = {
  CONNECTION_FILE_VERSION,
  createStageConnectionFile,
  resolveStageConnectionFilePath,
};
