import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import ProgressBar from '../../ProgressBar';
import { PlayerState } from '../../../types';
import TrackTitleNavigator from '../TrackTitleNavigator';
import PlayerControlSlotButton from '../PlayerControlSlotButton';
import CapsuleQuickActions from '../CapsuleQuickActions';
import { HifiProgressRow } from '../../hifi/HifiBadge';
import { useIsHifiRoute } from '../../hifi/useHifiSignalPath';
import type { PlayerControlSlotActionId, PlayerControlSlotContext } from '../playerControlSlotActions';
import type { TrackNavigation } from '../../FloatingPlayerControls';
import type { WallLocateAction } from '../../../stores/useBottomDockStore';
import type { NowPlayingToastSong } from '../../app/overlays/NowPlayingToast';
import {
    CompactCollapsedView,
    CompactCover,
    CompactExpandedView,
    type CompactCapsuleCard,
    type CompactCapsuleInfo,
    type CompactCapsuleMeta,
} from './CompactCapsuleViews';

// src/components/floating-player/compact/CompactCapsuleContent.tsx
// 紧凑档胶囊里的内容：把宽屏胶囊用的那批零件（ProgressBar、TrackTitleNavigator、槽位按钮、快捷操作、HiFi 进度行）
// 交给 CompactCapsuleViews 排成收起和展开两种样子。FloatingPlayerControls 只决定用哪一种。

type CompactCapsuleContentProps = {
    expanded: boolean;
    info: CompactCapsuleInfo | null;
    card: CompactCapsuleCard | null;
    /** 卡片此刻展示的那首（预告时是下一首）。 */
    cardSong: NowPlayingToastSong | null;
    locate: WallLocateAction | null;
    hasCompanion: boolean;
    currentSong: { name: string; } | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    duration: number;
    canTogglePlay: boolean;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    noTrackText: string;
    primaryColor: string;
    secondaryColor: string;
    trackColor: string;
    isDaylight: boolean;
    controlsDisabled: boolean;
    trackNavigation: TrackNavigation | null;
    slotPrimary: PlayerControlSlotActionId;
    slotSecondary: PlayerControlSlotActionId;
    slotContext: PlayerControlSlotContext;
    onCustomizePrimary: (anchorRect: DOMRect) => void;
    onCustomizeSecondary: (anchorRect: DOMRect) => void;
    /** 快捷操作那一行：null 是不出，touch 是手指点出来的（44px 一格）。 */
    quick: { touch: boolean; limit: number; } | null;
};

