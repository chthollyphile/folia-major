import React from 'react';
import { useTranslation } from 'react-i18next';
import { PLAYER_PAGE_TOUCH_GESTURES } from './userGuideContent';

// Shared touch gesture list used in both the User Guide modal (page 4) and
// the Settings → Help tab. Keeping it in a separate file avoids merge
// conflicts when upstream changes touch the parent components.

export type TouchGestureListClassNames = {
    /** List container class (default: '') */
    listClassName?: string;
    /** Individual item class */
    itemClassName: string;
    /** Item text color class */
    textPrimary: string;
    /** Gesture badge background class */
    keyBg: string;
};

export type TouchGestureListProps = TouchGestureListClassNames;

export const TouchGestureList: React.FC<TouchGestureListProps> = ({
    listClassName = '',
    itemClassName,
    textPrimary,
    keyBg,
}) => {
    const { t } = useTranslation();

    return (
        <ul className={`space-y-2 text-sm ${listClassName}`} style={{ color: 'var(--text-primary)' }}>
            {PLAYER_PAGE_TOUCH_GESTURES.map(gesture => (
                <li key={gesture.id} className={`flex items-center justify-between gap-4 ${itemClassName}`}>
                    <span className={`font-medium min-w-0 ${textPrimary}`}>
                        {t(gesture.titleKey, gesture.fallback)}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`px-2.5 py-1 rounded-md text-xs font-medium shadow-sm ${keyBg}`}>
                            {t(gesture.gestureKey, gesture.gestureFallback)}
                        </span>
                    </div>
                </li>
            ))}
        </ul>
    );
};
