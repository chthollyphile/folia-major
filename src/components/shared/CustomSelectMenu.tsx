import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

// CustomSelectMenu.tsx
// Renders the viewport-anchored option menu used by CustomSelect.

export interface CustomSelectOption {
    value: string;
    label: string;
}

export interface CustomSelectMenuPosition {
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
    placement: 'top' | 'bottom' | 'viewport';
}

interface CustomSelectMenuProps {
    menuRef: React.RefObject<HTMLDivElement | null>;
    position: CustomSelectMenuPosition;
    options: CustomSelectOption[];
    value: string;
    ariaLabel?: string;
    isDaylight: boolean;
    accentColor: string;
    onSelect: (value: string) => void;
}

export const CustomSelectMenu: React.FC<CustomSelectMenuProps> = ({
    menuRef,
    position,
    options,
    value,
    ariaLabel,
    isDaylight,
    accentColor,
    onSelect,
}) => (
    <motion.div
        ref={menuRef}
        initial={{
            opacity: 0,
            y: position.placement === 'top' ? 8 : -8,
            scale: 0.96,
        }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
            opacity: 0,
            y: position.placement === 'top' ? 8 : -8,
            scale: 0.96,
        }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="fixed z-[200] rounded-xl border shadow-xl overflow-y-auto overscroll-contain backdrop-blur-md custom-scrollbar"
        data-wheel-scroll-region
        role="listbox"
        aria-label={ariaLabel}
        style={{
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: position.width,
            maxHeight: position.maxHeight,
            backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(24, 24, 27, 0.96)',
            borderColor: 'var(--border-color)',
        }}
    >
        <div className="p-1.5 space-y-0.5">
            {options.map((option) => {
                const isSelected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => onSelect(option.value)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors text-left cursor-pointer"
                        style={{
                            color: 'var(--text-primary)',
                            backgroundColor: isSelected
                                ? (isDaylight ? `${accentColor}12` : `${accentColor}18`)
                                : 'transparent',
                        }}
                        onMouseEnter={(event) => {
                            if (!isSelected) {
                                event.currentTarget.style.backgroundColor = isDaylight
                                    ? 'rgba(0, 0, 0, 0.04)'
                                    : 'rgba(255, 255, 255, 0.06)';
                            }
                        }}
                        onMouseLeave={(event) => {
                            if (!isSelected) {
                                event.currentTarget.style.backgroundColor = 'transparent';
                            }
                        }}
                    >
                        <span className="truncate mr-2">{option.label}</span>
                        {isSelected && (
                            <Check
                                size={14}
                                className="shrink-0"
                                style={{ color: accentColor }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    </motion.div>
);
