import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Map as MapIcon } from 'lucide-react';
import GridMap from '../GridMap';
import { Theme } from '../../types';
import { Grid3DSlider, Grid3DSliderItem } from './Grid3DSlider';

// src/components/folia-grid/DesktopGrid3DSurface.tsx
// Shared desktop home surface that keeps Grid3D slider and GridMap controls visually consistent.

export interface DesktopGrid3DAction {
    id: string;
    label: React.ReactNode;
    icon?: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    title?: string;
}

interface DesktopGrid3DSurfaceProps {
    title: string;
    mapButtonLabel: string;
    items: Grid3DSliderItem[];
    focusedIndex: number;
    onFocusedIndexChange: (index: number) => void;
    onSelect: (item: Grid3DSliderItem, index: number) => void;
    actions?: DesktopGrid3DAction[];
    isInteractive?: boolean;
    isLoading?: boolean;
    emptyMessage?: string;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
}

export const DesktopGrid3DSurface: React.FC<DesktopGrid3DSurfaceProps> = ({
    title,
    mapButtonLabel,
    items,
    focusedIndex,
    onFocusedIndexChange,
    onSelect,
    actions = [],
    isInteractive = true,
    isLoading = false,
    emptyMessage,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
}) => {
    const [showGridMap, setShowGridMap] = useState(false);

    return (
        <div className="w-full h-full min-h-0 flex flex-col justify-center relative">
            {!isLoading && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShowGridMap(true)}
                        className="px-4 py-2 rounded-full flex items-center gap-2 text-xs font-semibold shadow-lg backdrop-blur-md transition-all border border-white/10"
                        style={{
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.7)' : 'rgba(25,25,25,0.7)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        <MapIcon size={14} />
                        <span>{mapButtonLabel}</span>
                    </motion.button>
                </div>
            )}

            {actions.length > 0 && (
                <div className="absolute top-2 right-4 z-10 flex max-w-[min(44rem,calc(50%-7rem))] flex-wrap items-center justify-end gap-2">
                    {actions.map(action => (
                        <button
                            key={action.id}
                            onClick={action.onClick}
                            disabled={action.disabled}
                            title={action.title}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-lg backdrop-blur-md border border-white/10 flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45 ${
                                action.active ? 'opacity-100' : 'opacity-55 hover:opacity-90'
                            }`}
                            style={{
                                backgroundColor: action.active
                                    ? (isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)')
                                    : (isDaylight ? 'rgba(255,255,255,0.62)' : 'rgba(25,25,25,0.58)'),
                                color: 'var(--text-primary)',
                            }}
                        >
                            {action.icon}
                            <span>{action.label}</span>
                        </button>
                    ))}
                </div>
            )}

            <Grid3DSlider
                items={items}
                focusedIndex={focusedIndex}
                onFocusedIndexChange={onFocusedIndexChange}
                onSelect={onSelect}
                isInteractive={isInteractive && !showGridMap}
                isLoading={isLoading}
                emptyMessage={emptyMessage}
                isDaylight={isDaylight}
                hasFloatingPlayer={hasFloatingPlayer}
            />

            <AnimatePresence>
                {showGridMap && (
                    <GridMap
                        title={title}
                        items={items.map(item => ({
                            id: item.id,
                            name: typeof item.name === 'string' || typeof item.name === 'number' ? String(item.name) : '',
                            coverUrl: item.coverUrl,
                            description: item.description,
                            summary: item.summary,
                            rawCollection: item,
                        }))}
                        onBack={() => setShowGridMap(false)}
                        onSelectCollection={(_, index) => {
                            setShowGridMap(false);
                            onFocusedIndexChange(index);
                        }}
                        theme={theme}
                        isDaylight={isDaylight}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default DesktopGrid3DSurface;
