import React, { useState } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { Command, List, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openCommandFilter, openCommandPalette } from '../../stores/useAppViewStore';
import { useInteractionSettingsStore } from '../../stores/useInteractionSettingsStore';
import { usePlayerBottomBarBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';
import { SlideActionButton } from './SlideActionButton';

// Player-style grid action button: click for the list, or slide left to reveal search.
//
// Where the slide lands is a setting, so the destination is read here rather than passed in: the
// icon at the end of the track and the tooltip have to name the same place the gesture goes, and
// three grids each remembering to keep those three in step is three chances to get it wrong.
//
// The gesture itself is SlideActionButton, shared with the poster wall.
interface GridListSearchButtonProps {
    isDaylight: boolean;
    accentColor: string;
    listTitle: string;
    /** What the slide is called when it opens this surface's filter, which is the default. */
    searchTitle: string;
    onOpenList: () => void;
    /** A smaller control of the same surface, stood above the button (a grid's "locate"). */
    above?: React.ReactNode;
}

export const GridListSearchButton: React.FC<GridListSearchButtonProps> = ({
    isDaylight,
    accentColor,
    listTitle,
    searchTitle,
    onOpenList,
    above,
}) => {
    const { t } = useTranslation();
    const slideTarget = useInteractionSettingsStore(state => state.gridActionButtonSlideTarget);
    const opensPalette = slideTarget === 'command-palette';
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    // 所在的网格层已经在退场时才挂上（打开集合后马上关掉，曲目在退场开始之后才到）就不渲染：
    // 父层退场中途才挂上的带 exit 的 motion 元素，framer 会把它登记为「退场未完成」却不再给它播退场，
    // 宿主的 AnimatePresence 于是等不到完成，透明的整屏网格层卸不掉、挡住首页。挂上时在场的照常随父层淡出；
    // 退场中同一个 key 又回到场内（AnimatePresence 复用旧实例）时再挂上。
    const isPresent = useIsPresent();
    const [mountedWhilePresent, setMountedWhilePresent] = useState(isPresent);
    if (isPresent && !mountedWhilePresent) setMountedWhilePresent(true);
    if (!mountedWhilePresent) return null;

    return (
        <motion.div
            initial={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            data-testid="grid-list-search-button"
            style={{ bottom: bottomBarBottomPx }}
            className="pointer-events-auto fixed right-0 z-[60] pr-4 md:pr-8 group w-20 flex flex-col items-end gap-3"
        >
            {above}
            <SlideActionButton
                icon={List}
                title={listTitle}
                onActivate={onOpenList}
                slideIcon={opensPalette ? Command : Search}
                slideTitle={opensPalette ? t('options.gridSlideTargetCommandPalette') : searchTitle}
                onSlide={opensPalette ? openCommandPalette : openCommandFilter}
                isDaylight={isDaylight}
                accentColor={accentColor}
            />
        </motion.div>
    );
};
