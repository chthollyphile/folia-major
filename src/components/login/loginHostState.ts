import type { LibraryLoginCompletion, LibraryLoginSessionSnapshot } from '../../library/core/account/account.contract';
import { isLoginUnderWay } from '../../library/core/account/accountRules';
import type { OnlineProviderId, ProviderAccountSummary } from '../../types/onlineMusic';
import { omni } from '../../services/onlineMusic/omni';
import { rowStatus } from './platformRows';
import { rowLeadsTo, type RowLead } from './window/loginView';

// src/components/login/loginHostState.ts
// 登录窗口背后的决定，不带 React：选中了哪一行、它通向什么，和每一个要等的回答回来之后做什么。登录本身（取码、
// 轮询、失败的情况、登录方式）在账户 controller 里（library/core/account/providerAccountController.service.ts）：窗口是
// 唯一开始登录的地方，选中一行就开始，换一行、关窗就停。LoginHost.tsx 把这里接到 controller 和窗口的开关上；
// 这里只认交进来的那几样（LoginHostPorts），所以每一种先后顺序都可以在测试里摆出来。
//
// 规矩只有一条，叫「这一轮」：选中一行、窗口关掉、host 卸下，都结束上一轮。一个回答（切换、退出）回来时，
// 问它的那一轮已经结束了，就什么都不做：不关窗，不改状态。登录确认之后读到账号的那个回答由 controller 认领
// （换了一行、关了窗，controller 那一次登录就已经停下，不会再报完成）。

export interface LoginHostState {
    /** 选中的那一行，和它通向什么（'sign-in'：登录走到哪一步看 controller 的登录会话）。 */
    chosen: { providerId: OnlineProviderId; lead: RowLead } | null;
    /**
     * 账号读到了，登录成功的动画正在放：窗口留着，到动画让它走才关（done/loginDoneFrame.ts）。
     * 应用自己的状态不等它：账号读到的那一刻就在用了。
     */
    done: boolean;
}

/** host 向外面要的东西。每一样都在用的那一刻才问，拿到的是那一刻的。 */
export interface LoginHostPorts {
    rows(): readonly ProviderAccountSummary[];
    /** controller 此刻的登录会话（没有是 null）。 */
    login(): LibraryLoginSessionSnapshot | null;
    /** 开始这个平台的登录（controller 的 startLogin：先停下正在进行的那一次）。 */
    startLogin(providerId: OnlineProviderId): void;
    /** 停下正在进行的登录（controller 的 closeLogin）。 */
    closeLogin(): void;
    /** 关掉窗口：窗口只有这一个关法（loginWindowStore 的 closeLoginWindow）。 */
    closeWindow(): void;
    /** 读到账号之后放不放登录成功的动画：动效关着就不放，窗口当场关。 */
    playsDone(): boolean;
    /** 切到这个平台，回切没切成；此刻切不了是 null。 */
    switchTo(providerId: OnlineProviderId): Promise<boolean> | null;
    /** 退出这个平台的登录，回它是不是真的退出了（用的人可以在确认框里取消）；此刻退不了是 null。 */
    signOut(providerId: OnlineProviderId): Promise<boolean> | null;
}

const NOTHING_CHOSEN: LoginHostState = { chosen: null, done: false };

