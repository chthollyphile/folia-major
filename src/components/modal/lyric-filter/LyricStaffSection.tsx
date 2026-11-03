import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    LYRIC_STAFF_MIN_DWELL_RANGE,
    type LyricStaffAbsorbMode,
    type LyricStaffPolicy,
} from '../../../utils/lyrics/staffCreditsPolicy';
import { LYRIC_STAFF_PATTERN_EXAMPLE, getLyricStaffPatternError } from '../../../utils/lyrics/staffCredits';
import { Group, PictureChoice, Reveal, Row, Segmented, Slider, type SettingsGroupDef } from '../settings/kit';
import LyricFilterPatternField from './LyricFilterPatternField';
import { StaffPolicyPicture } from './staffPolicyPictures';

// src/components/modal/lyric-filter/LyricStaffSection.tsx

const STAFF_GROUP: SettingsGroupDef = { id: 'lyricFilterStaff', titleKey: 'lyricStaff.title' };

const POLICY_ORDER: LyricStaffPolicy[] = ['keep', 'smart', 'hide'];

const POLICY_LABEL_KEYS: Record<LyricStaffPolicy, { label: string; description: string }> = {
    keep: { label: 'lyricStaff.policyKeep', description: 'lyricStaff.policyKeepDesc' },
    smart: { label: 'lyricStaff.policySmart', description: 'lyricStaff.policySmartDesc' },
    hide: { label: 'lyricStaff.policyHide', description: 'lyricStaff.policyHideDesc' },
};

const ABSORB_ORDER: LyricStaffAbsorbMode[] = ['off', 'before', 'both'];

const ABSORB_LABEL_KEYS: Record<LyricStaffAbsorbMode, { label: string; description: string }> = {
    off: { label: 'lyricStaff.absorbOff', description: 'lyricStaff.absorbOffDesc' },
    before: { label: 'lyricStaff.absorbBefore', description: 'lyricStaff.absorbBeforeDesc' },
    both: { label: 'lyricStaff.absorbBoth', description: 'lyricStaff.absorbBothDesc' },
};

interface LyricStaffSectionProps {
    policy: LyricStaffPolicy;
    minDwellSeconds: number;
    absorbMode: LyricStaffAbsorbMode;
    pattern: string;
    onPolicyChange: (policy: LyricStaffPolicy) => void;
    onMinDwellChange: (seconds: number) => void;
    onAbsorbModeChange: (mode: LyricStaffAbsorbMode) => void;
    onPatternChange: (pattern: string) => void;
}

const LyricStaffSection: React.FC<LyricStaffSectionProps> = ({
    policy,
    minDwellSeconds,
    absorbMode,
    pattern,
    onPolicyChange,
    onMinDwellChange,
    onAbsorbModeChange,
    onPatternChange,
}) => {
    const { t } = useTranslation();
    const patternError = getLyricStaffPatternError(pattern);

    return (
        <Group def={STAFF_GROUP}>
            <Row label={t('lyricStaff.policy')} hint={t(POLICY_LABEL_KEYS[policy].description)}>
                {/* 两组选项结构完全一致，靠 data-staff-*-group 区分，测试才能只挑其中一组断言。 */}
                <div data-staff-policy-group="" className="contents">
                    <PictureChoice
                        value={policy}
                        options={POLICY_ORDER.map(option => ({
                            value: option,
                            label: t(POLICY_LABEL_KEYS[option].label),
                            picture: <StaffPolicyPicture policy={option} />,
                        }))}
                        onChange={onPolicyChange}
                    />
                </div>
            </Row>

            <Reveal when={policy === 'smart'}>
                <Row sub label={t('lyricStaff.minDwell')} note={t('lyricStaff.minDwellDesc')}>
                    <Slider
                        value={minDwellSeconds}
                        min={LYRIC_STAFF_MIN_DWELL_RANGE.min}
                        max={LYRIC_STAFF_MIN_DWELL_RANGE.max}
                        step={0.1}
                        onChange={onMinDwellChange}
                        format={seconds => t('lyricStaff.minDwellValue', { seconds: seconds.toFixed(1) })}
                    />
                </Row>
                {/* 只在 smart 下露出：吸收的边界面就是上面那个滑块的阈值，而 hide 压根不做吸收。 */}
                <Row sub label={t('lyricStaff.absorb')} note={t(ABSORB_LABEL_KEYS[absorbMode].description)}>
                    <div data-staff-absorb-group="" className="contents">
                        <Segmented
                            value={absorbMode}
                            options={ABSORB_ORDER.map(option => ({ value: option, label: t(ABSORB_LABEL_KEYS[option].label) }))}
                            onChange={onAbsorbModeChange}
                        />
                    </div>
                </Row>
            </Reveal>

            <Reveal when={policy !== 'keep'}>
                <Row
                    label={t('lyricStaff.customPattern')}
                    note={t('lyricStaff.customPatternDesc')}
                    below={(
                        <LyricFilterPatternField
                            value={pattern}
                            onChange={onPatternChange}
                            placeholder={t('lyricStaff.customPatternPlaceholder')}
                            example={LYRIC_STAFF_PATTERN_EXAMPLE}
                            error={patternError}
                        />
                    )}
                />
            </Reveal>
        </Group>
    );
};

export default LyricStaffSection;
