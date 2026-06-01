import type { ChangeEvent, ReactNode } from 'react';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_TILT_TUNING,
    type CadenzaTuning,
    type CappellaTuning,
    type FumeTuning,
    type PartitaTuning,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';
import { VISUALIZER_REGISTRY } from '../visualizer/registry';
import type { VisualizerComplexNode, VisualizerMainNode } from '../visualizer/complex';

// src/components/visEditor/InspectorControls.tsx
// Shared inspector controls for concrete visualizer parameters.
export type SetVisualizerNode = (updater: (node: VisualizerComplexNode) => VisualizerComplexNode) => void;

const readNumber = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => Number(event.target.value);

export interface RangeFieldProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}

export const RangeField = ({ label, value, min, max, step, onChange }: RangeFieldProps) => (
    <label className="vis-editor-field">
        <span>{label} {value.toFixed(step < 1 ? 2 : 0)}</span>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={event => onChange(readNumber(event))}
        />
    </label>
);

export const CheckboxField = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void; }) => (
    <label className="vis-editor-check">
        <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
        <span>{label}</span>
    </label>
);

export const FieldGroup = ({ title, children }: { title: string; children: ReactNode; }) => (
    <section className="vis-editor-field-group">
        <div className="vis-editor-field-group__title">{title}</div>
        {children}
    </section>
);

const updateMainConfig = (
    node: VisualizerComplexNode,
    patch: Partial<VisualizerMainNode['config']>,
): VisualizerComplexNode => (
    node.role === 'visualizerMain' ? { ...node, config: { ...node.config, ...patch } } : node
);

const updateMainTuning = <K extends keyof VisualizerMainNode['config']>(
    node: VisualizerComplexNode,
    key: K,
    fallback: NonNullable<VisualizerMainNode['config'][K]>,
    patch: Partial<NonNullable<VisualizerMainNode['config'][K]>>,
): VisualizerComplexNode => {
    if (node.role !== 'visualizerMain') {
        return node;
    }

    const current = (node.config[key] ?? fallback) as NonNullable<VisualizerMainNode['config'][K]>;
    return {
        ...node,
        config: {
            ...node.config,
            [key]: { ...current, ...patch },
        },
    };
};

const renderCadenzaControls = (node: VisualizerMainNode, setNode: SetVisualizerNode) => {
    const tuning: CadenzaTuning = node.config.cadenzaTuning ?? DEFAULT_CADENZA_TUNING;
    return (
        <FieldGroup title="Cadenza">
            <RangeField label="字体缩放" value={tuning.fontScale} min={0.6} max={1.8} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'cadenzaTuning', DEFAULT_CADENZA_TUNING, { fontScale: value }))} />
            <RangeField label="宽度比例" value={tuning.widthRatio} min={0.4} max={1} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'cadenzaTuning', DEFAULT_CADENZA_TUNING, { widthRatio: value }))} />
            <RangeField label="动态幅度" value={tuning.motionAmount} min={0} max={2} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'cadenzaTuning', DEFAULT_CADENZA_TUNING, { motionAmount: value }))} />
            <RangeField label="辉光强度" value={tuning.glowIntensity} min={0} max={2} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'cadenzaTuning', DEFAULT_CADENZA_TUNING, { glowIntensity: value }))} />
            <RangeField label="光束强度" value={tuning.beamIntensity} min={0} max={2} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'cadenzaTuning', DEFAULT_CADENZA_TUNING, { beamIntensity: value }))} />
        </FieldGroup>
    );
};

const renderPartitaControls = (node: VisualizerMainNode, setNode: SetVisualizerNode) => {
    const tuning: PartitaTuning = node.config.partitaTuning ?? DEFAULT_PARTITA_TUNING;
    return (
        <FieldGroup title="Partita">
            <CheckboxField label="显示辅助线" checked={tuning.showGuideLines} onChange={checked => setNode(n => updateMainTuning(n, 'partitaTuning', DEFAULT_PARTITA_TUNING, { showGuideLines: checked }))} />
            <CheckboxField label="语义排版" checked={tuning.useSemanticLayout} onChange={checked => setNode(n => updateMainTuning(n, 'partitaTuning', DEFAULT_PARTITA_TUNING, { useSemanticLayout: checked }))} />
            <RangeField label="最小错落" value={tuning.staggerMin} min={0} max={240} step={1} onChange={value => setNode(n => updateMainTuning(n, 'partitaTuning', DEFAULT_PARTITA_TUNING, { staggerMin: Math.min(value, tuning.staggerMax) }))} />
            <RangeField label="最大错落" value={tuning.staggerMax} min={0} max={320} step={1} onChange={value => setNode(n => updateMainTuning(n, 'partitaTuning', DEFAULT_PARTITA_TUNING, { staggerMax: Math.max(value, tuning.staggerMin) }))} />
        </FieldGroup>
    );
};

