import type { OnlineProviderId, QrLoginFailureKind } from '../../../types/onlineMusic';
import { buildQrLoginIssueUrl } from '../../../utils/qrLoginDiagnosticReport';
import type { QrLoginDiagnosticsPromptProps } from './QrLoginDiagnosticsPrompt';

// src/components/app/home/buildQrLoginDiagnosticsProps.ts
// 把扫码登录失败的诊断入口翻译成登录弹窗要的 props，Grid3D 只负责在失败时传进来。

export const buildQrLoginDiagnosticsProps = ({
    t,
    providerId,
    failure,
    buildReport,
}: {
    t: (key: string) => string;
    providerId: OnlineProviderId;
    failure: QrLoginFailureKind;
    buildReport: () => Promise<string>;
}): QrLoginDiagnosticsPromptProps | undefined => {
    if (providerId === 'qq') return undefined;
    return {
        prompt: t(failure === 'expired-after-scan' ? 'home.qrDiagnosticsPromptScanned' : 'home.qrDiagnosticsPrompt'),
        privacyNote: t('home.qrDiagnosticsPrivacy'),
        copyLabel: t('home.qrDiagnosticsCopy'),
        copiedLabel: t('home.qrDiagnosticsCopied'),
        copyFailedLabel: t('home.qrDiagnosticsCopyFailed'),
        reportLabel: t('home.qrDiagnosticsReport'),
        buildReport,
        buildIssueUrl: report => buildQrLoginIssueUrl({
            providerId,
            report,
            pasteHint: t('home.qrDiagnosticsPasteHint'),
        }),
    };
};
