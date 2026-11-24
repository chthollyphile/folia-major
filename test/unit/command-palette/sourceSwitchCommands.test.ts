// @vitest-environment jsdom
// @builtin-sources
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModSourceStatesPayload, ModSourceStateRow } from '@/mods/types';
import type * as ModsIpc from '@/mods/ipc';
import type * as SourceSwitches from '@/mods/runtime/sourceSwitches';

// test/unit/command-palette/sourceSwitchCommands.test.ts
// Folium 2.0 plan §5.3: the switches of "Settings → Sources" go into the command palette too. One command per state a
// source can move to now (enable, only for matching where the source may, disable), built from the main process's
// source states and put in again whenever they change; running one switches the source the way the page does.

const ipc = vi.hoisted(() => ({
    pushed: null as ((payload: ModSourceStatesPayload) => void) | null,
    getSourceStates: vi.fn(),
}));
vi.mock('@/mods/ipc', async importOriginal => ({
    ...(await importOriginal<typeof ModsIpc>()),
    getSourceStates: ipc.getSourceStates,
    subscribeSourceStates: (callback: (payload: ModSourceStatesPayload) => void) => {
        ipc.pushed = callback;
        return () => {};
    },
}));
const switches = vi.hoisted(() => ({ switchSourceState: vi.fn() }));
vi.mock('@/mods/runtime/sourceSwitches', async importOriginal => ({
    ...(await importOriginal<typeof SourceSwitches>()),
    switchSourceState: switches.switchSourceState,
}));

const row = (sourceId: string, extra: Partial<ModSourceStateRow> = {}): ModSourceStateRow => ({
    sourceId,
    modId: `folia.source.${sourceId}`,
    tier: 'builtin',
    state: 'enabled',
    keepForMatching: false,
    takeover: false,
    loaded: true,
    mainState: 'ready',
    ...extra,
});

