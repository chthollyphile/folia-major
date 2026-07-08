import React from 'react';
import { Sparkles, Sliders } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UserGuideTipCard } from './UserGuideTipCard';
import { UserGuideFeatureCard } from './UserGuideFeatureCard';

export type NewFeaturesIntroProps = {
    isDaylight: boolean;
    classes: {
        textPrimary: string;
        textSecondary: string;
        tipCardBg: string;
        iconTileBg: string;
        cardBg: string;
    };
};

// 在这里编辑当前版本的新功能介绍
// 修改这里的介绍的同时，需要修改 src\components\modal\userGuideContent.ts 中的 USER_GUIDE_AUTO_OPEN_VERSION 到下一个发布版本号
export const NewFeaturesIntro: React.FC<NewFeaturesIntroProps> = ({ isDaylight, classes }) => {
    const { t } = useTranslation();
    const { textPrimary, textSecondary, tipCardBg, iconTileBg, cardBg } = classes;
    const tipCardClasses = { iconTileBg, tipCardBg, textPrimary, textSecondary };
    const featureCardClasses = { iconTileBg, cardBg, textPrimary, textSecondary };

    return (
        <div className="flex flex-col h-full">
            <div className="flex justify-center mb-6 mt-4 shrink-0">
                <div className={`relative w-20 h-20 rounded-full flex items-center justify-center ${isDaylight ? 'bg-blue-50 shadow-inner' : 'bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]'}`}>
                    <Sparkles size={32} className={isDaylight ? 'text-blue-500' : 'text-blue-400'} />
                </div>
            </div>

            <div className="shrink-0">
                <UserGuideTipCard
                    {...tipCardClasses}
                    icon={Sparkles}
                    iconClassName={isDaylight ? 'text-blue-500' : 'text-blue-400'}
                    title={t('userGuide.title', '欢迎使用 Folia')}
                    description="以下是新版本功能与改进"
                />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 overflow-y-auto custom-scrollbar pr-2 pb-2">
                <UserGuideFeatureCard
                    {...featureCardClasses}
                    icon={Sliders}
                    iconClassName={isDaylight ? 'text-indigo-500' : 'text-indigo-400'}
                    title="回环效果新设置"
                    description="回环效果添加新设置，允许隐藏轴线，微调字符间距。"
                />
            </div>
        </div>
    );
};
