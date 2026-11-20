const { describeError } = require('../backendLifecycle.cjs');

// electron/netease/upstreamTmpDir.cjs
// 上游包（@neteasecloudmusicapienhanced/api）自己按 os.tmpdir() 读写 anonymous_token、xeapi_public_key、
// neapi_key 与上传临时文件。/tmp 是全机用户共有的：另一个系统用户先开过 Folia 时，那里的文件属主是别人，
// 这边读不出也盖不掉，本地 API 起不来（#1304，EACCES）。所以工作线程的 os.tmpdir() 要指向按用户隔离的
// 目录（userData 下的 netease-api-tmp，主进程经 workerData 传进来）；指不成（没传、建不出来）时退回
// 系统临时目录，行为与改动前一致。

/**
 * 决定工作线程的 os.tmpdir() 应该返回哪个目录。requestedDir 是主进程传来的按用户隔离的目录：
 * ensureDirectory 建得出且写得了就用它；建不出（目录上有文件、权限不够）或没传时退回系统临时目录，
 * fallback 带上原因（进日志）。
 */
function resolveUpstreamTmpDir({ requestedDir, systemTmpDir, ensureDirectory }) {
    if (!requestedDir) return { dir: systemTmpDir, fallback: 'not requested' };
    try {
        ensureDirectory(requestedDir);
        return { dir: requestedDir, fallback: null };
    } catch (error) {
        return { dir: systemTmpDir, fallback: `${requestedDir}: ${describeError(error)}` };
    }
}

module.exports = {
    resolveUpstreamTmpDir,
};
