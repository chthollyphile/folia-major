// src/services/onlineMusic/qq/qqBackendDeclaration.ts
// 后端在 /login/channels 里说明的会话存法（`sessionMode`）：续期要靠它分出 Serverless（qqSessionRefresh.ts）。
// 通道列表由 qqProvider.ts 自己记；这里只记会话存法，探测成功时由它写进来。

let declaredSessionMode: string | null = null;

/** 记下 /login/channels 的 `data` 里的会话存法；没说就是 null。 */
export const noteQqBackendDeclaration = (data: unknown): void => {
    const sessionMode = data && typeof data === 'object' ? (data as { sessionMode?: unknown }).sessionMode : undefined;
    declaredSessionMode = typeof sessionMode === 'string' ? sessionMode : null;
};

export const resetQqBackendDeclaration = (): void => {
    declaredSessionMode = null;
};

/** 后端的会话存法：`sealed`（Serverless，会话就在 token 里，续期会换 token）或 `stored`；没说是 null。 */
export const qqBackendSessionMode = (): string | null => declaredSessionMode;
