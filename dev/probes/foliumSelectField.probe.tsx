import React, { useEffect, useState } from 'react';
import { FoliumSettingsCard } from '../../src/mods/params/FoliumSettingsCard';
import { createFoliumParamAccess } from '../../src/mods/params/paramStore';
import type { FoliumSetting } from '../../src/mods/folium/contract';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/foliumSelectField.probe.tsx

const SCHEMA: FoliumSetting[] = [
    { key: 'fileName', type: 'text', label: { en: 'File name' }, defaultValue: 'folia-export' },
    {
        key: 'codec',
        type: 'select',
        label: { en: 'Codec' },
        defaultValue: 'hevc',
        options: [
            { value: 'h264', label: { en: 'H.264' } },
            { value: 'hevc', label: { en: 'HEVC' } },
            { value: 'prores', label: { en: 'ProRes 4444' } },
        ],
    },
    // 超过虚拟化阈值（24 项）的长列表，默认值落在视口以下：键盘打开要把它滚进视野。
    {
        key: 'preset',
        type: 'select',
        label: { en: 'Preset' },
        defaultValue: 'preset-30',
        options: Array.from({ length: 40 }, (_, index) => ({ value: `preset-${index}`, label: { en: `Preset ${index}` } })),
    },
];

const access = createFoliumParamAccess('probe:folium-select-field', SCHEMA);

/**
 * 模组 select 参数换成宿主 CustomSelect（#485）后，只有真实浏览器量得准的部分：
 * compact 触发按钮与同一表单里的文本框等高、宽度一致；触发按钮的可访问名是「字段名 当前值」；
 * 鼠标按下选项时焦点移到选项上，菜单不因 focusin 提前收起；外层像命令面板那样在 mousedown 上
 * stopPropagation 时点别处仍能收起；Escape 只关菜单，外层（window 上的 keydown）收不到；
 * 触发按钮是 combobox，aria-activedescendant 指向高亮项；Preset 是走虚拟化分支的长列表，
 * 当前值在视口以下，用键盘打开时要滚到它。data-probe-outer-escapes 记外层收到的 Escape 次数。
 */
const FoliumSelectFieldProbe: React.FC = () => {
    const [outerEscapes, setOuterEscapes] = useState(0);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOuterEscapes((count) => count + 1);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div
            className="min-h-screen bg-zinc-950 p-10 text-zinc-100"
            style={{ '--text-primary': '#f4f4f5', '--text-secondary': '#a1a1aa' } as React.CSSProperties}
            data-probe-outer-escapes={outerEscapes}
        >
            <div className="w-[420px]" onMouseDown={(event) => event.stopPropagation()}>
                {/* 放在卡片上方：菜单向下展开，放下方会被菜单盖住、点不到。 */}
                <p className="mb-4 text-xs text-zinc-400" data-probe-elsewhere>
                    Elsewhere inside the palette-like container
                </p>
                <FoliumSettingsCard
                    modId="probe-mod"
                    where="probe settings section"
                    entryKind="settings-section"
                    entryId="probe-mod.export"
                    title={{ en: 'Export' }}
                    fallbackTitle="Export"
                    access={access}
                    theme={DEFAULT_THEME}
                    isDaylight={false}
                    controlCardBg="rgba(0,0,0,0.2)"
                    description="Folium settings card with a text field and a select field"
                />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'foliumSelectField',
    title: 'Folium 表单 · select 参数用宿主下拉',
    description: 'compact 下拉与文本框等高；拦 mousedown 的容器里点别处能收起；Escape 只关菜单不惊动外层；长列表用键盘打开滚到当前项。',
    Component: FoliumSelectFieldProbe,
};

export default definition;