const renderFumeControls = (node: VisualizerMainNode, setNode: SetVisualizerNode) => {
    const tuning: FumeTuning = node.config.fumeTuning ?? DEFAULT_FUME_TUNING;
    return (
        <FieldGroup title="Fume">
            <CheckboxField label="隐藏印刷符号" checked={tuning.hidePrintSymbols} onChange={checked => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { hidePrintSymbols: checked }))} />
            <CheckboxField label="禁用内置几何" checked={tuning.disableGeometricBackground} onChange={checked => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { disableGeometricBackground: checked }))} />
            <RangeField label="背景物体透明度" value={tuning.backgroundObjectOpacity} min={0} max={1} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { backgroundObjectOpacity: value }))} />
            <RangeField label="文字保持" value={tuning.textHoldRatio} min={0} max={1} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { textHoldRatio: value }))} />
            <label className="vis-editor-field">
                <span>镜头跟随</span>
                <select value={tuning.cameraTrackingMode} onChange={event => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { cameraTrackingMode: event.target.value as FumeTuning['cameraTrackingMode'] }))}>
                    <option value="smooth">平滑</option>
                    <option value="stepped">步进</option>
                </select>
            </label>
            <RangeField label="镜头速度" value={tuning.cameraSpeed} min={0.55} max={1.85} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { cameraSpeed: value }))} />
            <RangeField label="辉光强度" value={tuning.glowIntensity} min={0} max={1.8} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { glowIntensity: value }))} />
            <RangeField label="主字缩放" value={tuning.heroScale} min={0.82} max={1.32} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'fumeTuning', DEFAULT_FUME_TUNING, { heroScale: value }))} />
        </FieldGroup>
    );
};

const renderCappellaControls = (node: VisualizerMainNode, setNode: SetVisualizerNode) => {
    const tuning: CappellaTuning = node.config.cappellaTuning ?? DEFAULT_CAPPELLA_TUNING;
    return (
        <FieldGroup title="Cappella">
            <CheckboxField label="显示情绪消息" checked={tuning.showEmoMessages} onChange={checked => setNode(n => updateMainTuning(n, 'cappellaTuning', DEFAULT_CAPPELLA_TUNING, { showEmoMessages: checked }))} />
            <label className="vis-editor-field">
                <span>表情包</span>
                <select value={tuning.emojiPackSource} onChange={event => setNode(n => updateMainTuning(n, 'cappellaTuning', DEFAULT_CAPPELLA_TUNING, { emojiPackSource: event.target.value as CappellaTuning['emojiPackSource'] }))}>
                    <option value="builtin">内置</option>
                    <option value="custom">自定义</option>
                </select>
            </label>
            <label className="vis-editor-field">
                <span>头像来源</span>
                <select value={tuning.avatarSource} onChange={event => setNode(n => updateMainTuning(n, 'cappellaTuning', DEFAULT_CAPPELLA_TUNING, { avatarSource: event.target.value as CappellaTuning['avatarSource'] }))}>
                    <option value="cover">封面</option>
                    <option value="builtin">内置</option>
                    <option value="color">主题色</option>
                </select>
            </label>
        </FieldGroup>
    );
};

const renderTiltControls = (node: VisualizerMainNode, setNode: SetVisualizerNode) => {
    const tuning: TiltTuning = node.config.tiltTuning ?? DEFAULT_TILT_TUNING;
    return (
        <FieldGroup title="Tilt">
            <RangeField label="拆分概率" value={tuning.splitProbability} min={0} max={1} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'tiltTuning', DEFAULT_TILT_TUNING, { splitProbability: value }))} />
            <RangeField label="倾斜概率" value={tuning.tiltStyleProbability} min={0} max={1} step={0.01} onChange={value => setNode(n => updateMainTuning(n, 'tiltTuning', DEFAULT_TILT_TUNING, { tiltStyleProbability: value }))} />
            <label className="vis-editor-field">
                <span>颜色方案</span>
                <select value={tuning.colorScheme ?? 'default'} onChange={event => setNode(n => updateMainTuning(n, 'tiltTuning', DEFAULT_TILT_TUNING, { colorScheme: event.target.value as TiltTuning['colorScheme'] }))}>
                    <option value="default">默认</option>
                    <option value="swap">互换</option>
                    <option value="accentAll">全部强调色</option>
                    <option value="primaryAll">全部主色</option>
                </select>
            </label>
        </FieldGroup>
    );
};

export const renderMainModeControls = (node: VisualizerMainNode, setNode: SetVisualizerNode) => (
    <>
        <label className="vis-editor-field">
            <span>主渲染模式</span>
            <select
                value={node.config.mode}
                onChange={event => setNode(n => updateMainConfig(n, { mode: event.target.value as VisualizerMode }))}
            >
                {VISUALIZER_REGISTRY.map(entry => (
                    <option key={entry.mode} value={entry.mode}>{entry.labelFallback}</option>
                ))}
            </select>
        </label>
        <RangeField
            label="歌词字号"
            value={node.config.lyricsFontScale ?? 1}
            min={0.6}
            max={1.8}
            step={0.01}
            onChange={value => setNode(n => updateMainConfig(n, { lyricsFontScale: value }))}
        />
        {node.config.mode === 'cadenza' ? renderCadenzaControls(node, setNode) : null}
        {node.config.mode === 'partita' ? renderPartitaControls(node, setNode) : null}
        {node.config.mode === 'fume' ? renderFumeControls(node, setNode) : null}
        {node.config.mode === 'cappella' ? renderCappellaControls(node, setNode) : null}
        {node.config.mode === 'tilt' ? renderTiltControls(node, setNode) : null}
    </>
);
