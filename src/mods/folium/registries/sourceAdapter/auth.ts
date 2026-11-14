import type {
    LoginDiagnosticLine,
    LoginMethod,
    LoginSelfCheckResult,
    LoginState,
    LoginTexts,
    OnlineAuthProvider,
    ProviderLoginForm,
    ProviderSetupAction,
    ProviderSetupStep,
    ProviderSetupView,
} from '@/types/onlineMusic';
import { diagnosticLine } from '@/services/onlineMusic/login/loginDiagnosticReport';
import type { FoliumSourceAuth } from '../../sources/contract';
import { toHostUser } from '../sourceDtos';
import { lastOf, list, record, text, type SourceAdapterKit } from './kit';

// src/mods/folium/registries/sourceAdapter/auth.ts
// auth@1 as the host's internal `auth` (plan §4.6): the sign-in window's words, the ways to sign in, the form and
// the setup list come as FoliumText and leave as i18n keys; a login method's picture is the mod's own file (or an
// https or data URL); the diagnostic lines a source hands as `{ label, value }` are written by the host's one way
// to write them (loginDiagnosticReport.ts diagnosticLine), cleaned as every provider line is.

const SETUP_STATES = new Set(['done', 'todo', 'warn', 'error']);
const SETUP_ACTION_KINDS = new Set(['link', 'run', 'pick-file', 'submit-secret']);
const TONES = new Set(['ok', 'warn', 'error']);
const FIELD_TYPES = new Set(['text', 'password', 'url']);

const DIAGNOSTIC_PIECES = Object.freeze(Object.assign(['', ': ', ''], { raw: Object.freeze(['', ': ', '']) })) as unknown as TemplateStringsArray;

