import { motion } from 'framer-motion';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import './loadingDots.css';

// Three staggered bouncing dots, adapted from the supplied LoaderOne for Folia's motion settings.
export default function LoadingDots({ isDaylight = false }: { isDaylight?: boolean }) {
    const calm = useReducedMotionFor('uiMicroMotion');
    return (
        <span aria-hidden="true" className={`loading-dots relative inline-flex h-7 shrink-0 items-start gap-2 ${isDaylight ? 'is-daylight' : ''}`} data-loading-dots>
            <span className="loading-dots-glass" />
            {[0, 1, 2].map(index => (
                <motion.span
                    key={index}
                    initial={false}
                    animate={calm ? { y: 0 } : { y: [0, 10, 0] }}
                    transition={calm ? { duration: 0 } : {
                        duration: 1,
                        repeat: Infinity,
                        repeatType: 'loop',
                        delay: index * 0.2,
                        ease: 'easeInOut',
                    }}
                    className={`relative block h-4 w-4 rounded-full border bg-gradient-to-b ${isDaylight
                        ? 'border-neutral-300 from-neutral-400 to-neutral-300'
                        : 'border-neutral-400 from-neutral-500 to-neutral-300'}`}
                />
            ))}
        </span>
    );
}
