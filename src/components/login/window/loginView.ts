import type { LibraryLoginPhase } from '../../../library/core/account/account.contract';
import type { LoginFailure } from '../../../types/loginFailure';
import type { LoginTexts, OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';
import type { RowStatus } from '../platformRows';
import { LOGIN_CASE_TEXTS } from './loginCaseTexts';

// src/components/login/window/loginView.ts
// 登录窗口里看不出来、要靠规则定的那几件事：选中一行之后右边是什么，窗口此刻是哪一种样子、它的标题
// 是哪一句，失败时第二行说哪一句、引谁的话，步骤标记走到哪一步。都是纯函数。登录走到哪一步、能不能重来、
// 等待再试等到什么时候在账户 controller 的快照和 library/core/account/accountRules 里。
// 一行的状态和那一列的顺序在 ../platformRows.ts：主页的按钮和切换器也用它们。

/** 搜索框里的字筛出的行：名字或短名里有它，不分大小写。 */
export const filterRows = (rows: readonly ProviderAccountSummary[], query: string): ProviderAccountSummary[] => {
    const wanted = query.trim().toLowerCase();
    return wanted ? rows.filter(row => `${row.shortName}\n${row.displayName}`.toLowerCase().includes(wanted)) : [...rows];
};

/**
 * 选中一行之后右边是什么：账号；不用登录；或者登录（先选登录方式、浏览器登录先等用的人点按钮、扫码登录当场取
 * 二维码，由账户 controller 按平台定）。不能选的行是 null。
 */
export type RowLead = 'account' | 'accountless' | 'sign-in';

export const rowLeadsTo = (status: RowStatus): RowLead | null => {
    if (status === 'off') return null;
    if (status === 'signed-in') return 'account';
    if (status === 'accountless') return 'accountless';
    return 'sign-in';
};

/** 窗口右边此刻的样子。 */
export type LoginScene =
    | 'none'            // 还没有选平台
    | 'account'
    | 'accountless'
    | 'methods'         // 等用的人选登录方式
    | 'form'            // 账号密码类平台：表单式登录（字段按 provider 声明的 getLoginForm 渲染）
    | 'browser-ready'   // 浏览器登录，等用的人点按钮
    | 'preparing'       // 正在取二维码，或者正在打开浏览器
    | 'code'            // 二维码等着扫
    | 'browser'         // 等浏览器里确认
    | 'scanned'
    | 'reading'         // 确认了，正在读账号
    | 'failed';

/**
 * 账号那一幅画的是什么：有资料的账号；已登录、却没有资料（只有平台的名字，照样能切换和退出）；
 * 或者这一幅开着的时候登录没有了（'gone'：留一个重新登录的按钮）。
 */
export const accountView = (status: RowStatus | null, hasUser: boolean): 'user' | 'nameless' | 'gone' => (
    status !== 'signed-in' ? 'gone' : hasUser ? 'user' : 'nameless'
);

export const loginScene = ({ lead, phase, inBrowser, failed, providerId }: {
    /** 选中的那一行通向什么；null 是没有选。 */
    lead: RowLead | null;
    /** 这一行的登录走到哪一步；还没有登录会话（正在开始）是 null。 */
    phase: LibraryLoginPhase | null;
    inBrowser: boolean;
    /** 登录交出了一种失败。「浏览器没有打开」时登录还在等，也算。 */
    failed: boolean;
    /** 选中的平台；null 是没有选。表单式登录平台（账号密码类）不自动开始登录，直接给表单。 */
    providerId?: OnlineProviderId | null;
}): LoginScene => {
    if (lead === null) return 'none';
    if (lead === 'account' || lead === 'accountless') return lead;
    if (failed) return 'failed';
    // 表单式登录平台：弹窗右侧直接给账号密码表单，不在弹窗里自动开始登录。
    if (lead === 'sign-in' && providerId && omni.getLoginForm(providerId)) return 'form';
    switch (phase) {
        case 'choosing-method': return 'methods';
        case 'ready': return 'browser-ready';
        case 'waiting': return inBrowser ? 'browser' : 'code';
        case 'scanned': return 'scanned';
        case 'confirmed': return 'reading';
        default: return 'preparing';
    }
};

/**
 * 一种样子的标题是哪一句（i18n key）。'title' 是平台自己的登录标题，'name' 是平台或账号的名字，
 * 'case' 是失败的那一种情况的标题。
 */
export const sceneHeadline = (scene: LoginScene, inBrowser: boolean): string => {
    switch (scene) {
        case 'none': return 'login.choosePlatform';
        case 'account': case 'accountless': return 'name';
        case 'methods': return 'home.loginMethodTitle';
        case 'preparing': return inBrowser ? 'home.loginBrowserLoading' : 'title';
        case 'browser': return 'home.loginCodeWaiting';
        case 'scanned': return 'home.qrScanned';
        case 'reading': return 'login.readingAccount';
        case 'failed': return 'case';
        case 'form': return 'title';
        default: return 'title';
    }
};

/**
 * 失败标题下面的第二行是哪一句（i18n key）：平台对这一种情况说的那一句（LoginTexts.caseNotes），没有就是
 * 共用的那一句；都没有就没有第二行。
 */
export const failureNoteKey = (failure: LoginFailure, caseNotes: LoginTexts['caseNotes']): string | undefined => (
    caseNotes?.[failure.case.id] || LOGIN_CASE_TEXTS[failure.case.id].note
);

/**
 * 安静的框里引的话：平台的原话，带着它的码；只有码就引码。平台什么都没说、而这一种情况要重启本地服务时，
 * 引那个服务自己的错误原话。都没有就不引。
 */
export const failureQuote = (failure: LoginFailure, serviceError: string | null): { text: string; code?: string } | undefined => {
    const { message, code } = failure.facts;
    if (message) return { text: message, code };
    if (code) return { text: code };
    const serviceSaid = failure.case.action === 'restart-service' ? serviceError || undefined : undefined;
    return serviceSaid ? { text: serviceSaid } : undefined;
};

export type StepMark = 'code' | 'browser' | 'phone' | 'account';

/** 步骤标记：有哪几个、现在在第几个。不在登录途中就没有。 */
export const stepMarks = (scene: LoginScene, inBrowser: boolean): { marks: StepMark[]; current: number } | null => {
    const marks: StepMark[] = inBrowser ? ['browser', 'account'] : ['code', 'phone', 'account'];
    if (scene === 'preparing' || scene === 'code' || scene === 'browser') return { marks, current: 0 };
    if (scene === 'scanned') return { marks, current: 1 };
    if (scene === 'reading') return { marks, current: marks.length - 1 };
    return null;
};