export const createLoginHostState = (ports: LoginHostPorts) => {
    let state = NOTHING_CHOSEN;
    let turn = 0;
    let open = false;
    // 选中的这一行的登录确认过（这一轮里）：之后它变成已登录是这一次登录读到的账号，等完成的那一声。
    let confirmedSeen = false;
    const listeners = new Set<() => void>();
    const set = (next: LoginHostState): void => {
        state = next;
        listeners.forEach(listener => listener());
    };

    /** 等一个回答，回来时还是问它的那一轮才做 `act`。回的 promise 在做完（或者决定不做）之后落定。 */
    const after = <T>(asked: Promise<T>, act: (answer: T) => void): Promise<void> => {
        const asking = turn;
        return asked.then(answer => {
            if (asking === turn) act(answer);
        });
    };

    const loginFor = (providerId: OnlineProviderId): LibraryLoginSessionSnapshot | null => {
        const login = ports.login();
        return login && login.providerId === providerId ? login : null;
    };

    /**
     * 选中一行：已登录的、不用登录的显示那一幅（正在进行的登录停下）；要登录的当场开始它的登录。
     * 不能选的行、和正在登录着的那一行自己，什么都不做；登录成功的动画放着的时候也不做（要走就关窗）；
     * 窗口关着的时候也不做：关了之后再开始的登录，下一次关窗停不下它。
     */
    const choose = (providerId: OnlineProviderId): void => {
        const summary = ports.rows().find(row => row.providerId === providerId);
        const lead = summary ? rowLeadsTo(rowStatus(summary)) : null;
        if (!open || !lead || state.done) return;
        if (state.chosen?.providerId === providerId && state.chosen.lead === lead) {
            // 已经选中、通向的也还是那一幅的行：什么都没有变，这一轮不结束（它等着的切换、退出回来还作数）。
            if (lead !== 'sign-in') return;
            const login = loginFor(providerId);
            if (login && isLoginUnderWay(login.phase)) return;
        }
        turn += 1;
        confirmedSeen = false;
        set({ chosen: { providerId, lead }, done: false });
        if (lead === 'sign-in') {
            // 表单式登录平台（如账号密码类）：选中即显示表单，不自动开始登录；关掉上一个平台的扫码会话。
            if (providerId && omni.getLoginForm(providerId)) ports.closeLogin();
            else ports.startLogin(providerId);
        } else {
            ports.closeLogin();
        }
    };

    /** 为选中的那个平台问一件事；答的是「成了」、而且回来时还是问它的那一轮，才做 `then`。 */
    const forChosen = (ask: (providerId: OnlineProviderId) => Promise<boolean> | null, then: () => void): void => {
        const asked = state.chosen ? ask(state.chosen.providerId) : null;
        if (asked) void after(asked, yes => { if (yes) then(); });
    };

    return {
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        getState: (): LoginHostState => state,
        choose,

        /** 切到选中的平台；切成了就关窗。 */
        switchToChosen: (): void => forChosen(providerId => ports.switchTo(providerId), () => ports.closeWindow()),
        /** 退出选中的平台的登录；真的退出了才关窗，在确认框里点了取消窗口留着。 */
        signOutChosen: (): void => forChosen(providerId => ports.signOut(providerId), () => ports.closeWindow()),

        /** 窗口打开了一次：给了平台就选中它，没给就什么都不选、什么都不开始。 */
        opened(providerId: OnlineProviderId | null): void {
            turn += 1;
            open = true;
            confirmedSeen = false;
            ports.closeLogin();
            set(NOTHING_CHOSEN);
            if (providerId) choose(providerId);
        },

        /**
         * 窗口关了（不管是谁关的），或者 host 卸下了：这一轮结束，正在进行的登录停下（keyed 取消）。
         * 画面留到窗口淡出，下一次打开时再清。
         */
        closed(): void {
            if (!open) return;
            open = false;
            turn += 1;
            ports.closeLogin();
        },

        /** controller 的登录会话变了：选中的这一行的登录确认了，记下来。 */
        loginChanged(): void {
            const login = state.chosen ? loginFor(state.chosen.providerId) : null;
            if (open && login?.phase === 'confirmed') confirmedSeen = true;
        },

        /**
         * 平台那一列变了。选中的这一行在登录途中变成了已登录、而它的登录并没有确认过：那是更早的一次登录（关窗之前
         * 确认的）晚到的账号。这一行已经登录了：这一次登录停下，这一行改成账号那一幅。不放动画，也不关窗。
         */
        rowsChanged(): void {
            const chosen = state.chosen;
            if (!open || !chosen || chosen.lead !== 'sign-in' || state.done || confirmedSeen) return;
            const summary = ports.rows().find(row => row.providerId === chosen.providerId);
            if (!summary || rowStatus(summary) !== 'signed-in') return;
            const login = loginFor(chosen.providerId);
            if (login?.phase === 'confirmed') return;
            turn += 1;
            ports.closeLogin();
            set({ chosen: { providerId: chosen.providerId, lead: 'account' }, done: false });
        },

        /**
         * controller 报了一次登录的结局（每一声只报一次）。是选中的这一行这一轮的登录、账号读到了（切没切过去都算）：
         * 放登录成功的动画（窗口留到动画让它走），动效关着就当场关窗。没读到账号窗口留着，说没读到。
         */
        completed(completion: LibraryLoginCompletion): void {
            const chosen = state.chosen;
            if (!open || state.done || !chosen || chosen.lead !== 'sign-in' || chosen.providerId !== completion.providerId) return;
            if (completion.outcome === 'refresh-failed') return;
            if (ports.playsDone()) set({ ...state, done: true });
            else ports.closeWindow();
        },

        /** 动画放完了，或者被跳过了（读到账号之后关窗）：它不再画。窗口由调用的人关。 */
        doneEnded(): void {
            if (state.done) set({ ...state, done: false });
        },

        /**
         * 动效的开关变了。动画放着的时候被关掉：没有人再画它，也就没有人来说它放完了，所以当场结束，
         * 窗口照常关。别的时候什么都不做。
         */
        motionChanged(): void {
            if (!state.done || ports.playsDone()) return;
            set({ ...state, done: false });
            ports.closeWindow();
        },
    };
};
