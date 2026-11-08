import React, { useCallback, useState } from 'react';
import { ChevronDown, RefreshCw, SlidersHorizontal, Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusMessage, Theme } from '../../../../types';
import type { DailyStyleSelection } from '../../../../types/onlineMusic';
import { CustomSelect } from '../../../../components/shared/CustomSelect';
import type { CollectionMutationController, CollectionMutationSnapshot } from '../../../core/collection/mutations/mutations.contract';
import { describeDailyStyle, sameDailyStyle } from '../../../core/collection/dailyStyle';
import DailyStylePickerDialog from './DailyStylePickerDialog';
import { openRecommendationPreferences, useRecommendationPreferencesEntry } from '../../../../components/recommendationPreferences/recommendationPreferencesEntry';

// src/library/suites/grid/collection/GridDailyRecommendationControls.tsx
// 网格信息面板里每日推荐的那一块：「默认推荐 / 风格推荐」（平台有风格推荐才有，#938）；默认推荐下是日期选择与
// 「刷新今天」，风格推荐下是选中的风格，点开风格选择（DailyStylePickerDialog）。换内容都经变更控制器交给资源。
// 平台声明了每日推荐的偏好入口时，最上面多一行「偏好设置」，打开命令面板里的偏好面板。

type GridDailyRecommendationControlsProps = {
    mutations: CollectionMutationController | null;
    snapshot: CollectionMutationSnapshot;
    loading: boolean;
    isDaylight: boolean;
    theme: Theme;
    /** 换内容之前（网格退出编辑模式）。 */
    onBeforeSwitch: () => void;
    onStatusMessage?: (message: StatusMessage) => void;
};

const GridDailyRecommendationControls: React.FC<GridDailyRecommendationControlsProps> = ({
    mutations,
    snapshot,
    loading,
    isDaylight,
    theme,
    onBeforeSwitch,
    onStatusMessage,
}) => {
    const { t } = useTranslation();
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const supported = snapshot.capabilities.dailyDate.supported;
    const styleLabel = describeDailyStyle(snapshot.dailyStyleGroups, snapshot.dailyStyleSelection);
    const offersPreferences = useRecommendationPreferencesEntry('daily');

    // Switches the virtual playlist between today's recommendations and a supported history date.
    const changeDate = useCallback(async (date: string, afresh = false) => {
        if (!mutations || !supported) return;
        onBeforeSwitch();
        // 整表替换经控制器交给资源（加载中状态、作废晚到结果都在那里）；失败时保持原样，日期也不切。
        await mutations.setDailyDate(date, { afresh });
    }, [mutations, onBeforeSwitch, supported]);

    // 风格推荐：换成账号已选风格的推荐。
    const showStyle = useCallback(async () => {
        if (!mutations || !supported) return;
        onBeforeSwitch();
        const result = await mutations.showDailyStyle();
        if (!result.ok && result.reason === 'failed') {
            onStatusMessage?.({ type: 'error', text: t('home.dailyStyleLoadFailed'), nonce: Date.now() });
        }
    }, [mutations, onBeforeSwitch, onStatusMessage, supported, t]);

    // 选择器里确认了风格：正在看的就是它时只收起，否则先存到账号上再换歌。
    const confirmStyle = useCallback(async (selection: DailyStyleSelection) => {
        setIsPickerOpen(false);
        if (!mutations) return;
        const current = mutations.getSnapshot();
        if (current.dailyStyleShown && sameDailyStyle(current.dailyStyleSelection, selection)) return;
        const result = await mutations.setDailyStyle(selection);
        if (!result.ok && result.reason === 'failed') {
            onStatusMessage?.({ type: 'error', text: t('home.dailyStyleSaveFailed'), nonce: Date.now() });
        }
    }, [mutations, onStatusMessage, t]);

    return (
        <div className="mt-3 space-y-2">
            {/* 平台声明了每日推荐的偏好入口才有，放在「默认推荐 / 风格推荐」的位置；平台两样都有时两行都在。 */}
            {offersPreferences && (
                <button
                    type="button"
                    onClick={openRecommendationPreferences}
                    data-testid="daily-recommendation-preferences"
                    className="flex h-11 w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-left text-sm transition-colors hover:bg-white/10"
                >
                    <SlidersHorizontal size={14} className="shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{t('recommendationPreferences.open')}</span>
                </button>
            )}
            {snapshot.dailyStyleAvailable && (
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1 text-xs" role="group" aria-label={t('home.dailyRecommendationMode')}>
                    {([false, true] as const).map(style => (
                        <button
                            key={String(style)}
                            type="button"
                            aria-pressed={snapshot.dailyStyleShown === style}
                            disabled={loading}
                            onClick={() => {
                                if (snapshot.dailyStyleShown === style) return;
                                void (style ? showStyle() : changeDate(''));
                            }}
                            className={`h-8 rounded-lg font-semibold transition-colors disabled:opacity-40 ${snapshot.dailyStyleShown === style ? 'bg-white/15' : 'opacity-60 hover:bg-white/10'}`}
                        >
                            {t(style ? 'home.dailyStyleRecommendations' : 'home.dailyDefaultRecommendations')}
                        </button>
                    ))}
                </div>
            )}
            {snapshot.dailyStyleShown ? (
                <button
                    type="button"
                    onClick={() => {
                        mutations?.loadDailyStyleGroups();
                        setIsPickerOpen(true);
                    }}
                    disabled={loading}
                    aria-label={t('home.dailyStylePickerTitle')}
                    className="flex h-11 w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-left text-sm transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                    <Tags size={14} className="shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{styleLabel || t('home.dailyStylePick')}</span>
                    <ChevronDown size={14} className="shrink-0 opacity-60" />
                </button>
            ) : (
                <div className="flex items-center gap-2">
                    {snapshot.dailyHistoryAvailable && (
                        <div className="min-w-0 flex-1">
                            <CustomSelect
                                value={snapshot.dailyDate}
                                onChange={date => void changeDate(date)}
                                options={[
                                    { value: '', label: t('home.todayRecommendations') },
                                    ...snapshot.dailyHistoryDates.map(date => ({ value: date, label: date })),
                                ]}
                                placeholder={t('home.todayRecommendations')}
                                ariaLabel={t('home.recommendationDate')}
                                disabled={loading}
                                isDaylight={isDaylight}
                                theme={theme}
                            />
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => void changeDate('', true)}
                        disabled={loading || Boolean(snapshot.dailyDate)}
                        title={t('home.refreshRecommendations')}
                        aria-label={t('home.refreshRecommendations')}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10 disabled:opacity-30"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            )}
            {snapshot.dailyStyleAvailable && (
                <DailyStylePickerDialog
                    isOpen={isPickerOpen}
                    isDaylight={isDaylight}
                    groups={snapshot.dailyStyleGroups}
                    groupsFailed={snapshot.dailyStyleGroupsFailed}
                    selection={snapshot.dailyStyleSelection}
                    onRetryGroups={() => mutations?.loadDailyStyleGroups()}
                    onConfirm={selection => void confirmStyle(selection)}
                    onClose={() => setIsPickerOpen(false)}
                />
            )}
        </div>
    );
};

export default GridDailyRecommendationControls;
