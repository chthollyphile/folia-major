import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';
import { Button } from '../../modal/settings/kit/Button';
import { TextField } from '../../modal/settings/kit/TextField';

// src/components/login/window/FormLogin.tsx
// 通用表单式登录：按 provider 声明的 ProviderLoginForm（omni.getLoginForm）渲染字段并提交。
// 提交成功后通知 host（LoginHost 走账户 controller 的完成链路：读账号 → activate-after-login → 动画/关窗），
// 这里不自己读账号、不自己关窗。
// 提交是异步的：提交期间用户换了平台/关了窗，组件卸载，成功回调不再执行（mounted 检查）。
// 错误按 OnlineProviderError.code 走 i18n（form.errorKeys），provider 的中文错误信息只进日志。
export const FormLogin: React.FC<{ providerId: OnlineProviderId; onLoggedIn: () => void }> = ({ providerId, onLoggedIn }) => {
    const { t } = useTranslation();
    const form = omni.getLoginForm(providerId);
    const [values, setValues] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    // 提交是异步的：提交期间换了平台、关了窗，组件卸载，成功回调不再执行（否则会关掉别人的窗口）。
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    if (!form) return null;

    const canSubmit = !busy && form.fields.every(field => !field.required || Boolean((values[field.key] ?? '').trim()));

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setErrorKey(null);
        try {
            await omni.submitLoginForm(providerId, values);
            if (!mounted.current) return; // 提交期间用户换走了：不再通知关窗。
            onLoggedIn();
        } catch (caught) {
            console.warn('[FormLogin] login failed:', caught);
            if (!mounted.current) return;
            // 界面按错误 code 走 i18n；没有对应项的 code 显示通用失败文案。
            const code = caught instanceof OnlineProviderError ? caught.code : null;
            setErrorKey(code ? form.errorKeys?.[code] ?? null : null);
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    return (
        <div className="w-full max-w-[360px] px-0.5 py-1.5 pb-2.5">
            {form.noteKey && <div className="text-[13px] leading-relaxed text-[color:var(--st-t2)]">{t(form.noteKey)}</div>}
            {form.fields.map(field => (
                <label key={field.key} className="mt-3.5 block text-[13px] text-[color:var(--st-t2)]">
                    {field.labelKey ? t(field.labelKey) : (field.label ?? field.key)}
                    <div className="mt-2">
                        <TextField
                            type={field.type === 'text' ? undefined : field.type}
                            value={values[field.key] ?? ''}
                            onChange={value => setValues(prev => ({ ...prev, [field.key]: value }))}
                            placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
                            disabled={busy}
                        />
                    </div>
                </label>
            ))}
            {errorKey && (
                <div className="mt-3 rounded-lg border border-[color:var(--st-err)]/50 bg-[color-mix(in_srgb,var(--st-err)_13%,transparent)] px-3 py-2 text-[13px] font-semibold leading-relaxed text-[color:var(--st-err)] break-all">
                    {t(errorKey)}
                </div>
            )}
            <div className="mt-4">
                <Button
                    variant="primary"
                    disabled={!canSubmit}
                    onClick={() => void submit()}
                >
                    {busy ? t('home.loginMethodPending') : (form.submitLabelKey ? t(form.submitLabelKey) : (form.submitLabel ?? t('login.submit')))}
                </Button>
            </div>
        </div>
    );
};

export default FormLogin;
