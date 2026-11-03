import { useMemo } from 'react';
import { House } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import WallToolsButton from '../../wall/WallToolsButton';
import type { WallToolsQuickAction } from '../../wall/WallToolsRows';
import { GridLocateButton } from '../playing-song-locator/GridLocateButton';
import type { LatticeTile } from './latticeModel';
import { locatePlayingSongOnWall, useWallPageKey } from './wallLocate';

// src/components/app/lattice/LatticeFocusButton.tsx
// The wall's corner. A compact Lattice-only utility panel: it borrows UnifiedPanel's anchored
// glass surface without bringing its cover, tabs or player-only state into the poster wall.
// 实测反馈 1 起按钮、面板、灯光 / 叠色开关、帮助的外壳都在共享的 components/wall/WallToolsButton（bravais 也用）；
// 洗牌、主题、队列、播放器四格与音量也由 wall 从 App 的墙面工具宿主组装（与 bravais 同一套结构）。
// 这里只给 Lattice 自己的：destination（主页：总是回首页）与帮助内容，以及按钮上方的定位按钮（`above`）：
// 一个集合页的定位按钮（GridLocateButton），意思和在那里一样——正在播放的歌在这面墙上有封面时亮起，按下是向墙要
// 那张封面（wallLocate.ts）。「聚焦当前歌曲」与「切歌时自动聚焦」两项不在面板里：定位由上方的按钮做，自动聚焦的
// 开关在命令面板（「Lattice 自动聚焦」）。
export default function LatticeFocusButton({ isDaylight, tiles, onGoHome }: { isDaylight: boolean; tiles: LatticeTile[]; onGoHome?: () => void }) {
    const { t } = useTranslation();
    // The song the locator asks about (a collection's page reads the same), and this wall's question.
    const playingSongKey = usePlaybackStore(state => (state.currentSong ? getPlaybackSongKey(state.currentSong) : null));
    const pageKey = useWallPageKey();
    const isLocateAsked = usePlayingSongLocatorStore(state => state.request?.collectionKey === pageKey);
    const isPlayingSongHere = useMemo(() => (
        playingSongKey !== null && tiles.some(tile => tile.id === playingSongKey)
    ), [playingSongKey, tiles]);

    const destination: WallToolsQuickAction | undefined = onGoHome ? {
        id: 'go-home',
        icon: House,
        label: t('wallTools.goHome'),
        onSelect: onGoHome,
    } : undefined;

    return (
        <WallToolsButton
            idPrefix="lattice-tools"
            label={t('home.latticeTools')}
            isDaylight={isDaylight}
            destination={destination}
            entries={[]}
            above={playingSongKey !== null ? (
                <GridLocateButton
                    isDaylight={isDaylight}
                    accentColor="var(--text-accent)"
                    isHere={isPlayingSongHere}
                    isSeeking={isLocateAsked}
                    title={t('playlist.locatePlaying')}
                    onLocate={locatePlayingSongOnWall}
                />
            ) : undefined}
            help={(
                <>
                    <li>
                        <span>{t('home.latticeHelpPoster')}</span>
                        <span className="lattice-tools-help-key"><kbd>ESC</kbd>{t('home.latticeHelpReturn')}</span>
                    </li>
                    <li><span>{t('home.latticeHelpMove')}</span></li>
                    <li>
                        <span>{t('home.latticeHelpCommands')}</span>
                        <kbd>S</kbd>
                    </li>
                    <li>
                        <span>{t('home.latticeHelpOpen')}</span>
                        <kbd>{PRIMARY_MODIFIER_LABEL} + B</kbd>
                    </li>
                </>
            )}
        />
    );
}
