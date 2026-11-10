import { loadConfig, loadTemplateLines } from '../../../.github/scripts/triage/io/context.mjs';
import { formatLoginDiagnosticReport as formatQrLoginDiagnosticReport } from '@/services/onlineMusic/login/loginDiagnosticReport';

// test/unit/triage/helpers.ts
// triage 单测共用的配置、模板与 issue 构造器。

export const config = loadConfig();
export const templateLines = loadTemplateLines();
export const NOW = Date.parse('2026-10-09T12:00:00Z');
export const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

// 构造 normalizeIssue 之后的 issue 结构，未指定的字段取「普通用户刚开的 open issue」。
export const makeIssue = (overrides: Record<string, unknown> = {}) => ({
    number: 600,
    title: '[BUG] 测试',
    body: '',
    labels: [] as string[],
    author: 'someone',
    authorType: 'User',
    authorAssociation: 'NONE',
    assignees: 0,
    hasMilestone: false,
    locked: false,
    state: 'open',
    stateReason: null,
    isPullRequest: false,
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    closedAt: null,
    ...overrides,
});

// 用应用里真实的格式化函数生成 QR 诊断，格式变了这些测试会跟着红。
export const qrReport = (appVersion: string, providerId: 'qq' | 'netease' = 'qq') => formatQrLoginDiagnosticReport({
    generatedAt: NOW,
    appVersion,
    userAgent: 'Mozilla/5.0 Folia/0.7.16 Electron/43.7.5',
    providerId,
    methodId: providerId,
    failure: 'check-error',
    timeline: [],
    providerLines: [],
});

export const filledBugBody = [
    '**Bug 描述**',
    '点击 alac 音频后显示播放错误，换成 flac 正常。',
    '**报错信息**',
    '```',
    'TypeError: Cannot read properties of undefined',
    '```',
    '**设备环境（请填写以下信息）：**',
    ' - Folia 部署类型: electron桌面版',
    ' - Folia 软件版本: folia-major v0.7.16 - main - c69afdc/水仙的守护与龙',
].join('\n');

export const noHistory = { reopened: false, botClosedBefore: false, maintainerCommented: false };
