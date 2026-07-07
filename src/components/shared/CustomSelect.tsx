import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { Theme } from '../../types';

// CustomSelect.tsx
// A custom dropdown select component designed to replace the browser's default select element.
// Styled to match the rest of the application, handling light/dark mode and dynamic themes.

interface Option {
    value: string;
    label: string;
}

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    isDaylight?: boolean;
    theme?: Theme;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    placeholder = 'Select...',
    disabled = false,
    isDaylight = false,
    theme,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Toggle the dropdown menu visibility
    const handleToggle = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
        }
    };

    // Close the dropdown when clicking outside of the container
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const selectedOption = options.find((opt) => opt.value === value);
    const accentColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');

    return (
        <div ref={containerRef} className="relative w-full">
            <button
                type="button"
                onClick={handleToggle}
                disabled={disabled}
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

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 4, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="absolute left-0 right-0 z-50 rounded-xl border shadow-xl overflow-hidden max-h-60 overflow-y-auto backdrop-blur-md custom-scrollbar"
                        style={{
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
                                        onClick={() => {
                                            onChange(option.value);
                                            setIsOpen(false);
                                        }}
                                        className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors text-left cursor-pointer"
                                        style={{
                                            color: 'var(--text-primary)',
                                            backgroundColor: isSelected
                                                ? (isDaylight ? `${accentColor}12` : `${accentColor}18`)
                                                : 'transparent',
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isSelected) {
                                                e.currentTarget.style.backgroundColor = isDaylight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected) {
                                                e.currentTarget.style.backgroundColor = 'transparent';
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
                )}
            </AnimatePresence>
        </div>
    );
};
