import React from 'react';
import AutomixModelReminder from '../../src/components/modal/AutomixModelReminder';
import { useSettingsUiStore } from '../../src/stores/useSettingsUiStore';
import type { ProbeDefinition } from './definition';
// dev/probes/automixModelReminder.probe.tsx

/**
 * 打开过渡开关、机器上又没有权重时弹的那个提示。
 *
 * 三个按钮而不是两个：「知道了」和「不再提醒」是两个不同的回答，而只给前者的提示，
 * 会一直去问一个已经决定了的人。要看的是这三个的轻重排布——「不再提醒」是这个对话框里
 * 唯一收不回的选择，所以它不该是最顺手的那个。
 *
 * 深浅两套都挂出来：按钮的边框和主按钮的底色在白天配色下是另一组值。
 */
const AutomixModelReminderProbe: React.FC = () => {
    const isOpen = useSettingsUiStore(state => state.isAutomixModelReminderOpen);
    const [isDaylight, setIsDaylight] = React.useState(false);

    return (
        <div className="flex flex-col gap-4 p-8">
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    data-probe-action="open"
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => useSettingsUiStore.setState({ isAutomixModelReminderOpen: true })}
                >
                    {isOpen ? '已打开' : '打开提示'}
                </button>
                <button
                    type="button"
                    data-probe-action="daylight"
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => setIsDaylight(value => !value)}
                >
                    {isDaylight ? '白天 → 夜间' : '夜间 → 白天'}
                </button>
            </div>
            <div className="text-xs text-zinc-400">
                「去下载」会调 openSettings，在探针里没有设置面板可开，只会把提示关掉。
            </div>
            <AutomixModelReminder isDaylight={isDaylight} />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'automixModelReminder',
    title: '模型下载提示',
    description: '打开过渡开关、又没有模型时的提示：去下载 / 知道了 / 不再提醒。',
    Component: AutomixModelReminderProbe,
};

export default definition;