const switchIds = async () => {
    const { COMMAND_PALETTE_COMMANDS } = await import('@/components/command-palette/commandRegistry');
    return COMMAND_PALETTE_COMMANDS.map(command => command.id).filter(id => /^source-(enable|matching|disable)-/.test(id));
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the commands that switch one source', () => {
    beforeEach(() => {
        ipc.getSourceStates.mockReset();
        switches.switchSourceState.mockReset();
    });

    afterEach(async () => {
        const { setSourceSwitchCommands } = await import('@/components/command-palette/commandRegistry');
        setSourceSwitchCommands([]);
    });

    it('offers each state a source can move to now, and only-for-matching only where the source may', async () => {
        const { buildSourceSwitchCommands, sourceSwitchStates } = await import('@/components/command-palette/commands/sourceSwitchCommands');
        expect(sourceSwitchStates({ state: 'enabled', threeStates: true })).toEqual(['matching', 'disabled']);
        expect(sourceSwitchStates({ state: 'enabled', threeStates: false })).toEqual(['disabled']);
        expect(sourceSwitchStates({ state: 'matching', threeStates: true })).toEqual(['enabled', 'disabled']);
        expect(sourceSwitchStates({ state: 'disabled', threeStates: false })).toEqual(['enabled']);

        const run = vi.fn(async () => {});
        const commands = buildSourceSwitchCommands([
            { sourceId: 'demo', state: 'disabled', threeStates: true, name: () => 'Demo' },
        ], run);
        expect(commands.map(command => command.id)).toEqual(['source-enable-demo', 'source-matching-demo']);
        const enable = commands[0];
        expect(enable.group).toBe('settings');
        expect(enable.platform).toEqual(['electron']);
        expect(enable.textSource).toBe('runtime');
        expect(enable.title).toContain('Demo');
        expect(enable.keywords).toEqual(expect.arrayContaining(['demo', 'Demo']));

        expect(await enable.execute('', {} as never)).toBe(true);
        expect(run).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'demo' }), 'enabled');
    });

    it('is found by its whole title, and a query naming a state ranks that state first', async () => {
        const { default: i18n } = await import('@/i18n/config');
        const { buildSourceSwitchCommands } = await import('@/components/command-palette/commands/sourceSwitchCommands');
        const { rankCommands } = await import('@/components/command-palette/search/rankCommands');
        const previous = i18n.language;
        try {
            for (const language of ['zh-CN', 'en']) {
                await i18n.changeLanguage(language);
                // Built anew per language, as the installer does when the text changes.
                const commands = buildSourceSwitchCommands([
                    { sourceId: 'demo', state: 'enabled', threeStates: true, name: () => 'Demo' },
                    { sourceId: 'other', state: 'disabled', threeStates: false, name: () => 'Other' },
                ], vi.fn(async () => {}));
                const top = (query: string) => rankCommands(query, commands, [], language)[0]?.command.id;
                const title = (id: string) => commands.find(command => command.id === id)!.title;
                for (const command of commands) {
                    expect(top(command.title)).toBe(command.id);
                }
                expect(top(title('source-disable-demo').replace('Demo', ' Demo '))).toBe('source-disable-demo');
                expect(top(language === 'en' ? 'Demo matching' : 'Demo 匹配')).toBe('source-matching-demo');
                expect(top(language === 'en' ? 'disable Demo' : '停用 Demo')).toBe('source-disable-demo');
            }
        } finally {
            await i18n.changeLanguage(previous);
        }
    });

    it('follows the main process\'s source states, and a switch goes through the same path as the Sources page', async () => {
        const { omni } = await import('@/services/onlineMusic/omni');
        // The two built-in sources the test helper registers, one that may be used only for matching and one that may not.
        const registered = omni.getProviderSummaries().map(provider => provider.providerId);
        expect(registered).toEqual(expect.arrayContaining(['netease', 'bodian']));
        ipc.getSourceStates.mockResolvedValue({
            states: {},
            sources: [row('bodian'), row('netease', { keepForMatching: true })],
            hasSourceMods: true,
            sourcesOnboarding: false,
        });

        const { installSourceSwitchCommands } = await import('@/components/command-palette/sourceSwitchCommandsInstaller');
        installSourceSwitchCommands();
        await flush();

        // In the registry's order: netease before bodian.
        expect(await switchIds()).toEqual(['source-matching-netease', 'source-disable-netease', 'source-disable-bodian']);

        // The main process pushes new states (the Sources page switched one): the commands follow.
        ipc.pushed?.({ states: { bodian: 'disabled' }, sources: [row('bodian', { state: 'disabled' }), row('netease', { keepForMatching: true })] });
        expect(await switchIds()).toEqual(['source-matching-netease', 'source-disable-netease', 'source-enable-bodian']);

        // Running one switches the source and takes the states the main process answers with.
        switches.switchSourceState.mockResolvedValue({
            ok: true,
            states: { bodian: 'enabled' },
            sources: [row('bodian'), row('netease', { keepForMatching: true })],
        });
        const { COMMAND_PALETTE_COMMANDS } = await import('@/components/command-palette/commandRegistry');
        const enable = COMMAND_PALETTE_COMMANDS.find(command => command.id === 'source-enable-bodian')!;
        expect(enable.title).toContain(omni.getProviderLabel('bodian'));
        await enable.execute('', {} as never);
        await flush();
        expect(switches.switchSourceState).toHaveBeenCalledWith('bodian', 'enabled');
        expect(await switchIds()).toEqual(['source-matching-netease', 'source-disable-netease', 'source-disable-bodian']);

        // A refusal leaves the commands as they were and says why.
        switches.switchSourceState.mockResolvedValue({ ok: false, error: 'source-cannot-match-only' });
        const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
        await COMMAND_PALETTE_COMMANDS.find(command => command.id === 'source-disable-bodian')!.execute('', {} as never);
        await flush();
        expect(await switchIds()).toEqual(['source-matching-netease', 'source-disable-netease', 'source-disable-bodian']);
        expect(useStatusMessageStore.getState().message?.type).toBe('error');
    });

    it('runs one switch per source at a time, and shows a switch that throws as failed instead of rejecting', async () => {
        const { runSourceSwitch } = await import('@/components/command-palette/sourceSwitchCommandsInstaller');
        const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let answer: (value: { ok: boolean }) => void = () => undefined;
        switches.switchSourceState.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
        const target = { sourceId: 'qishui', state: 'enabled' as const, threeStates: false, name: () => 'Qishui' };
        const first = runSourceSwitch(target, 'disabled');
        await runSourceSwitch(target, 'enabled');
        expect(switches.switchSourceState).toHaveBeenCalledTimes(1);
        answer({ ok: true });
        await first;
        switches.switchSourceState.mockRejectedValueOnce(new Error('ipc gone'));
        await expect(runSourceSwitch(target, 'disabled')).resolves.toBeUndefined();
        expect(switches.switchSourceState).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(useStatusMessageStore.getState())).toContain('error');
    });
});
