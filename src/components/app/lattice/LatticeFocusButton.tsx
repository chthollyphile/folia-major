import { useMemo } from 'react';
import { Focus, GalleryHorizontal, House } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import WallToolsButton from '../../wall/WallToolsButton';
import type { WallToolsEntry, WallToolsQuickAction } from '../../wall/WallToolsRows';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { GridLocateButton } from '../playing-song-locator/GridLocateButton';
import { useRegisterWallLocate } from '../playing-song-locator/useRegisterWallLocate';
import type { LatticeTile } from './latticeModel';
import { locatePlayingSongOnWall, useWallPageKey } from './wallLocate';

// src/components/app/lattice/LatticeFocusButton.tsx
// The wall's corner. A compact Lattice-only utility panel: it borrows UnifiedPanel's anchored
// glass surface without bringing its cover, tabs or player-only state into the poster wall.
// 实测反馈 1 起按钮、面板、灯光 / 叠色开关、帮助的外壳都在共享的 components/wall/WallToolsButton（bravais 也用）；
// 洗牌、主题、队列、播放器四格与音量也由 wall 从 App 的墙面工具宿主组装（与 bravais 同一套结构）。
// 这里只给 Lattice 自己的：destination（主页：总是回首页）与帮助内容，以及按钮上方的定位按钮（`above`）：
// 一个集合页的定位按钮（GridLocateButton），意思和在那里一样——正在播放的歌在这面墙上有封面时亮起，按下是向墙要
// 那张封面（wallLocate.ts）。「聚焦当前歌曲」不在面板里，定位由上方的按钮做。
// 「切歌时自动聚焦」是面板里的一个开关（命令面板的「Lattice 自动聚焦」是同一个设置），只在海报墙上给：
// 跟随切歌只有 PosterWall（useLatticePlaybackFocus）读这个设置，电台墙不读，那里不画这一行。
// 电台墙（isRadio）：定位按钮同样在这里，按下回到正在播放那张（浏览到别处时用；RadioWall 答这一问）；帮助换成电台墙的操作。
// 播放队列的墙（showsWallForm）面板里有一格「墙面形态」：海报墙 / 电台墙来回切；私人 FM 下固定是电台墙，这一格置灰。
export default function LatticeFocusButton({ isDaylight, tiles, isRadio = false, showsWallForm = false, onGoHome }: {
    isDaylight: boolean;
    tiles: LatticeTile[];
    isRadio?: boolean;
    /** 这面墙画的是播放队列（不是探索页的条目）：面板里给切换墙面形态的那一格。 */
    showsWallForm?: boolean;
    onGoHome?: () => void;
}) {
    const { t } = useTranslation();
    // The song the locator asks about (a collection's page reads the same), and this wall's question.
    const playingSongKey = usePlaybackStore(state => (state.currentSong ? getPlaybackSongKey(state.currentSong) : null));
    const pageKey = useWallPageKey();
    const isLocateAsked = usePlayingSongLocatorStore(state => state.request?.collectionKey === pageKey);
    const isPlayingSongHere = useMemo(() => (
        playingSongKey !== null && tiles.some(tile => tile.id === playingSongKey)
    ), [playingSongKey, tiles]);

    const wallForm = useLatticeSettingsStore(state => state.latticeWallForm);
    const setWallForm = useLatticeSettingsStore(state => state.handleSetLatticeWallForm);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const autoFocusOnSongChange = useLatticeSettingsStore(state => state.autoFocusOnSongChange);
    const handleToggleAutoFocusOnSongChange = useLatticeSettingsStore(state => state.handleToggleAutoFocusOnSongChange);
    const entries = useMemo((): WallToolsEntry[] => [
        ...(showsWallForm ? [{
            kind: 'action',
            id: 'lattice-wall-form',
            icon: GalleryHorizontal,
            label: t('options.latticeWallForm'),
            value: t(isFmMode ? 'options.latticeWallForm_radio' : `options.latticeWallForm_${wallForm}`),
            disabled: isFmMode,
            hint: isFmMode ? t('wallTools.wallFormFixedInFm') : undefined,
            keepOpen: true,
            onSelect: () => setWallForm(wallForm === 'radio' ? 'poster' : 'radio'),
        } satisfies WallToolsEntry] : []),
        ...(isRadio ? [] : [{
            kind: 'toggle',
            id: 'lattice-auto-focus',
            icon: Focus,
            label: t('options.latticeAutoFocusOnSongChange'),
            checked: autoFocusOnSongChange,
            onToggle: handleToggleAutoFocusOnSongChange,
        } satisfies WallToolsEntry]),
    ], [autoFocusOnSongChange, handleToggleAutoFocusOnSongChange, isFmMode, isRadio, setWallForm, showsWallForm, t, wallForm]);

    const destination: WallToolsQuickAction | undefined = onGoHome ? {
        id: 'go-home',
        icon: House,
        label: t('wallTools.goHome'),
        onSelect: onGoHome,
    } : undefined;

    // 紧凑档里上方的定位按钮不画，定位由进度条胶囊的封面按（progress-bar v3）。
    const locates = playingSongKey !== null;
    const locateTitle = t(isRadio ? 'home.latticeRadioBackToNow' : 'playlist.locatePlaying');
    useRegisterWallLocate('lattice', locates ? {
        run: locatePlayingSongOnWall,
        isHere: isPlayingSongHere,
        isSeeking: isLocateAsked,
        title: locateTitle,
    } : null, true);

    return (
        <WallToolsButton
            idPrefix="lattice-tools"
            label={t('home.latticeTools')}
            isDaylight={isDaylight}
            destination={destination}
            entries={entries}
            above={locates ? (
                <GridLocateButton
                    isDaylight={isDaylight}
                    accentColor="var(--text-accent)"
                    isHere={isPlayingSongHere}
                    isSeeking={isLocateAsked}
                    title={locateTitle}
                    onLocate={locatePlayingSongOnWall}
                />
            ) : undefined}
            help={(
                <>
                    <li>
                        <span>{t(isRadio ? 'home.latticeRadioHelpCard' : 'home.latticeHelpPoster')}</span>
                        <span className="lattice-tools-help-key"><kbd>ESC</kbd>{t('home.latticeHelpReturn')}</span>
                    </li>
                    <li><span>{t(isRadio ? 'home.latticeRadioHelpMove' : 'home.latticeHelpMove')}</span></li>
                    {!isRadio && (
                        <li>
                            <span>{t('home.latticeHelpCommands')}</span>
                            <kbd>S</kbd>
                        </li>
                    )}
                    <li>
                        <span>{t('home.latticeHelpOpen')}</span>
                        <kbd>{PRIMARY_MODIFIER_LABEL} + B</kbd>
                    </li>
                </>
            )}
        />
    );
}
