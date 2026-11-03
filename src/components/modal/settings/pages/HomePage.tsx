import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    HEX_CARD_MIN_OPACITY_BOUNDS,
    HEX_CARD_MIN_OPACITY_DEFAULT,
    HEX_CARD_MIN_SCALE_BOUNDS,
    HEX_CARD_MIN_SCALE_DEFAULT,
} from '../../../../utils/hexCardFalloff';
import { chooseLibrarySuite, listLibrarySuiteOptions, useActiveLibrarySuiteId } from '../../../../library/app/librarySuiteChoice';
import { isGridLibraryActive, useIsGridLibraryActive } from '../../../../library/app/gridLibraryActive';
import { hasLibrarySuiteChoice } from '../../../../library/registry';
import { omni } from '../../../../services/onlineMusic/omni';
import { useGridViewSettingsStore } from '../../../../stores/useGridViewSettingsStore';
import { useHomeLayoutSettingsStore } from '../../../../stores/useHomeLayoutSettingsStore';
import { useOnlineProviderAccountStore } from '../../../../stores/useOnlineProviderAccountStore';
import { Button, Chips, Group, PictureChoice, Reveal, Row, Segmented, Slider, Toggle, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { BRAVAIS_WALL_OPTIONS, BravaisWallGroup } from './BravaisWallGroup';
import { GridCardsPreview, HomeCardStylePicture } from './pictures';

// src/components/modal/settings/pages/HomePage.tsx
// The 主页与歌单 page: which library UI the home screen, collections and artists are browsed in
// (only where the build has more than one), the bravais wall's own settings while it is the one in
// effect, which entries the home screen shows, and, while the grid is the one in effect, how its
// home cards are drawn and the look of the card grid a playlist or album opens into. Every library
// UI reads the entries; the card style, the remembered card and the card grid only the grid
// (isGridLibraryActive), so under another UI they are not drawn and the search leaves them out.

// The choice of suite is not part of the config export.
const SUITE: SettingsGroupDef = { id: 'librarySuite', titleKey: 'options.librarySuite', available: hasLibrarySuiteChoice };
const HOME: SettingsGroupDef = { id: 'homeScreen', titleKey: 'options.settingsHeadingHome' };
const GRID: SettingsGroupDef = { id: 'gridViewCardSettings', titleKey: 'options.gridViewCardSettings', available: isGridLibraryActive };
const GRID_ONLY = { available: isGridLibraryActive };

const O = {
    suite: option(SUITE, 'librarySuiteChoice', 'options.librarySuite'),
    tabs: option(HOME, 'homeTabsVisibility', 'options.homeTabsVisibility'),
    tabPlaylist: option(HOME, 'showHomeTabPlaylist', 'options.showHomeTabPlaylist'),
    tabRadio: option(HOME, 'showHomeTabRadio', 'options.showHomeTabRadio'),
    tabExplore: option(HOME, 'showHomeTabExplore', 'options.showHomeTabExplore'),
    tabAlbums: option(HOME, 'showHomeTabAlbums', 'options.showHomeTabAlbums'),
    tabLocal: option(HOME, 'showHomeTabLocal', 'options.showHomeTabLocal'),
    cardStyle: option(HOME, 'grid3dCardStyle', 'options.grid3dCardStyle', GRID_ONLY),
    rememberPosition: option(HOME, 'rememberHomeCardPosition', 'options.rememberHomeCardPosition', GRID_ONLY),
    fullBleedCover: option(GRID, 'gridViewFullBleedCover', 'options.gridViewFullBleedCover'),
    squareCard: option(GRID, 'gridViewSquareCard', 'options.gridViewSquareCard'),
    minCardScale: option(GRID, 'gridViewMinCardScale', 'options.gridViewMinCardScale'),
    minCardOpacity: option(GRID, 'gridViewMinCardOpacity', 'options.gridViewMinCardOpacity'),
};

export const OPTIONS: SettingsOptionDef[] = [...Object.values(O), ...BRAVAIS_WALL_OPTIONS];

const percent = (value: number) => `${Math.round(value * 100)}%`;

const HomePage: React.FC = () => {
    const { t } = useTranslation();
    const activeSuiteId = useActiveLibrarySuiteId();
    const isGridActive = useIsGridLibraryActive();
    const home = useHomeLayoutSettingsStore(useShallow(state => ({
        tabPlaylist: state.showHomeTabPlaylist,
        tabRadio: state.showHomeTabRadio,
        tabAlbums: state.showHomeTabAlbums,
        tabLocal: state.showHomeTabLocal,
        tabExplore: state.showHomeTabExplore,
        cardStyle: state.grid3dCardStyle,
        rememberPosition: state.rememberHomeCardPosition,
        setTabPlaylist: state.handleToggleHomeTabPlaylist,
        setTabRadio: state.handleToggleHomeTabRadio,
        setTabAlbums: state.handleToggleHomeTabAlbums,
        setTabLocal: state.handleToggleHomeTabLocal,
        setTabExplore: state.handleToggleHomeTabExplore,
        setCardStyle: state.handleSetGrid3dCardStyle,
        setRememberPosition: state.handleToggleRememberHomeCardPosition,
    })));
    const grid = useGridViewSettingsStore(useShallow(state => ({
        fullBleedCover: state.gridViewFullBleedCover,
        squareCards: state.gridViewSquareCards,
        minCardScale: state.gridViewMinCardScale,
        minCardOpacity: state.gridViewMinCardOpacity,
        setFullBleedCover: state.handleToggleGridViewFullBleedCover,
        setSquareCards: state.handleToggleGridViewSquareCards,
        setMinCardScale: state.handleSetGridViewMinCardScale,
        setMinCardOpacity: state.handleSetGridViewMinCardOpacity,
        resetFalloff: state.resetGridViewCardFalloff,
    })));
    // The capsule has an explore tab only where the platform in use has an explore page.
    const hasExplore = useOnlineProviderAccountStore(() => omni.getActiveCapabilities().explore === true);
    const isDefaultFalloff = grid.minCardScale === HEX_CARD_MIN_SCALE_DEFAULT && grid.minCardOpacity === HEX_CARD_MIN_OPACITY_DEFAULT;

    return (
        <>
            {hasLibrarySuiteChoice() && (
                <Group def={SUITE} bare>
                    <Row option={O.suite} note={t('options.librarySuiteDesc')}>
                        <Segmented
                            value={activeSuiteId}
                            options={listLibrarySuiteOptions().map(suite => ({ value: suite.id, label: t(suite.labelKey) }))}
                            onChange={chooseLibrarySuite}
                        />
                    </Row>
                </Group>
            )}
            <BravaisWallGroup />

            <Group def={HOME}>
                {/* The entries are one option: one row, a chip for each, named and ordered as the home screen has them. */}
                <Row option={O.tabs}>
                    <Chips
                        items={[
                            { id: O.tabPlaylist.id, label: t('home.playlists'), checked: home.tabPlaylist, onChange: home.setTabPlaylist },
                            { id: O.tabRadio.id, label: t('home.radio'), checked: home.tabRadio, onChange: home.setTabRadio },
                            { id: O.tabExplore.id, label: t('home.explore'), checked: home.tabExplore, onChange: home.setTabExplore, disabled: !hasExplore },
                            { id: O.tabAlbums.id, label: t('home.albums'), checked: home.tabAlbums, onChange: home.setTabAlbums },
                            { id: O.tabLocal.id, label: t('localMusic.folder'), checked: home.tabLocal, onChange: home.setTabLocal },
                        ]}
                    />
                </Row>
                {/* Only the grid draws the home screen as cards. */}
                {isGridActive && (
                    <>
                        <Row option={O.cardStyle} note={t('options.grid3dCardStyleDesc')}>
                            <PictureChoice
                                value={home.cardStyle}
                                options={[
                                    { value: 'image', label: t('options.grid3dCardStyleImage'), picture: <HomeCardStylePicture style="image" /> },
                                    { value: 'card', label: t('options.grid3dCardStyleCard'), picture: <HomeCardStylePicture style="card" /> },
                                ]}
                                onChange={home.setCardStyle}
                            />
                        </Row>
                        <Row option={O.rememberPosition} note={t('options.rememberHomeCardPositionDesc')}>
                            <Toggle checked={home.rememberPosition} onChange={home.setRememberPosition} />
                        </Row>
                    </>
                )}
            </Group>

            {isGridActive && (
                <Group
                    def={GRID}
                    action={(
                        <Button variant="quiet" icon={RotateCcw} onClick={grid.resetFalloff} disabled={isDefaultFalloff}>
                            {t('options.gridViewCardFalloffReset')}
                        </Button>
                    )}
                    preview={(
                        <GridCardsPreview
                            minScale={grid.minCardScale}
                            minOpacity={grid.minCardOpacity}
                            fullBleedCover={grid.fullBleedCover}
                            squareCards={grid.squareCards}
                        />
                    )}
                >
                    <Row option={O.fullBleedCover} hint={t('options.gridViewFullBleedCoverHint')} note={t('options.gridViewFullBleedCoverDesc')}>
                        <Toggle checked={grid.fullBleedCover} onChange={grid.setFullBleedCover} />
                    </Row>
                    {/* Squaring only means anything once the artwork owns the whole card. */}
                    <Reveal when={grid.fullBleedCover}>
                        <Row sub option={O.squareCard} hint={t('options.gridViewSquareCardHint')} note={t('options.gridViewSquareCardDesc')}>
                            <Toggle checked={grid.squareCards} onChange={grid.setSquareCards} />
                        </Row>
                    </Reveal>
                    <Row option={O.minCardScale} hint={t('options.gridViewMinCardScaleHint')} note={t('options.gridViewMinCardScaleDesc')}>
                        <Slider
                            value={grid.minCardScale}
                            min={HEX_CARD_MIN_SCALE_BOUNDS.min}
                            max={HEX_CARD_MIN_SCALE_BOUNDS.max}
                            step={0.01}
                            onChange={grid.setMinCardScale}
                            format={percent}
                        />
                    </Row>
                    <Row option={O.minCardOpacity} hint={t('options.gridViewMinCardOpacityHint')} note={t('options.gridViewMinCardOpacityDesc')}>
                        <Slider
                            value={grid.minCardOpacity}
                            min={HEX_CARD_MIN_OPACITY_BOUNDS.min}
                            max={HEX_CARD_MIN_OPACITY_BOUNDS.max}
                            step={0.01}
                            onChange={grid.setMinCardOpacity}
                            format={percent}
                        />
                    </Row>
                </Group>
            )}
        </>
    );
};

export default HomePage;
