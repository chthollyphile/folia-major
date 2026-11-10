import React from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconSwap } from './IconSwap';
import { PanelIconButton } from './PanelIconButton';

// src/components/panelTab/shell/LikeButton.tsx
// The heart of the playing song. The panel shows it in three places: on the song's one line, on
// every tab; in the row under the title on the cover tab; and, larger, among the radio's controls.

/** Whether the playing song is liked, the action, and whether it is out of reach and why. */
export type SongLike = {
    isLiked: boolean;
    onLike: () => void;
    disabled: boolean;
    disabledReason?: string;
};

type LikeButtonProps = {
    like: SongLike;
    filled?: boolean;
    /** l: the large button of the radio's controls. */
    size?: 'm' | 'l';
    /** Where it sits. */
    className?: string;
};

export const LikeButton: React.FC<LikeButtonProps> = ({ like, filled, size = 'm', className }) => {
    const { t } = useTranslation();

    return (
        <PanelIconButton
            label={like.disabledReason || (like.isLiked ? t('player.unlike') : t('player.like'))}
            size={size}
            filled={filled}
            pressed={like.isLiked}
            disabled={like.disabled}
            onClick={like.onLike}
            className={className}
            style={like.isLiked ? { color: 'var(--pn-like)' } : undefined}
        >
            {/* The heart that was just filled or emptied comes in a little small. */}
            <IconSwap name={String(like.isLiked)} speed="move">
                <Heart size={size === 'l' ? 19 : 17} fill={like.isLiked ? 'currentColor' : 'none'} />
            </IconSwap>
        </PanelIconButton>
    );
};

export default LikeButton;
