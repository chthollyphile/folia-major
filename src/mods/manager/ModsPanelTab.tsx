import React from 'react';
import { motion } from 'framer-motion';
import { Boxes } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { ModManager } from './ModManager';
import { ModSystemSwitch } from './ModSystemSwitch';
import { modManagerClassesFor } from './modManagerClasses';

// src/mods/manager/ModsPanelTab.tsx
// The mod manager as the command palette's `mods` surface. It is the same switch card and list the
// settings page's mod section renders (src/mods/manager/), under a title row of its own because the
// palette has no section heading to borrow. The whole mod system stays self-contained behind the
// store.

const ModsPanelTab: React.FC<{ theme: Theme | null }> = ({ theme }) => {
    const { t } = useTranslation();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const classes = modManagerClassesFor(isDaylight);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                <Boxes size={16} style={{ color: theme?.accentColor }} />
                {t('mods.title')}
            </div>
            <ModSystemSwitch classes={classes} theme={theme} />
            <ModManager classes={classes} isDaylight={isDaylight} theme={theme} />
        </motion.div>
    );
};

export default ModsPanelTab;
