import React from 'react';
import AutomixTransitionAnimation from '../../src/components/app/overlays/AutomixTransitionAnimation';
import NowPlayingToast from '../../src/components/app/overlays/NowPlayingToast';
import { announceTransition, type TransitionRenderer } from '../../src/services/automix/transitionCue';
import { useSettingsUiStore } from '../../src/stores/useSettingsUiStore';
import type { ProbeDefinition } from './definition';
// dev/probes/automixTransitionSwitches.probe.tsx

/**
 * 一次混音的两个画法，和管它们的那两个开关。
 *
 * 屏幕正中的圆环归 transitionAnimation，卡片边框上的描边归 transitionAnimationCard，两者互不
 * 相干——这个探针要看的就是「互不相干」是真的：
 *
 * 1. 只开一个，只有那一个出来；
 * 2. 谁被拨上去，谁立刻演示一次，不用等下一次真混音；
 * 3. 混音跑到一半把谁关掉，谁立刻停，另一个照常跑完。
 *
 * 三条都卡在同一个时序上：设置页是在同一个 click 里先写开关、下一行就广播预览，而 React 要等
 * 这次事件结束才提交。所以下面这个「照抄设置页开关」按钮一字不差地照抄那两行——圆环是被开关挂
 * 上来的，广播发出去的时候它还不存在，收不到那条广播。它得自己去问「现在正在跑的是哪一次」。
 *
 * 圆环按 App.tsx 的规矩挂：开关开着才挂载（懒加载的 animejs chunk 只在要用时才拉）。
 */

/** 演示 cue 是写着收件人的：拨哪个开关就演示哪一个。设置页同理。 */
const previewCue = (renderer: TransitionRenderer) => (
    { seconds: 10, crossover: 0.55, periodSec: 0.5, preview: renderer } as const
);

const THEME = { accentColor: '#e8763c' } as never;

const AutomixTransitionSwitchesProbe: React.FC = () => {
    const ringOn = useSettingsUiStore(state => state.transitionAnimation);
    const cardOn = useSettingsUiStore(state => state.transitionAnimationCard);
    const toggleRing = useSettingsUiStore(state => state.handleToggleTransitionAnimation);
    const toggleCard = useSettingsUiStore(state => state.handleToggleTransitionAnimationCard);

    // 两个开关都只在 automix 下有意义，探针里固定住。
    React.useEffect(() => {
        useSettingsUiStore.setState({ transitionMode: 'automix' });
    }, []);

    const buttonClass = 'rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10';

    /** 一字不差照抄 TransitionSettingsSection 里那个开关的 onClick。 */
    const flip = (renderer: TransitionRenderer, on: boolean, toggle: (next: boolean) => void) => {
        const next = !on;
        toggle(next);
        if (next) announceTransition(previewCue(renderer));
    };

    return (
        <div className="min-h-screen bg-zinc-900 p-8">
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    data-probe-action="ring-switch"
                    data-probe-ring={ringOn ? 'on' : 'off'}
                    className={buttonClass}
                    onClick={() => flip('ring', ringOn, toggleRing)}
                >
                    屏幕圆环：{ringOn ? '开' : '关'}
                </button>
                <button
                    type="button"
                    data-probe-action="card-switch"
                    data-probe-card={cardOn ? 'on' : 'off'}
                    className={buttonClass}
                    onClick={() => flip('card', cardOn, toggleCard)}
                >
                    卡片描边：{cardOn ? '开' : '关'}
                </button>
                {/* 真混音走的是这条：广播一次，不碰开关 */}
                <button type="button" data-probe-action="cue" className={buttonClass} onClick={() => announceTransition({ seconds: 10, crossover: 0.55, periodSec: 0.5 })}>
                    广播一次真混音（10s）
                </button>
                <button type="button" data-probe-action="end" className={buttonClass} onClick={() => announceTransition(null)}>
                    提前结束
                </button>
            </div>
            <p className="mt-4 max-w-[560px] text-xs leading-relaxed text-zinc-400">
                拨上任一个开关都应该立刻演示一次，且只演示被拨上的那一个。混音期间把谁关掉，谁应该
                立刻消失。卡片在左下角，圆环在屏幕正中。
            </p>

            {/* App.tsx 里就是这么挂的：开关开着才挂载 */}
            {ringOn && <AutomixTransitionAnimation theme={THEME} isDaylight={false} />}

            <NowPlayingToast
                song={{ title: '秘密のメリーゴーランド (ft. Sohbana)', artist: 'ミカヅキ BIGWAVE', coverUrl: null }}
                trackKey="track-a"
                isDaylight={false}
                mode="always"
                theme={THEME}
            />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'automixTransitionSwitches',
    title: '过渡动画的两个开关',
    description: '屏幕圆环和卡片描边各自一个开关：只开一个就只出一个，拨上就演示，混音中途关掉就立刻停。',
    Component: AutomixTransitionSwitchesProbe,
};

export default definition;
