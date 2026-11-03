import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Cpu, Database, Monitor, Settings2, Sparkles } from 'lucide-react';
import { PageHeader } from '../../src/components/modal/settings/kit';
import { settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { SettingsAnchor, SettingsAnchorProvider, useSettingsAnchorList, useSettingsAnchorStore } from '../../src/components/modal/settings/navigation/SettingsAnchorContext';
import SettingsSectionHeading from '../../src/components/modal/settings/navigation/SettingsSectionHeading';
import SettingsSideList from '../../src/components/modal/settings/navigation/SettingsSideList';
import type { SettingsAnchorId } from '../../src/components/modal/settings/navigation/settingsAnchorModel';
import { buildSettingsNavGroups, type SettingsSectionId } from '../../src/components/modal/settings/navigation/settingsNavModel';
import { useMediaQuery } from '../../src/hooks/useMediaQuery';
import { useSettingsScrollSpy } from '../../src/hooks/useSettingsScrollSpy';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/settingsNavigation.probe.tsx

/**
 * 设置弹窗的导航层：只列类别的侧栏、页眉里的本页目录和 scrollspy。
 *
 * 只挂导航层，不挂真的 SettingsModal（它有近百个 props）。假内容列里的小节高度刻意拉开差距，
 * 并且有一个小节延迟三帧才出现，用来复刻 Integration 里那些等异步状态才渲染的区块。
 * 页眉的目录来自实际的锚点注册表，它同时负责 scrollspy 和目标滚动；探针页开着
 * StrictMode，正好压 register/unregister/register 这条最容易翻车的路径。
 */
const SECTIONS = [
    { id: 'lyricsRenderer', label: 'Alpha Section', icon: Sparkles, height: 700 },
    { id: 'themePresets', label: 'Bravo Section', icon: Monitor, height: 260 },
    { id: 'stageTrackPill', label: 'Charlie Section', icon: Cpu, height: 900 },
    { id: 'grid3dCardStyle', label: 'Delta Section', icon: Database, height: 320 },
    { id: 'latticeSettings', label: 'Echo Section', icon: Boxes, height: 480 },
] as const satisfies ReadonlyArray<{ id: SettingsAnchorId; label: string; icon: typeof Sparkles; height: number }>;

/** Stands in for a section gated on an async status that has not arrived yet. */
const LATE_SECTION = { id: 'importExportTitle', label: 'Bravo Late Section', icon: Settings2, height: 300 } as const;

const LABELS: Record<string, string> = {
    'options.settingsGroupInterface': 'Interface',
    'options.settingsGroupMusic': 'Music',
    'options.settingsGroupApp': 'App',
    'options.settingsGroupAdvanced': 'Advanced',
};

/** Stands in for i18n so the probe reads the same as the shipped English copy. */
const fakeTranslate = (key: string): string => LABELS[key] ?? (key.split('.').pop() ?? key);

const useDelayedMount = (frames: number): boolean => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        let remaining = frames;
        let raf = 0;
        const tick = () => {
            remaining -= 1;
            if (remaining <= 0) {
                setMounted(true);
                return;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [frames]);

    return mounted;
};

const ProbeBody: React.FC = () => {
    const store = useSettingsAnchorStore();
    const anchors = useSettingsAnchorList(store);
    const contentRef = useRef<HTMLDivElement>(null);
    const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance');
    const isWide = useMediaQuery('(min-width: 768px)');
    const showLate = useDelayedMount(4);

    const groups = useMemo(() => buildSettingsNavGroups(fakeTranslate, { isElectron: true }), []);
    const { activeAnchorId, scrollToAnchor } = useSettingsScrollSpy({
        containerRef: contentRef,
        anchors,
        enabled: true,
        reducedMotion: false,
    });

    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = 0;
        }
    }, [activeSection]);

    return (
        <SettingsAnchorProvider store={store}>
            <div
                className="h-screen bg-zinc-950 p-6"
                style={{
                    '--text-primary': DEFAULT_THEME.primaryColor,
                    '--text-secondary': DEFAULT_THEME.secondaryColor,
                } as React.CSSProperties}
            >
                <div
                    className="flex h-full flex-col overflow-hidden rounded-2xl bg-[var(--st-win)] md:grid md:grid-cols-[212px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
                    style={settingsTokens(false, DEFAULT_THEME)}
                >
                    <SettingsSideList
                        groups={groups}
                        activeId={activeSection}
                        onSelectSection={setActiveSection}
                        onSelectHelp={() => {}}
                        query=""
                        onQueryChange={() => {}}
                        onSubmitQuery={() => {}}
                        isWide={isWide}
                    />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <PageHeader
                            title={fakeTranslate(`options.${activeSection}`)}
                            contents={anchors}
                            activeId={activeAnchorId}
                            onSelect={scrollToAnchor}
                            closeLabel="Close"
                            onClose={() => {}}
                        />
                        <div ref={contentRef} data-probe-content className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-8">
                            <div className="space-y-8">
                                {SECTIONS.map(section => (
                                    <React.Fragment key={section.id}>
                                        <SettingsAnchor anchorId={section.id} label={section.label}>
                                            <SettingsSectionHeading icon={section.icon} label={section.label} />
                                            <div
                                                className="rounded-xl border border-white/10 bg-white/5"
                                                style={{ height: section.height }}
                                            />
                                        </SettingsAnchor>
                                        {section.id === 'themePresets' && showLate && (
                                            <SettingsAnchor anchorId={LATE_SECTION.id} label={LATE_SECTION.label}>
                                                <SettingsSectionHeading icon={LATE_SECTION.icon} label={LATE_SECTION.label} />
                                                <div
                                                    className="rounded-xl border border-white/10 bg-white/5"
                                                    style={{ height: LATE_SECTION.height }}
                                                />
                                            </SettingsAnchor>
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </SettingsAnchorProvider>
    );
};

const probe: ProbeDefinition = {
    id: 'settingsNavigation',
    title: '设置导航·类别侧栏与页眉目录',
    description: '分组副标题、只列类别的侧栏、页眉里的本页目录和 scrollspy，以及窄屏的横向类别条',
    Component: ProbeBody,
};

export default probe;
