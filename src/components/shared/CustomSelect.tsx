import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Theme } from '../../types';
import {
    CustomSelectMenu,
    type CustomSelectMenuPosition,
    type CustomSelectOption,
} from './CustomSelectMenu';

// CustomSelect.tsx
// A custom dropdown select component designed to replace the browser's default select element.
// Styled to match the rest of the application, handling light/dark mode and dynamic themes.

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: CustomSelectOption[];
    placeholder?: string;
    ariaLabel?: string;
    disabled?: boolean;
    isDaylight?: boolean;
    theme?: Theme;
}

const DROPDOWN_GAP = 4;
const DROPDOWN_VIEWPORT_GUTTER = 8;
const DROPDOWN_MAX_HEIGHT = 240;
const DROPDOWN_MIN_PREFERRED_HEIGHT = 160;

export const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    placeholder = 'Select...',
    ariaLabel,
    disabled = false,
    isDaylight = false,
    theme,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [dropdownPosition, setDropdownPosition] = useState<CustomSelectMenuPosition | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Positions the portaled menu against the trigger and flips it when viewport space is limited.
    const updateDropdownPosition = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_GUTTER;
        const spaceAbove = rect.top - DROPDOWN_GAP - DROPDOWN_VIEWPORT_GUTTER;
        const useViewportPlacement = Math.max(spaceAbove, spaceBelow) < DROPDOWN_MIN_PREFERRED_HEIGHT;
        const placement: CustomSelectMenuPosition['placement'] = useViewportPlacement
            ? 'viewport'
            : spaceBelow < DROPDOWN_MIN_PREFERRED_HEIGHT && spaceAbove > spaceBelow
                ? 'top'
                : 'bottom';
        const availableHeight = placement === 'viewport'
            ? window.innerHeight - DROPDOWN_VIEWPORT_GUTTER * 2
            : placement === 'top'
                ? spaceAbove
                : spaceBelow;
        const width = Math.min(rect.width, window.innerWidth - DROPDOWN_VIEWPORT_GUTTER * 2);
        const left = Math.max(
            DROPDOWN_VIEWPORT_GUTTER,
            Math.min(rect.left, window.innerWidth - width - DROPDOWN_VIEWPORT_GUTTER),
        );

        setDropdownPosition({
            left,
            width,
            maxHeight: Math.max(
                72,
                placement === 'viewport'
                    ? availableHeight
                    : Math.min(DROPDOWN_MAX_HEIGHT, availableHeight),
            ),
            placement,
            ...(placement === 'viewport'
                ? { top: DROPDOWN_VIEWPORT_GUTTER }
                : placement === 'top'
                ? { bottom: window.innerHeight - rect.top + DROPDOWN_GAP }
                : { top: rect.bottom + DROPDOWN_GAP }),
        });
    }, []);

    // Toggle the dropdown menu visibility
    const handleToggle = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
        }
    };

    // Close the dropdown when clicking outside of the container
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                containerRef.current
                && !containerRef.current.contains(target)
                && !menuRef.current?.contains(target)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) {
            setDropdownPosition(null);
            return;
        }

        updateDropdownPosition();
        window.addEventListener('resize', updateDropdownPosition);
        window.addEventListener('scroll', updateDropdownPosition, true);
        return () => {
            window.removeEventListener('resize', updateDropdownPosition);
            window.removeEventListener('scroll', updateDropdownPosition, true);
        };
    }, [isOpen, updateDropdownPosition]);

    const selectedOption = options.find((opt) => opt.value === value);
    const accentColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');

    return (
        <div ref={containerRef} className="relative w-full">
            <button
                type="button"
                onClick={handleToggle}
                disabled={disabled}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                style={{
                    backgroundColor: 'var(--overlay-medium)',
                    borderColor: isOpen ? accentColor : 'var(--border-color)',
                    color: 'var(--text-primary)',
                    boxShadow: isOpen ? `0 0 0 1px ${accentColor}` : undefined,
                }}
            >
                <span className="truncate">
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 shrink-0 opacity-70 ${isOpen ? 'rotate-180' : ''}`}
                    style={{ color: 'var(--text-secondary)' }}
                />
            </button>

            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isOpen && dropdownPosition && (
                        <CustomSelectMenu
                            menuRef={menuRef}
                            position={dropdownPosition}
                            options={options}
                            value={value}
                            ariaLabel={ariaLabel}
                            isDaylight={isDaylight}
                            accentColor={accentColor}
                            onSelect={(nextValue) => {
                                onChange(nextValue);
                                setIsOpen(false);
                            }}
                        />
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </div>
    );
};
