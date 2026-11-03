import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BravaisSuiteArt, GridSuiteArt } from './librarySuiteArt';
import { OnboardingChoiceCards, type OnboardingChoiceArt, type OnboardingChoiceCard } from './OnboardingChoiceCards';
import {
    chooseLibrarySuite,
    listOnboardingLibrarySuiteIds,
    useActiveLibrarySuiteId,
} from '../../../library/app/librarySuiteChoice';
import type { LibrarySuiteId } from '../../../library/core/suite/suite.contract';

// src/components/modal/playback-entry-view/LibrarySuiteOnboardingOptions.tsx
// 首启引导第一页：资料库用哪套界面（网格 / bravais）。卡片与第二页「播放后进入的视图」同一份 OnboardingChoiceCards。
// 写入走设置页「资料库界面」同一条路（chooseLibrarySuite → switchLibrarySuite → useLibrarySuiteStore 的 `library_suite`），
// 高亮的是实际生效的 suite；点的就是正在用的那套时什么都不写（与设置页一致：没选过的人继续跟随初始选择）。

const ART_BY_SUITE: Readonly<Record<string, OnboardingChoiceArt>> = {
    grid: GridSuiteArt,
    bravais: BravaisSuiteArt,
};

type LibrarySuiteOnboardingOptionsProps = {
    isDaylight: boolean;
    accentColor: string;
};

export const LibrarySuiteOnboardingOptions: React.FC<LibrarySuiteOnboardingOptionsProps> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const activeSuiteId = useActiveLibrarySuiteId();
    const suiteIds = listOnboardingLibrarySuiteIds();

    const cards = useMemo<OnboardingChoiceCard<LibrarySuiteId>[]>(() => suiteIds.map(id => ({
        value: id,
        art: ART_BY_SUITE[id] ?? GridSuiteArt,
        title: t(`librarySuiteOnboarding.${id}.title`),
        tag: t(`librarySuiteOnboarding.${id}.tag`),
        description: t(`librarySuiteOnboarding.${id}.description`),
    })), [suiteIds, t]);

    return (
        <OnboardingChoiceCards
            cards={cards}
            value={suiteIds.includes(activeSuiteId) ? activeSuiteId : null}
            onChange={chooseLibrarySuite}
            isDaylight={isDaylight}
            accentColor={accentColor}
            dataAttribute="data-onboarding-library-suite"
            gridClassName="grid-cols-2"
        />
    );
};
