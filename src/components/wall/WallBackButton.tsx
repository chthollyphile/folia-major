import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import './WallBackButton.css';

// src/components/wall/WallBackButton.tsx
// 海报墙左上角的返回按钮（.lattice-back：40px 圆、白 8%、模糊），Lattice 与 bravais 共用。
// Lattice 常驻显示；bravais 用隐藏式（concealed）：平时不显示，鼠标进入左上角热区或键盘聚焦时出现，
// 与播放页 VisualizerShell 左上角那颗的显隐方式相同（热区同为 120px）。

/** 左上角热区的边长，与 VisualizerShell 的 PLAYER_CHROME_HOTSPOT_SIZE 相同。 */
export const WALL_BACK_HOTSPOT_PX = 120;

/**
 * 隐藏式按钮的热区判定：window 上听鼠标移动，只在「进 / 出热区」翻转时 setState（高频回调里不做无谓更新）；
 * 鼠标离开窗口时收起。触屏不走这里（CSS 在没有悬停的设备上常驻显示）。
 */
const useCornerReveal = (enabled: boolean) => {
    const [revealed, setRevealed] = useState(false);
    useEffect(() => {
        if (!enabled) {
            setRevealed(false);
            return undefined;
        }
        const handleMove = (event: PointerEvent) => {
            if (event.pointerType === 'touch') return;
            const inside = event.clientX <= WALL_BACK_HOTSPOT_PX && event.clientY <= WALL_BACK_HOTSPOT_PX;
            setRevealed(current => (current === inside ? current : inside));
        };
        const handleLeave = (event: MouseEvent) => {
            if (!event.relatedTarget) setRevealed(false);
        };
        window.addEventListener('pointermove', handleMove, { passive: true });
        document.addEventListener('mouseout', handleLeave);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            document.removeEventListener('mouseout', handleLeave);
        };
    }, [enabled]);
    return revealed;
};

type WallBackButtonProps = {
    /** 可访问名与 title。 */
    label: string;
    onBack: () => void;
    /** 隐藏式（bravais）。缺省常驻显示（Lattice）。 */
    concealed?: boolean;
};

export default function WallBackButton({ label, onBack, concealed = false }: WallBackButtonProps) {
    const revealed = useCornerReveal(concealed);
    const className = concealed ? `lattice-back is-concealed${revealed ? ' is-revealed' : ''}` : 'lattice-back';
    return (
        <button type="button" className={className} onClick={onBack} aria-label={label} title={label}>
            <ChevronLeft size={20} />
        </button>
    );
}