const CompactCapsuleContent: React.FC<CompactCapsuleContentProps> = ({
    expanded,
    info,
    card,
    cardSong,
    locate,
    hasCompanion,
    currentSong,
    playerState,
    currentTime,
    duration,
    canTogglePlay,
    onSeek,
    onTogglePlay,
    noTrackText,
    primaryColor,
    secondaryColor,
    trackColor,
    isDaylight,
    controlsDisabled,
    trackNavigation,
    slotPrimary,
    slotSecondary,
    slotContext,
    onCustomizePrimary,
    onCustomizeSecondary,
    quick,
}) => {
    const { t } = useTranslation();
    const isHifiRoute = useIsHifiRoute();
    const isPlaying = playerState === PlayerState.PLAYING;

    // 收起和展开各画一颗播放键，但大小、位置完全一样（都在最下一行的右端），换形态时看不出换过，不滑也不闪。
    const playButton = (size: 'sm' | 'lg') => (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
            }}
            disabled={!canTogglePlay || controlsDisabled}
            aria-label={isPlaying ? t('player.pause') : t('player.play')}
            title={isPlaying ? t('player.pause') : t('player.play')}
            className={`flex shrink-0 items-center justify-center rounded-full border-none shadow-lg transition-transform ${size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'} ${controlsDisabled ? 'cursor-not-allowed opacity-45' : 'hover:scale-105'}`}
            style={{ backgroundColor: primaryColor, color: 'var(--bg-color)' }}
        >
            {isPlaying
                ? <Pause size={size === 'lg' ? 20 : 17} fill="currentColor" />
                : <Play size={size === 'lg' ? 20 : 17} fill="currentColor" className="ml-0.5" />}
        </button>
    );

    const progressBar = (variant: 'line' | 'full', collapsed: boolean) => (
        <ProgressBar
            currentTime={currentTime}
            duration={duration}
            onSeek={onSeek}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            trackColor={trackColor}
            disabled={controlsDisabled}
            collapsed={collapsed}
            variant={variant === 'line' ? 'line' : 'default'}
        />
    );

    // 卡片在场（不是“不显示”）时胶囊里有封面；墙上封面就是定位按钮。卡片不显示、墙上又要能定位时只画定位按钮。
    const locateOnly = locate ? <CompactCover coverUrl={null} isDaylight={isDaylight} locate={locate} locateOnly /> : null;
    const cover = card !== null && card.mode !== 'never' && cardSong !== null
        ? (
            <CompactCover
                coverUrl={cardSong.coverUrl}
                isDaylight={isDaylight}
                locate={locate}
                onActivate={card.onActivate}
                activateLabel={card.activateLabel}
            />
        )
        : locateOnly;

    if (!expanded) {
        return (
            <CompactCollapsedView
                info={info}
                cover={cover}
                // 进度态（卡片限时退场或不显示）在墙上也要能定位：左端留一颗定位按钮。
                progressLeading={info ? null : locateOnly}
                renderProgress={variant => progressBar(variant, true)}
                playButton={playButton('sm')}
                hasCompanion={hasCompanion}
                primaryColor={primaryColor}
            />
        );
    }

    const titleRow = trackNavigation ? (
        <TrackTitleNavigator
            title={currentSong?.name || noTrackText}
            trackKey={trackNavigation.currentTrackKey}
            prevTitle={trackNavigation.prevTitle}
            nextTitle={trackNavigation.nextTitle}
            canPrev={trackNavigation.canPrev}
            canNext={trackNavigation.canNext}
            onPrev={trackNavigation.onPrev}
            onNext={trackNavigation.onNext}
            prevLabel={trackNavigation.prevLabel}
            nextLabel={trackNavigation.nextLabel}
            color={primaryColor}
            isDaylight={isDaylight}
            disabled={controlsDisabled}
        />
    ) : (
        <div className="truncate text-center text-sm font-bold select-none" style={{ color: primaryColor }}>
            {currentSong?.name || noTrackText}
        </div>
    );
    // 封面旁边的字跟着封面走：卡片不在场（没有封面）就不写。预告时封面是下一首的，字也写下一首，带“接下来播放”小标。
    const isNextUp = card !== null && card.isNextUp && card.nextUp !== null;
    const meta: CompactCapsuleMeta | null = card !== null && card.mode !== 'never' && cardSong !== null
        ? isNextUp
            ? { label: t('ui.stageTrackPillNext'), primary: cardSong.title, secondary: cardSong.artist }
            : cardSong.artist
                ? { label: null, primary: cardSong.artist, secondary: cardSong.album ?? null }
                : { label: null, primary: cardSong.album ?? null, secondary: null }
        : null;
    const progressRow = isHifiRoute
        ? <HifiProgressRow className="w-full" isDaylight={isDaylight} disabled={controlsDisabled}>{progressBar('full', false)}</HifiProgressRow>
        : progressBar('full', false);

    return (
        <CompactExpandedView
            quickRow={quick ? (
                <CapsuleQuickActions
                    slotPrimary={slotPrimary}
                    slotSecondary={slotSecondary}
                    context={slotContext}
                    isDaylight={isDaylight}
                    touch={quick.touch}
                    limit={quick.limit}
                    inline
                />
            ) : null}
            titleRow={titleRow}
            progressRow={progressRow}
            cover={cover}
            meta={meta}
            primaryColor={primaryColor}
            slotPrimary={(
                <PlayerControlSlotButton
                    actionId={slotPrimary}
                    context={slotContext}
                    primaryColor={primaryColor}
                    isDaylight={isDaylight}
                    controlsDisabled={controlsDisabled}
                    onCustomize={onCustomizePrimary}
                />
            )}
            slotSecondary={(
                <PlayerControlSlotButton
                    actionId={slotSecondary}
                    context={slotContext}
                    primaryColor={primaryColor}
                    isDaylight={isDaylight}
                    controlsDisabled={controlsDisabled}
                    onCustomize={onCustomizeSecondary}
                />
            )}
            playButton={playButton('sm')}
            hasCompanion={hasCompanion}
        />
    );
};

export default CompactCapsuleContent;
