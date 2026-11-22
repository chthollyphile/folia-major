import type { FoliumSourceLocalService } from '@folia/folium';
import { neteaseEnv, neteaseTextKey } from './neteaseEnv';
import { hearNeteaseBackendStatus, rememberNeteaseBackendStatus, type NeteaseBackendStatus } from './netease';

// sources/netease/core/neteaseLocalService.ts
// 网易云的本地后端（main 入口工作线程里的 API）在登录窗口里的样子：它起没起来、它自己的错误原话、重启。它起不来时
// 取二维码的请求必然失败，登录窗口据此显示原因和重启的按钮。只有桌面版有（网页版发到配置的地址）。
// 状态来自 main 入口：每次变化它经 rpc.send('status') 推过来（client 交给 noteNeteaseBackendStatus），请求问端口时
// 拿到的也记在这里。登录窗口打开（subscribe）时问一次：只用于匹配时 main 入口要等到真用到才加载，所以不在 client
// 一启动就问。起不来时告诉用的人一次（handle.notify）。

type Listener = () => void;

const listeners = new Set<Listener>();
let current: NeteaseBackendStatus | null = null;
let restarting = false;
let last = { failed: false, error: null as string | null, restarting: false };
// When the failure last told was reported: the same failure pushed twice is told once.
let lastToldFailureAt: number | null = null;

const emit = () => {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch (error) {
            console.warn('[NeteaseLocalService] a listener failed', error);
        }
    });
};

/** The backend's state as the main entry told it (a push, or the answer to a request): kept, and told on failure. */
export const noteNeteaseBackendStatus = (status: NeteaseBackendStatus | null): void => {
    current = status;
    rememberNeteaseBackendStatus(status);
    emit();
    if (status?.status !== 'error' || lastToldFailureAt === (status.updatedAt ?? null)) return;
    lastToldFailureAt = status.updatedAt ?? null;
    // The service's own sentence, for the log line and for the message on screen.
    const reason = status.error?.trim() ?? '';
    console.warn('[NeteaseLocalService] the NetEase API failed to start', reason);
    // 断网时没起来，不说「接口启动失败」：要用它的请求会说连不上，网通了它会在下一次被用到时再启动。
    if (status.offline === true) return;
    // The reason travels with the notice: reports of this failure used to arrive with nothing to go on.
    neteaseEnv().notify?.({
        type: 'error',
        text: reason ? neteaseTextKey('status.startupFailedDetail', { reason }) : neteaseTextKey('status.startupFailed'),
        ...(status.updatedAt ? { nonce: status.updatedAt } : {}),
        durationMs: 8000,
    });
};

// What a request learns of the backend (asking for its port) is what the sign-in window shows too.
hearNeteaseBackendStatus(status => noteNeteaseBackendStatus(status));

const askStatus = async (): Promise<void> => {
    try {
        noteNeteaseBackendStatus(await neteaseEnv().call<NeteaseBackendStatus | null>('status'));
    } catch (error) {
        console.warn('[NeteaseLocalService] could not read the NetEase API status', error);
    }
};

export const neteaseLocalService: FoliumSourceLocalService = {
    subscribe(listener) {
        listeners.add(listener);
        // The sign-in window is open: what it shows is asked now (the request for the code would ask anyway).
        if (listeners.size === 1) void askStatus();
        return () => {
            listeners.delete(listener);
        };
    },
    getStatus() {
        const failed = current?.status === 'error';
        const error = failed ? current?.error ?? null : null;
        if (last.failed !== failed || last.error !== error || last.restarting !== restarting) last = { failed, error, restarting };
        return last;
    },
    async restart() {
        restarting = true;
        emit();
        try {
            noteNeteaseBackendStatus(await neteaseEnv().call<NeteaseBackendStatus | null>('restart'));
        } finally {
            restarting = false;
            emit();
        }
        return current?.status === 'running';
    },
};

/** What the module keeps of the backend: dropped when the source is made again or stops. */
export const resetNeteaseLocalService = (): void => {
    current = null;
    restarting = false;
    lastToldFailureAt = null;
    last = { failed: false, error: null, restarting: false };
};
