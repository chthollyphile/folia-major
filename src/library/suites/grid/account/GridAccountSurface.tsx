import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
    LibraryAccountActionId,
    LibraryAccountController,
    LibraryAccountSurfaceProps,
    LibraryLoginPhase,
} from '../../../core/contracts/account';
import {
    useLibraryAccountLayerElement,
    useLibraryAccountLogin,
    useLibraryAccountPendingSwitch,
    type LibraryLoginView,
} from '../../../core/bindings/useLibraryAccount';
import OnlineProviderLoginModal from './OnlineProviderLoginModal';
import { buildQrLoginFailureHelpProps } from './buildQrLoginFailureHelpProps';
import ConfirmDialog from '../../../../components/shared/ConfirmDialog';
import qqIcon from '../../../../assets/providers/qq.svg';
import wechatIcon from '../../../../assets/providers/wechat.svg';

// src/library/suites/grid/account/GridAccountSurface.tsx
// 网格的 account surface（Library v2 · A5）：按账户 controller 的快照渲染登录弹窗（OnlineProviderLoginModal）与
// 切换确认框（通用 ConfirmDialog），外观与 DOM 与 A4 宿主里的一致。登录弹窗 portal 进首页 surface 交上来的账户层
// （网格首页把它放在平台切换器之前，切换器仍盖在弹窗之上），没接层时就地渲染；确认框 portal 到 body（fixed z-200
// 盖住首页与切换器）。别的 suite 没有 account surface 时由宿主经 registry 回退到这里。
// 可选动作按声明显示：没声明 account-login-diagnostics 不给诊断入口，没声明 account-backend-restart 不给重启按钮
// （故障原因照样显示）。宿主卸载时关闭登录、取消待确认切换的逻辑在宿主（LibraryAccountHost），不在这里。

// provider 只声明 iconKey 字符串，静态资源的映射留在 UI 层，services 层不碰 .svg。
const LOGIN_METHOD_ICONS: Record<string, string> = {
    qq: qqIcon,
    wechat: wechatIcon,
};

type LoginModalProps = React.ComponentProps<typeof OnlineProviderLoginModal>;

/** 登录弹窗只认扫码状态：还没开始要码的两步（解析方式、选方式）对它来说是 idle。 */
const toModalState = (phase: LibraryLoginPhase): LoginModalProps['state'] => (
    phase === 'resolving-methods' || phase === 'choosing-method' ? 'idle' : phase
);

type GridLoginFeatures = {
    diagnostics: boolean;
    backendRestart: boolean;
};

/** 把已翻译的登录快照与 controller 动作装成登录弹窗的 props（与原 Grid3D 传的那一套同形）。 */
const buildLoginModalProps = (
    view: LibraryLoginView,
    account: LibraryAccountController,
    t: TFunction,
    features: GridLoginFeatures,
): LoginModalProps => {
    const { session } = view;
    return {
        title: view.title,
        note: view.note,
        qrCodeImg: session.qrImageUrl,
        statusText: view.status ?? '',
        state: toModalState(session.phase),
        retryLabel: view.retryLabel,
        closeLabel: view.closeLabel,
        retryDisabled: session.retryCooldownSeconds !== null,
        loginMethods: view.methodStep
            ? {
                title: view.methodStep.title,
                hint: view.methodStep.hint,
                pendingText: view.methodStep.pending,
                currentText: view.methodStep.current,
                options: view.methodStep.options.map(option => ({
                    id: option.id,
                    label: option.label,
                    iconUrl: LOGIN_METHOD_ICONS[option.iconKey] || '',
                })),
                selectedId: session.selectedMethodId,
                onSelect: methodId => void account.selectLoginMethod(methodId),
            }
            : undefined,
        backendFailure: view.backendFailure
            ? {
                title: view.backendFailure.title,
                detail: session.backend.detail,
                restartLabel: view.backendFailure.restartLabel,
                restartingLabel: view.backendFailure.restartingLabel,
                restarting: session.backend.restarting,
                onRestart: features.backendRestart ? () => void account.restartLoginBackend() : undefined,
            }
            : undefined,
        failureHelp: features.diagnostics && view.canShowDiagnostics && session.failure && view.failureTips
            ? buildQrLoginFailureHelpProps({
                t,
                providerId: session.providerId,
                failure: session.failure,
                tips: view.failureTips,
                selfCheck: view.selfCheck,
                buildReport: async () => {
                    const result = await account.buildLoginDiagnosticReport();
                    if (result.status !== 'ok') throw new Error('no login session to report');
                    return result.report;
                },
            })
            : undefined,
        providerId: session.providerId,
        onRetry: () => void account.retryLogin(),
        // 改完 Client ID 这类"换配置"要重开一轮：retryLogin 只在 expired / error 才放行
        onRestartLogin: () => void account.startLogin(session.providerId),
        onClose: () => void account.closeLogin(),
    };
};

const hasAction = (actions: readonly LibraryAccountActionId[], action: LibraryAccountActionId) => actions.includes(action);

const GridAccountSurface: React.FC<LibraryAccountSurfaceProps> = ({ account, isDaylight, declaredActions, layer }) => {
    const { t } = useTranslation();
    const login = useLibraryAccountLogin(account);
    const pendingSwitch = useLibraryAccountPendingSwitch(account);
    const layerElement = useLibraryAccountLayerElement(layer);
    const features: GridLoginFeatures = {
        diagnostics: hasAction(declaredActions.actions, 'account-login-diagnostics'),
        backendRestart: hasAction(declaredActions.actions, 'account-backend-restart'),
    };

    const loginModal = (
        <AnimatePresence>
            {login?.visible && <OnlineProviderLoginModal {...buildLoginModalProps(login, account, t, features)} />}
        </AnimatePresence>
    );
    const canPortal = typeof document !== 'undefined';

    return (
        <>
            {layerElement ? createPortal(loginModal, layerElement) : loginModal}
            {pendingSwitch && canPortal && createPortal(
                <ConfirmDialog
                    isOpen
                    isDaylight={isDaylight}
                    title={pendingSwitch.title}
                    description={pendingSwitch.description}
                    // 不等确认的事务（清理、刷新）走完：controller 同步清掉待确认请求，框随之收起。
                    onConfirm={() => void account.confirmSwitch(pendingSwitch.request.id)}
                    onClose={() => void account.cancelSwitch(pendingSwitch.request.id)}
                />,
                document.body,
            )}
        </>
    );
};

export default GridAccountSurface;
