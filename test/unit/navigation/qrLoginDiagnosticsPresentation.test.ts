import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildQrLoginDiagnosticsProps } from '../../../src/components/app/home/buildQrLoginDiagnosticsProps';
import OnlineProviderLoginModal from '../../../src/components/app/home/OnlineProviderLoginModal';
import type { QrLoginFailureKind } from '../../../src/types/onlineMusic';

// test/unit/navigation/qrLoginDiagnosticsPresentation.test.ts

const failures: QrLoginFailureKind[] = [
    'start-error', 'check-error', 'expired-after-scan', 'account-refresh-failed',
];

const renderFailure = (providerId: string, failure: QrLoginFailureKind) => {
    const buildReport = vi.fn(async () => 'report');
    const diagnostics = buildQrLoginDiagnosticsProps({
        t: key => key, providerId, failure, buildReport,
    });
    const html = renderToStaticMarkup(createElement(OnlineProviderLoginModal, {
        title: 'Login', note: 'Login note', qrCodeImg: '', statusText: 'Login failed',
        state: 'error', retryLabel: 'Retry', closeLabel: 'Close', diagnostics,
        onRetry: () => {}, onClose: () => {},
    }));
    return { diagnostics, html, buildReport };
};

describe('QR login diagnostics presentation', () => {
    it.each(failures)('removes the entire QQ diagnostics block for %s', failure => {
        const { diagnostics, html, buildReport } = renderFailure('qq', failure);
        expect(diagnostics).toBeUndefined();
        expect(html).not.toContain('home.qrDiagnostics');
        expect(html).toContain('Login failed');
        expect(html).toContain('Retry');
        expect(html).toContain('Close');
        expect(buildReport).not.toHaveBeenCalled();
    });

    it.each(['netease', 'kugou'])('keeps %s diagnostics and buttons', providerId => {
        for (const failure of failures) {
            const { diagnostics, html, buildReport } = renderFailure(providerId, failure);
            expect(diagnostics?.prompt).toBe(failure === 'expired-after-scan'
                ? 'home.qrDiagnosticsPromptScanned' : 'home.qrDiagnosticsPrompt');
            expect(html).toContain('home.qrDiagnosticsPrivacy');
            expect(html).toContain('home.qrDiagnosticsCopy');
            expect(html).toContain('home.qrDiagnosticsReport');
            expect(diagnostics?.buildReport).toBe(buildReport);
            expect(buildReport).not.toHaveBeenCalled();
        }
    });
});
