import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import { PlayerState, type SongResult, type LyricData } from '../../../types';
import type { OmniCollection, OmniProviderId } from '../../../types/onlineMusic';
import LatticePlaybackProvider, { type LatticePlaybackActions } from './LatticePlaybackProvider';
import { LatticeTransportContext, type LatticeTransport } from './LatticeTransportContext';
import PosterWall from './PosterWall';
import LatticeFocusButton from './LatticeFocusButton';
import WallBackButton from '../../wall/WallBackButton';
import { buildLatticeTiles, type LatticeTile } from './latticeModel';
import { useStableCallbacks } from '../../../hooks/useStableCallbacks';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { countRender } from '../../../dev/renderCount';
import '../../wall/wall.css';
import './Lattice.css';
import LatticeLyricsProvider from './lyrics/LatticeLyricsProvider';
import type { LatticeLyricSource } from './lyrics/types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { isPrimaryModifierPressed, isSecondaryModifierPressed } from '../../../utils/platform';
import { isTextEntryTarget } from '../../../utils/keyboardTargets';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../stores/useWallHandoffStore';
import { useExploreWall } from './useExploreWall';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { isFlightBackArmed, planPageFromWall } from './wallFlight';
import { beginWallTrip, WallTripLog } from './wallTripLog';
import { LATTICE_WALL_ATTR } from '../../collectionFlight';

// The wall's display layer. It renders the play queue and never mutates it; opened from the
// explore tab (`latticeSource` in useAppViewStore) it renders the explore page's entries in the
// queue's place (useExploreWall.ts), and the queue stays what the player plays.
// 翻牌交接（设计稿 §7「进入队列」，与资料库墙 bravais）：根节点挂 data-wall-handoff（in / out）与阶段。叠在资料库墙上面的
// 这段时间里墙面底色不画（下面那面墙的墙面就是同一份），颗粒与暗角由上面这层统一画一份（见 Lattice.css）。

type LatticeProps = {
    controls: LatticePlaybackActions;
    lyrics: LyricData | null;
    lyricSource: LatticeLyricSource;
    lyricKeywordColoringEnabled: boolean;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    /** The lyric clock, for the lyric timeline: media time + preview clip start - manual lyric offset. */
    lyricCurrentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    queue: SongResult[];
    isDaylight: boolean;
    onBack: () => void;
    /** 工具面板的「主页」：总是回首页（左上角返回仍是历史返回）；缺省时没有那一格。 */
    onGoHome?: () => void;
    onOpenPlayer: () => void;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    /** For a wall of the explore page's entries: the provider and the account the explore tab shows its page for. */
    exploreProviderId?: OmniProviderId;
    exploreAccountId?: string;
    /** For a wall of the explore page's entries: opens a collection's page, as the explore tab does for a card. */
    onOpenCollection?: (collection: OmniCollection) => void;
};

