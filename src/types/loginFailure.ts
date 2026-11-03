import type { LoginCaseId, LoginFailureDetail, LoginStep, ProviderErrorCode } from './onlineMusic';

// src/types/loginFailure.ts
// 一次登录没有成功时交给登录窗口的东西：是哪一种情况、它的事实、发生的时刻。只有类型：
// 怎么从事实分出情况在 services/onlineMusic/login/loginFailureCase.ts，账户 controller 的快照
// （library/core/account/account.contract.ts）带着它，登录窗口按它画。

// 类别：A 没有完成，B 连不上，C 平台拒绝，D 本地服务，E 浏览器，F 没读到账号，G 原因不明。
export type LoginCaseKind = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export type LoginCaseAction = 'refresh-code' | 'sign-in-again' | 'restart-service' | 'reopen-browser' | 'wait-then-retry';

export interface LoginCase {
    id: LoginCaseId;
    kind: LoginCaseKind;
    action: LoginCaseAction;
    // 有没有可以展开的详情（平台、环节、原始信息）。
    details: boolean;
}

// 一次登录失败的全部事实：provider 交出来的，加上是哪一步、是不是浏览器登录、扫没扫过码，
// 和抛出的错的共用代码。抛出的错自己的那句话不在里面：它进登录时间线（describeLoginError）和日志。
export interface LoginFailureFacts extends LoginFailureDetail {
    step: LoginStep;
    inBrowser: boolean;
    scanned: boolean;
    // 抛出的是 OnlineProviderError 时它的 code。
    errorCode?: ProviderErrorCode;
}

// 登录交给登录窗口的：是哪一种情况、它的事实、发生的时刻（毫秒时间戳，等待再试从它起算）。
export interface LoginFailure {
    case: LoginCase;
    facts: LoginFailureFacts;
    at: number;
}
