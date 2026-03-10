'use client';

/**
 * BouncingLoader — Elegant bouncing balls loading animation.
 * Adapted from uiverse.io/mobinkakei/grumpy-turtle-41, themed to brand palette.
 *
 * @param {string}  [label]       – Optional text displayed below the loader
 * @param {'sm'|'md'|'lg'} [size] – Controls overall scale (sm, md, lg)
 * @param {boolean} [overlay]     – If true, renders as a full-screen overlay
 * @param {string}  [className]   – Additional wrapper classes
 */
export default function BouncingLoader({ label, size = 'md', overlay = false, className = '' }) {
    const scale = size === 'sm' ? 0.5 : size === 'lg' ? 1.2 : 0.8;

    const loader = (
        <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
            <div className="bouncing-loader-wrapper" style={{ transform: `scale(${scale})` }}>
                <div className="bouncing-circle" />
                <div className="bouncing-circle" />
                <div className="bouncing-circle" />
                <div className="bouncing-shadow" />
                <div className="bouncing-shadow" />
                <div className="bouncing-shadow" />
            </div>
            {label && (
                <p className="text-sm font-medium text-surface-500 animate-pulse">{label}</p>
            )}
        </div>
    );

    if (overlay) {
        return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/60 backdrop-blur-sm">
                {loader}
            </div>
        );
    }

    return loader;
}
