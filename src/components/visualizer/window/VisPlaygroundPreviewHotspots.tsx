import React from 'react';
import { type Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';

// src/components/visualizer/window/VisPlaygroundPreviewHotspots.tsx
// Transparent click targets that map preview regions to the right-side settings panel.
export type VisPlaygroundEditSection = 'common' | 'background' | 'visualizer' | 'subtitle' | 'global';
export type VisPlaygroundHotspotSection = Exclude<VisPlaygroundEditSection, 'common' | 'global'>;

interface HotspotConfig {
    section: VisPlaygroundHotspotSection;
    label: string;
    className: string;
    labelClassName: string;
}

interface VisPlaygroundPreviewHotspotsProps {
    activeSection: VisPlaygroundEditSection;
    onSectionChange: (section: VisPlaygroundEditSection) => void;
    theme: Theme;
    labels: Record<VisPlaygroundHotspotSection, string>;
}

const VisPlaygroundPreviewHotspots: React.FC<VisPlaygroundPreviewHotspotsProps> = ({
    activeSection,
    onSectionChange,
    theme,
    labels,
}) => {
    const [visibleSection, setVisibleSection] = React.useState<VisPlaygroundEditSection | null>(null);
    const hotspots: HotspotConfig[] = [
        {
            section: 'background',
            label: labels.background,
            className: 'left-4 right-4 top-4 h-[20%]',
            labelClassName: 'left-5 top-5',
        },
        {
            section: 'visualizer',
            label: labels.visualizer,
            className: 'left-[10%] right-[10%] top-[28%] h-[48%]',
            labelClassName: 'left-5 top-5',
        },
        {
            section: 'subtitle',
            label: labels.subtitle,
            className: 'left-4 right-4 bottom-6 h-[18%]',
            labelClassName: 'left-1/2 bottom-4 -translate-x-1/2',
        },
    ];

    return (
        <div className="absolute inset-0 z-30 pointer-events-none">
            {hotspots.map(hotspot => {
                const isActive = activeSection === hotspot.section;
                const isVisible = visibleSection === hotspot.section;
                const borderColor = !isVisible
                    ? 'transparent'
                    : isActive
                        ? theme.accentColor
                        : colorWithAlpha(theme.secondaryColor, 0.24);
                const labelBackground = isActive
                    ? colorWithAlpha(theme.accentColor, 0.18)
                    : colorWithAlpha(theme.backgroundColor, 0.72);

                return (
                    <button
                        key={hotspot.section}
                        type="button"
                        aria-pressed={isActive}
                        onClick={(event) => {
                            event.stopPropagation();
                            onSectionChange(hotspot.section);
                        }}
                        onMouseEnter={() => setVisibleSection(hotspot.section)}
                        onMouseLeave={() => setVisibleSection(previous => previous === hotspot.section ? null : previous)}
                        onFocus={() => setVisibleSection(hotspot.section)}
                        onBlur={() => setVisibleSection(previous => previous === hotspot.section ? null : previous)}
                        className={`group absolute rounded-[24px] border text-left outline-none transition-all duration-200 pointer-events-auto ${hotspot.className}`}
                        style={{
                            borderColor,
                            backgroundColor: isVisible && isActive
                                ? colorWithAlpha(theme.accentColor, 0.08)
                                : 'transparent',
                            boxShadow: isVisible && isActive
                                ? `inset 0 0 0 1px ${colorWithAlpha(theme.accentColor, 0.56)}, 0 18px 48px ${colorWithAlpha(theme.accentColor, 0.12)}`
                                : 'none',
                        }}
                    >
                        <span
                            className={`absolute rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md transition-opacity ${isVisible ? 'opacity-100' : 'opacity-0'} ${hotspot.labelClassName}`}
                            style={{
                                color: isActive ? theme.primaryColor : theme.secondaryColor,
                                borderColor,
                                backgroundColor: labelBackground,
                            }}
                        >
                            {hotspot.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

export default VisPlaygroundPreviewHotspots;
