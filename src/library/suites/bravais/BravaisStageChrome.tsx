import React, { useCallback } from 'react';
import { Blinds, PanelsTopLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GridLocateButton } from '../../../components/app/playing-song-locator/GridLocateButton';
import WallBackButton from '../../../components/wall/WallBackButton';
import WallToolsButton from '../../../components/wall/WallToolsButton';
import type { WallToolsEntry, WallToolsQuickAction } from '../../../components/wall/WallToolsRows';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import type { LibraryWallLook } from '../../../utils/libraryWallLook';
import { BRAVAIS_HELP_ROWS } from './bravaisHelp';
import { nextWallLook } from './bravaisLook';
import type { BravaisBackStep } from './bravaisBack';

// src/library/suites/bravais/BravaisStageChrome.tsx
// bravais 墙上的两颗浮层控件（实测反馈 1，设计稿 §7.5「浮层控件」），与 Lattice 共用 components/wall 的同一套：
// - 左上角隐藏式返回（WallBackButton concealed）：做什么由 stage 按 bravaisBack 定——不在首页根层时与缝里的 ‹ 同一个返回
//   （先关面板 / 表单，再退层），可访问名「返回」；首页根层有歌时回到播放页（「回到播放页」），没有歌时不画。
//   z-index 在缝之下：缝正好开在左上角时让缝的按钮在上面。
// - 右下角工具按钮（WallToolsButton）：结构与 Lattice 一致，公共部分（洗牌、主题、队列、播放器、设置五格与音量滑条）由
//   components/wall 从 App 的墙面工具宿主（wallToolsHost）组装，这里只给 bravais 自己的三样——
//   1. above：工具按钮正上方的定位按钮（GridLocateButton，与网格集合页、Lattice 的同一颗；按下走外观动作 locate-playing）；
//   2. destination：前往 Lattice（宿主的 onOpenLattice，首页工具格「队列拼贴」同一个入口；私人 FM 下禁用并写原因）；
//   3. entries：「墙面外观」与透光（循环三档，面板不收起）；共享的叠色开关、开灯 / 关灯在 wall 里；帮助行在 bravaisHelp。
//   滑动打开命令面板。不碰相机与显示：定位走外观动作的同一个实现，透光写 app 层偏好（与命令面板的 wall-look 同一条路）。

const LOOK_LABEL_KEYS: Record<LibraryWallLook, string> = {
    solid: 'options.libraryWallLookSolid',
    partial: 'options.libraryWallLookPartial',
    clear: 'options.libraryWallLookClear',
};

type BravaisStageChromeProps = {
    isDaylight: boolean;
    /** 左上角返回此刻的去处（null：不画）；run 在点击时按最新状态再判一次。 */
    back: { step: BravaisBackStep; run: () => void } | null;
    /**
     * 定位按钮（null：不画，没有歌在放，或首页层上没有这首）：run 是外观动作 locate-playing，isHere 是歌在这一层里
     * （按钮亮起），pageKey 是这一层被定位器问的页键（问着时按钮转圈；首页层没有）。
     */
    locatePlaying: { run: () => void; isHere: boolean; pageKey: string | null } | null;
    /** 进入 Lattice（stage 契约的 onOpenLattice）；缺省时快捷动作里没有这一格。 */
    onOpenLattice?: () => void;
    /**
     * 工具按钮此刻认领 App 的 dock（WallToolsDock）：墙显示着（首页层可交互、当前层归 bravais），或正在交接里离开（Lattice
     * 后认领、盖在上面，按钮不闪）。不在 dock 里（组件探针）时不看它。
     */
    toolsClaimed?: boolean;
};

const BravaisStageChrome: React.FC<BravaisStageChromeProps> = ({
    isDaylight,
    back,
    locatePlaying,
    onOpenLattice,
    toolsClaimed = true,
}) => {
    const { t } = useTranslation();
    const look = useLibraryWallLookStore(state => state.look);
    const setLook = useLibraryWallLookStore(state => state.setLook);
    const isFmMode = usePlaybackStore(state => state.isFmMode);

    // 定位器正在问这一层（按钮转圈，与网格定位按钮的「正在找」同一个意思）。
    const isLocateAsked = usePlayingSongLocatorStore(state => (
        locatePlaying?.pageKey != null && state.request?.collectionKey === locatePlaying.pageKey
    ));

    // 收起：dock 里的按钮是同一颗，进了 Lattice 不能还开着、换成 Lattice 的条目。私人 FM 下进不了 Lattice（与导航层同一个原因）。
    const destination: WallToolsQuickAction | undefined = onOpenLattice ? {
        id: 'open-lattice',
        icon: PanelsTopLeft,
        label: t('libraryBravais.toolsLattice'),
        kbd: `${PRIMARY_MODIFIER_LABEL} + B`,
        disabled: isFmMode,
        status: isFmMode ? t('status.latticeUnavailableInFm') : undefined,
        onSelect: onOpenLattice,
    } : undefined;

    const entries = useCallback((): WallToolsEntry[] => [
        { kind: 'heading', id: 'appearance', label: t('libraryBravais.toolsAppearance') },
        {
            kind: 'action',
            id: 'wall-look',
            icon: Blinds,
            label: t('options.libraryWallLook'),
            value: t(LOOK_LABEL_KEYS[look]),
            keepOpen: true,
            onSelect: () => setLook(nextWallLook(look)),
        },
    ], [look, setLook, t]);

    return (
        <>
            {back && (
                <WallBackButton
                    label={back.step === 'player' ? t('libraryBravaisHome.backToPlayer') : t('libraryBravais.seamBack')}
                    onBack={back.run}
                    concealed
                />
            )}
            <WallToolsButton
                idPrefix="bravais-tools"
                label={t('libraryBravais.tools')}
                claimed={toolsClaimed}
                isDaylight={isDaylight}
                above={locatePlaying ? (
                    <GridLocateButton
                        isDaylight={isDaylight}
                        accentColor="var(--text-accent)"
                        isHere={locatePlaying.isHere}
                        isSeeking={isLocateAsked}
                        title={t('playlist.locatePlaying')}
                        onLocate={locatePlaying.run}
                    />
                ) : undefined}
                destination={destination}
                entries={entries}
                help={BRAVAIS_HELP_ROWS.map(row => (
                    <li key={row.id} data-bravais-help={row.id}>
                        <span>{t(row.labelKey)}</span>
                        <kbd>{row.kbd(PRIMARY_MODIFIER_LABEL)}</kbd>
                    </li>
                ))}
            />
        </>
    );
};

export default React.memo(BravaisStageChrome);
