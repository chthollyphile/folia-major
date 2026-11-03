const path = require('path');
const { Worker, SHARE_ENV } = require('worker_threads');

// electron/netease/neteaseApiHost.cjs
// 主进程这一侧。网易云本地 API 在工作线程里加载和运行（neteaseApiWorker.cjs，原因写在那里）；
// 这里开线程，把「启动」和「取诊断」发过去等回话，把线程里的日志接回主进程的 console。

// 创建主进程用来指挥网易云 API 工作线程的对象。线程在第一次用到（preload 或 start）时才开。
// 线程结束时（不管怎么结束的）这里记一行日志，再调 onExit(code, error)；error 就是等着的请求被拒绝时拿到的那一个。
function createNeteaseApiHost({
  // env: SHARE_ENV 让线程读写进程自己的环境变量，和这个包在主线程里运行时一样。不写的话线程拿到的是
  // 一份拷贝：Windows 上那份拷贝认大小写（存成 Temp 的读不成 TEMP），主进程后来改的它也看不到。
  createWorker = () => new Worker(path.join(__dirname, 'neteaseApiWorker.cjs'), { env: SHARE_ENV }),
  logger = console,
  onUnhandledRejection = () => {},
  onWorkerError = (error) => { throw error; },
  onExit = () => {},
} = {}) {
  let worker = null;
  let nextRequestId = 1;
  const pending = new Map();

  const handleMessage = (message) => {
    if (message.type === 'log') {
      // 写的那一刻再取方法：主进程的 console 是被接管过的，早先存下的引用会绕过去。
      (logger[message.level] || logger.log).apply(logger, message.args);
    } else if (message.type === 'unhandled-rejection') {
      onUnhandledRejection(message.reason);
    } else if (message.type === 'result') {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) {
        request?.resolve(message.value);
      } else if (message.offline && message.error && typeof message.error === 'object') {
        // 断网造成的失败：标记放回错上，主进程按它把状态记成断网（markApiDown）。
        request?.reject(Object.assign(message.error, { offline: true }));
      } else {
        request?.reject(message.error);
      }
    }
  };

  const ensureWorker = () => {
    if (worker) {
      return worker;
    }

    const created = createWorker();
    worker = created;
    created.on('message', handleMessage);
    // 线程里未捕获的异常。默认的处理是原样抛出：它和主线程里的异常走同一条路（写崩溃报告、退出）。
    created.on('error', onWorkerError);
    created.on('exit', (code) => {
      if (worker === created) {
        worker = null;
      }
      // 线程没了，等着的回话不会再来；下一次启动会开一个新的线程。
      const error = new Error(`Netease API worker exited with code ${code}`);
      logger.error(`[Netease API] worker thread exited with code ${code}`);
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
      onExit(code, error);
    });
    return created;
  };

  const request = (type, payload = {}) => new Promise((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ ...payload, type, id });
  });

  return {
    // 提前把线程开出来，让它先加载包。
    preload: () => {
      ensureWorker();
    },
    // 在线程里拉起 API（端口由线程挑），监听成功后 resolve { port }；失败时 reject 的是线程里抛出的那个值。
    start: ({ host }) => request('start', { host }),
    // 拉起步骤、登录请求、扫码身份与上游连接都记在线程里（请求在那里发出）。线程还没开过时，给同样形状的空记录。
    diagnostics: () => (
      worker ? request('diagnostics') : Promise.resolve({ startup: [], login: null, identity: null, connections: [] })
    ),
  };
}

module.exports = {
  createNeteaseApiHost,
};