/** A login method's picture: a file of the mod's own folder, or an https or data URL as it is; '' for none. */
const pictureOf = (modId: string, icon: unknown): string => {
    if (typeof icon !== 'string' || !icon) return '';
    if (/^(?:https:|data:image\/|folia-mod:)/.test(icon)) return icon;
    const path = icon.replace(/^\.?\//, '');
    return /^[\w./-]+$/.test(path) && !path.includes('..') ? `folia-mod://${modId}/${path}` : '';
};

const setupOf = (kit: SourceAdapterKit, value: unknown): ProviderSetupView | null => {
    const view = record(value);
    if (!view) return null;
    const message = record(view.message);
    return {
        titleKey: kit.key(view.title, 'setup.title') ?? '',
        ...(view.note !== undefined ? { noteKey: kit.key(view.note, 'setup.note') } : {}),
        steps: list(view.steps).flatMap((item): ProviderSetupStep[] => {
            const step = record(item);
            if (!step) return [];
            const secret = record(step.secret);
            return [{
                id: text(step.id),
                titleKey: kit.key(step.title, 'setup.step.title') ?? '',
                ...(step.note !== undefined ? { noteKey: kit.key(step.note, 'setup.step.note') } : {}),
                state: SETUP_STATES.has(text(step.state)) ? step.state as ProviderSetupStep['state'] : 'todo',
                ...(typeof step.detail === 'string' ? { detail: step.detail } : {}),
                ...(secret ? { secret: { labelKey: kit.key(secret.label, 'setup.step.secret') ?? '', saved: secret.saved === true } } : {}),
                ...(Array.isArray(step.actions) ? {
                    actions: list(step.actions).flatMap((entry): ProviderSetupAction[] => {
                        const action = record(entry);
                        if (!action || !SETUP_ACTION_KINDS.has(text(action.kind))) return [];
                        return [{
                            id: text(action.id),
                            labelKey: kit.key(action.label, 'setup.action.label') ?? '',
                            kind: action.kind as ProviderSetupAction['kind'],
                            ...(action.primary === true ? { primary: true } : {}),
                        }];
                    }),
                } : {}),
            }];
        }),
        complete: view.complete === true,
        ...(message && TONES.has(text(message.tone))
            ? { message: { key: kit.key(message.text, 'setup.message') ?? '', tone: message.tone as 'ok' | 'warn' | 'error' } }
            : {}),
    };
};

export const buildAuth = (kit: SourceAdapterKit, auth: FoliumSourceAuth): OnlineAuthProvider => {
    const { modId, hostId } = kit.context;
    const bound = {
        signInRanOut: auth.signInRanOut?.bind(auth),
        oldKeptAccount: auth.oldKeptAccount?.bind(auth),
        forgetOldKeptAccount: auth.forgetOldKeptAccount?.bind(auth),
        getLoginTexts: auth.getLoginTexts?.bind(auth),
        getLoginMethods: auth.getLoginMethods?.bind(auth),
        resolveLoginMethods: auth.resolveLoginMethods?.bind(auth),
        startLogin: auth.startLogin?.bind(auth),
        getLoginForm: auth.getLoginForm?.bind(auth),
        submitLoginForm: auth.submitLoginForm?.bind(auth),
        describeLoginFailure: auth.describeLoginFailure?.bind(auth),
        createQr: auth.createQr?.bind(auth),
        openLoginPage: auth.openLoginPage?.bind(auth),
        opensLoginPageItself: auth.opensLoginPageItself?.bind(auth),
        checkLogin: auth.checkLogin?.bind(auth),
        cancelLogin: auth.cancelLogin?.bind(auth),
        getLoginTtlMs: auth.getLoginTtlMs?.bind(auth),
        getLoginDiagnostics: auth.getLoginDiagnostics?.bind(auth),
        canRunLoginSelfCheck: auth.canRunLoginSelfCheck?.bind(auth),
        runLoginSelfCheck: auth.runLoginSelfCheck?.bind(auth),
        checkAfterLogin: auth.checkAfterLogin?.bind(auth),
        getSetup: auth.getSetup?.bind(auth),
        runSetupAction: auth.runSetupAction?.bind(auth),
    };
    const textsOf = lastOf((value: unknown): LoginTexts => {
        const texts = record(value);
        const notes = record(texts?.caseNotes);
        return {
            title: kit.key(texts?.title, 'loginTexts.title') ?? '',
            note: kit.key(texts?.note, 'loginTexts.note') ?? '',
            ...(notes ? { caseNotes: Object.fromEntries(Object.entries(notes).map(([name, note]) => [name, kit.key(note, 'loginTexts.caseNotes')])) } : {}),
        };
    });
    const methodsOf = lastOf((value: unknown): LoginMethod[] => list(value).flatMap((item): LoginMethod[] => {
        const method = record(item);
        if (!method) return [];
        return [{
            id: text(method.id),
            labelKey: kit.key(method.label, 'loginMethod.label') ?? '',
            iconKey: pictureOf(modId, method.icon),
            ...(method.note !== undefined ? { noteKey: kit.key(method.note, 'loginMethod.note') } : {}),
            ...(method.preferred === true ? { preferred: true } : {}),
        }];
    }));
    const formOf = lastOf((value: unknown): ProviderLoginForm => {
        const form = record(value);
        const errors = record(form?.errors);
        return {
            fields: list(form?.fields).flatMap((item): ProviderLoginForm['fields'] => {
                const field = record(item);
                if (!field || !FIELD_TYPES.has(text(field.type))) return [];
                return [{
                    key: text(field.key),
                    type: field.type as 'text' | 'password' | 'url',
                    ...(field.label !== undefined ? { labelKey: kit.key(field.label, 'loginForm.label') } : {}),
                    ...(field.placeholder !== undefined ? { placeholderKey: kit.key(field.placeholder, 'loginForm.placeholder') } : {}),
                    ...(field.required === true ? { required: true } : {}),
                }];
            }),
            ...(form?.submitLabel !== undefined ? { submitLabelKey: kit.key(form.submitLabel, 'loginForm.submitLabel') } : {}),
            ...(form?.note !== undefined ? { noteKey: kit.key(form.note, 'loginForm.note') } : {}),
            ...(errors ? { errorKeys: Object.fromEntries(Object.entries(errors).map(([code, error]) => [code, kit.key(error, 'loginForm.errors') ?? ''])) } : {}),
        };
    });
    const describe = <Args extends unknown[], Result>(where: string, member: ((...args: Args) => Result) | undefined) => (
        member
            ? (...args: Args): Result | null => {
                try {
                    return member(...args) ?? null;
                } catch (error) {
                    console.warn(`[Folium] ${kit.label} ${where} threw`, error);
                    return null;
                }
            }
            : undefined
    );
    const describeLoginFailure = describe('describeLoginFailure', bound.describeLoginFailure);
    const {
        signInRanOut, oldKeptAccount, forgetOldKeptAccount, getLoginTexts, getLoginMethods, resolveLoginMethods, startLogin,
        getLoginForm, submitLoginForm, createQr, openLoginPage, opensLoginPageItself, checkLogin, cancelLogin, getLoginTtlMs,
        getLoginDiagnostics, canRunLoginSelfCheck, runLoginSelfCheck, checkAfterLogin, getSetup, runSetupAction,
    } = bound;
    const built: OnlineAuthProvider = {
        getLoginStatus: async () => {
            const user = record(await kit.run('getLoginStatus', () => auth.getLoginStatus()));
            return user ? toHostUser(user) : null;
        },
        logout: async () => {
            await kit.run('logout', () => auth.logout());
        },
        ...(signInRanOut ? { signInRanOut: () => signInRanOut() } : {}),
        ...(oldKeptAccount ? {
            oldKeptAccount: async () => {
                const answer = record(await kit.run('oldKeptAccount', () => oldKeptAccount()));
                const user = record(answer?.user);
                if (!answer || !user) return null;
                return { user: toHostUser(user), collections: kit.collections(answer.collections), likedSongIds: list(answer.likedSongIds).map(text) };
            },
        } : {}),
        ...(forgetOldKeptAccount ? {
            forgetOldKeptAccount: async () => {
                await kit.run('forgetOldKeptAccount', () => forgetOldKeptAccount()).catch(() => undefined);
            },
        } : {}),
        ...(getLoginTexts ? { getLoginTexts: kit.sync('getLoginTexts', () => textsOf(getLoginTexts()), () => ({ title: '', note: '' })) } : {}),
        ...(getLoginMethods ? { getLoginMethods: kit.sync('getLoginMethods', () => methodsOf(getLoginMethods()), () => []) } : {}),
        ...(resolveLoginMethods ? { resolveLoginMethods: async () => methodsOf(await kit.run('resolveLoginMethods', () => resolveLoginMethods())) } : {}),
        ...(startLogin ? { startLogin: async (methodId) => text(await kit.run('startLogin', () => startLogin(methodId))) } : {}),
        ...(getLoginForm ? { getLoginForm: kit.sync('getLoginForm', () => formOf(getLoginForm()), () => ({ fields: [] })) } : {}),
        ...(submitLoginForm ? { submitLoginForm: (values) => kit.run('submitLoginForm', () => submitLoginForm({ ...values })) } : {}),
        ...(describeLoginFailure ? { describeLoginFailure } : {}),
        ...(createQr ? { createQr: async (key) => text(await kit.run('createQr', () => createQr(key))) } : {}),
        ...(openLoginPage ? {
            openLoginPage: async (key) => {
                await kit.run('openLoginPage', () => openLoginPage(key));
            },
        } : {}),
        ...(opensLoginPageItself ? { opensLoginPageItself: kit.sync('opensLoginPageItself', (key: string) => opensLoginPageItself(key), () => false) } : {}),
        // The state is the host's to hand on: its shape is the contract's FoliumSourceLoginState.
        ...(checkLogin ? { checkLogin: async (key) => await kit.run('checkLogin', () => checkLogin(key)) as LoginState } : {}),
        ...(cancelLogin ? {
            cancelLogin: async (key) => {
                await kit.run('cancelLogin', () => cancelLogin(key));
            },
        } : {}),
        ...(getLoginTtlMs ? { getLoginTtlMs: kit.sync('getLoginTtlMs', () => getLoginTtlMs(), () => 0) } : {}),
        ...(getLoginDiagnostics ? {
            getLoginDiagnostics: async (): Promise<LoginDiagnosticLine[]> => list(await kit.run('getLoginDiagnostics', () => getLoginDiagnostics()))
                .slice(0, 64)
                .map((item) => {
                    const line = record(item);
                    const value = line?.value;
                    return diagnosticLine(
                        DIAGNOSTIC_PIECES,
                        text(line?.label).slice(0, 64),
                        typeof value === 'string' ? value.slice(0, 512) : typeof value === 'number' || typeof value === 'boolean' ? value : null,
                    );
                }),
        } : {}),
        ...(canRunLoginSelfCheck ? { canRunLoginSelfCheck: kit.sync('canRunLoginSelfCheck', () => canRunLoginSelfCheck(), () => false) } : {}),
        ...(runLoginSelfCheck ? {
            runLoginSelfCheck: async () => {
                const result = record(await kit.run('runLoginSelfCheck', () => runLoginSelfCheck()));
                return result ? { ...(result as unknown as LoginSelfCheckResult), providerId: hostId } : null;
            },
        } : {}),
        ...(checkAfterLogin ? { checkAfterLogin: async (methodId) => setupOf(kit, await kit.run('checkAfterLogin', () => checkAfterLogin(methodId))) } : {}),
        ...(getSetup ? { getSetup: async () => setupOf(kit, await kit.run('getSetup', () => getSetup())) } : {}),
        ...(runSetupAction ? {
            runSetupAction: async (stepId, actionId, value) => setupOf(kit, await kit.run('runSetupAction', () => runSetupAction(stepId, actionId, value)))
                ?? { titleKey: '', steps: [], complete: false },
        } : {}),
    };
    Object.defineProperties(built, {
        showsKeptAccountAtStart: { enumerable: true, get: () => auth.showsKeptAccountAtStart === true },
        localService: { enumerable: true, get: () => auth.localService },
    });
    return built;
};

