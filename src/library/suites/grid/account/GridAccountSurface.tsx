import React from 'react';
import { createPortal } from 'react-dom';
import type { LibraryAccountSurfaceProps } from '../../../core/account/account.contract';
import { useLibraryAccountPendingSwitch } from '../../../core/account/useLibraryAccount';
import ConfirmDialog from '../../../../components/shared/ConfirmDialog';

// src/library/suites/grid/account/GridAccountSurface.tsx
// 网格的 account surface（Library v2 · A5）：待确认切换的确认框（通用 ConfirmDialog，portal 到 body，fixed z-200
// 盖住首页与切换器）。登录本身画在登录窗口里（src/components/login，App 挂一个，所有 suite 共用），网格首页的
// 登录按钮和右下角的药丸打开它。别的 suite 没有 account surface 时由宿主经 registry 回退到这里（bravais 就是）。
// 宿主卸载时关闭登录、取消待确认切换的逻辑在宿主（LibraryAccountHost），不在这里。

const GridAccountSurface: React.FC<LibraryAccountSurfaceProps> = ({ account, isDaylight }) => {
    const pendingSwitch = useLibraryAccountPendingSwitch(account);
    if (!pendingSwitch || typeof document === 'undefined') return null;
    return createPortal(
        <ConfirmDialog
            isOpen
            isDaylight={isDaylight}
            title={pendingSwitch.title}
            description={pendingSwitch.description}
            // 不等切换走完（离开旧平台、读账号）：controller 同步清掉待确认请求，框随之收起。眼下切换不再确认，这个框不会出现。
            onConfirm={() => void account.confirmSwitch(pendingSwitch.request.id)}
            onClose={() => void account.cancelSwitch(pendingSwitch.request.id)}
        />,
        document.body,
    );
};

export default GridAccountSurface;