export default function Lattice({
    controls,
    lyrics,
    lyricSource,
    lyricKeywordColoringEnabled,
    currentSong,
    playerState,
    currentTime,
    lyricCurrentTime,
    playbackDuration,
    canTogglePlayback,
    queue,
    isDaylight,
    onBack,
    onGoHome,
    onOpenPlayer,
    onPlaySong,
    onTogglePlayback,
    onSeek,
    exploreProviderId,
    exploreAccountId = '',
    onOpenCollection,
}: LatticeProps) {
    countRender('Lattice');
    const { t } = useTranslation();
    const vignette = useLatticeSettingsStore(state => state.latticeVignette);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const posterTintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const posterTintUseCustomColor = useLatticeSettingsStore(state => state.latticePosterTintUseCustomColor);
    const posterTintColor = useLatticeSettingsStore(state => state.latticePosterTintColor);
    const posterTintIntensity = useLatticeSettingsStore(state => state.latticePosterTintIntensity);
    // Set by the way the wall was opened, and the same for as long as it is up.
    const isExplore = useAppViewStore(state => state.latticeSource) === 'explore';
    const explore = useExploreWall({ isOn: isExplore, currentSong, providerId: exploreProviderId, accountId: exploreAccountId });
    const queueTiles = useMemo(() => buildLatticeTiles({ queue, currentSong }), [currentSong, queue]);
    const tiles = isExplore ? explore.tiles : queueTiles;
    // The tile whose collection page the wall was left for, when this is the way back from that
    // page: the wall opens on it. Read once and let go of, so that no later opening starts there.
    // Let go of again when the view comes back to a wall that is still up: Back, pressed while
    // the wall leaves for the page, calls this same wall back, and nothing mounts to read the tile.
    const [startTileId] = useState(() => useAppViewStore.getState().latticeReturnTileId);
    useEffect(() => {
        useAppViewStore.getState().setLatticeReturnTileId(null);
        return useAppViewStore.subscribe((state, before) => {
            if (state.view === 'lattice' && before.view !== 'lattice') state.setLatticeReturnTileId(null);
        });
    }, []);
    const isReturn = startTileId !== null;
    // The cover of a collection's tile flies to the tile's page, and back from it
    // (the grid's morph, wallFlight.ts), unless motion is reduced for that flight or for the wall.
    const reducedMotion = useReducedMotionFor('lattice');
    const coverFlies = !useReducedMotionFor('collectionMorph') && !reducedMotion;
    // Come back to with a flight armed, the wall has the page under it and fades in over it.
    // With none armed nothing is under the wall, which may be the bare window (the app's
    // background can be see-through): it is put up at once. (wallLayer.ts asks the same, to keep
    // the visualizer under a wall that fades in until that wall covers it.)
    const [fadesIn] = useState(() => isReturn && isFlightBackArmed());
    const handoffSession = useWallHandoffStore(state => state.session);
    const handoffRole = resolveWallHandoffRole(handoffSession, 'lattice');
    const handoffPhase = handoffSession?.phase;
    const handoffFlip = handoffSession?.mode === 'flip';
    // 墙面底色：进来时整段不画（资料库墙在下面），离开时开翻起不画（下面的资料库墙已经画好）。
    const surfaceOff = handoffFlip && (handoffRole === 'in' || handoffPhase !== 'waiting');
    // 颗粒与暗角：进来的 closing 里交给下面的资料库墙（两份叠着会压暗两遍），开翻起由这层画；离开时一直由这层画，
    // 只有下面是透光档（没有颗粒）时颗粒在开翻后淡掉。
    const overlaysOff = handoffFlip && handoffRole === 'in' && handoffPhase === 'closing';
    const grainOff = overlaysOff || (handoffFlip && handoffRole === 'out' && handoffPhase !== 'waiting' && handoffSession?.seeThrough === true);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // 别处已经用掉的按键（defaultPrevented）与正在打字的输入框（例如工具面板队列浮岛的歌单名输入）里不接 Ctrl+B。
            if (event.defaultPrevented
                || isTextEntryTarget(event.target)
                || event.repeat
                || event.key.toLowerCase() !== 'b'
                || !isPrimaryModifierPressed(event)
                || isSecondaryModifierPressed(event)
                || event.altKey
                || event.shiftKey
            ) return;

            event.preventDefault();
            onBack();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onBack]);

    // App rebuilds these on every render of its own, and the wall hands them to every poster on
    // screen. Given a permanent identity here they stop being a reason for those posters to render.
    const wall = useStableCallbacks({
        // The card's own action. A song is played: within the queue there is on the queue wall,
        // with the songs of its section on the explore wall, as the explore page plays it. A
        // collection's page is opened; the wall is taken down meanwhile, and Back opens it on
        // this tile again. The tile, which is the grown one, is the card whose cover flies to
        // the page: captured, and the page's plan made, before the navigation (wallFlight.ts).
        // A wall that has been left stays on the screen, and can be pressed, while it leaves:
        // a press then (Open pressed twice, Enter held down) opens no page and plays no song.
        onPlay: (tile: LatticeTile) => {
            const appView = useAppViewStore.getState();
            if (appView.view !== 'lattice') return;
            if (tile.kind === 'song') {
                onPlaySong(tile.song, tile.queue ?? queue);
                return;
            }
            beginWallTrip('open');
            planPageFromWall(coverFlies);
            appView.setLatticeReturnTileId(tile.id);
            appView.setIsLatticeLeftForPage(true);
            onOpenCollection?.(tile.collection);
        },
        onTogglePlayback,
        onSeek,
        onOpenPlayer,
    });

    // Recomputed only when transport state actually moves, so the expanded chrome is the only
    // subscriber that re-renders on a pause, a resume or a duration update.
    const transport = useMemo<LatticeTransport>(
        () => ({ currentSong, playerState, currentTime, playbackDuration, canTogglePlayback }),
        [canTogglePlayback, currentSong, currentTime, playbackDuration, playerState],
    );
    return (
        <LatticeTransportContext.Provider value={transport}>
        <LatticePlaybackProvider actions={controls} currentSong={currentSong} queue={queue} lyrics={lyrics}
            currentTime={currentTime} lyricCurrentTime={lyricCurrentTime} duration={playbackDuration} onSeek={onSeek} isDaylight={isDaylight}>
        <LatticeLyricsProvider source={lyricSource} songKey={currentSong ? getPlaybackSongKey(currentSong) : ''}
            keywordColoringEnabled={lyricKeywordColoringEnabled}>
        <section
            className={`lattice-root lattice-queue-root ${isDaylight ? 'is-daylight' : ''} ${vignette ? 'has-vignette' : ''} ${lightsOn ? '' : 'is-lights-out'} ${posterTintEnabled ? 'has-poster-tint' : ''} ${posterTintUseCustomColor ? 'uses-custom-poster-tint' : ''} ${surfaceOff ? 'is-handoff-surface-off' : ''} ${fadesIn && !reducedMotion ? 'is-returning' : ''}`}
            data-wall-handoff={handoffRole ?? undefined}
            data-wall-handoff-phase={handoffPhase}
            data-wall-handoff-mode={handoffSession?.mode}
            data-wall-handoff-see-through={handoffSession?.seeThrough || undefined}
            data-wall-handoff-vignette={overlaysOff ? 'off' : undefined}
            data-wall-handoff-grain={grainOff ? 'off' : undefined}
            style={{
                '--lattice-poster-tint-color': posterTintColor,
                '--lattice-poster-tint-intensity': posterTintIntensity,
            } as CSSProperties}
            aria-label={t(isExplore ? 'home.latticeExplore' : 'home.latticeLabel')}
            {...{ [LATTICE_WALL_ATTR]: '' }}
        >
            <PosterWall
                tiles={tiles}
                sections={isExplore ? explore.sections : undefined}
                startTileId={startTileId}
                currentSong={currentSong}
                isDaylight={isDaylight}
                onPlay={wall.onPlay}
                onTogglePlayback={wall.onTogglePlayback}
                onSeek={wall.onSeek}
                onOpenPlayer={wall.onOpenPlayer}
                onBack={onBack}
            />
            <WallTripLog isReturn={isReturn} />
            <LatticeFocusButton isDaylight={isDaylight} tiles={tiles} onGoHome={onGoHome} />
            <WallBackButton label={t('home.latticeBack')} onBack={onBack} />
            {/* The explore page's own control, beside the way back: other entries take the tiles' places. */}
            {isExplore && (
                // A press with the mouse leaves the focus where it is: the wall's arrow keys and Escape
                // are handled on .lattice-field, and reach it only while the focus is inside it. From
                // the keyboard the button is reached and pressed as any other, and holds the focus
                // then: so `aria-disabled` and not `disabled` (a disabled button cannot hold the focus).
                <button type="button" className="lattice-back lattice-refresh mx-[5px]" aria-disabled={!explore.canRefresh}
                    data-glass data-glass-light data-glass-jelly
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => { if (explore.canRefresh) explore.refresh(); }}
                    aria-label={t('home.exploreRefresh')} title={t('home.exploreRefresh')}>
                    <RefreshCw size={18} className={explore.isRefreshing ? 'animate-spin' : ''} />
                </button>
            )}
            {tiles.length === 0 && (isExplore ? explore.emptyText && (
                <div className="lattice-empty">
                    <strong>{t(explore.emptyText)}</strong>
                </div>
            ) : (
                <div className="lattice-empty">
                    <strong>{t('home.latticeEmptyTitle')}</strong>
                    <span>{t('home.latticeEmptyText')}</span>
                </div>
            ))}
        </section>
        </LatticeLyricsProvider>
        </LatticePlaybackProvider>
        </LatticeTransportContext.Provider>
    );
}
