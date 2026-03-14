'use client';

/**
 * BouncingLoader — Shared branded loader used across page and inline loading states.
 *
 * @param {string}  [label]       – Optional text displayed below the loader
 * @param {string}  [caption]     – Optional helper text displayed below the label
 * @param {'sm'|'md'|'lg'} [size] – Controls overall scale (sm, md, lg)
 * @param {boolean} [overlay]     – If true, renders as a full-screen overlay
 * @param {string}  [className]   – Additional wrapper classes
 */
export default function BouncingLoader({
    label,
    caption,
    size = 'md',
    overlay = false,
    className = '',
}) {
    const sizeConfig = {
        sm: {
            visualClass: 'loader-visual-sm',
            labelClass: 'text-xs',
            captionClass: 'text-[10px]',
            gapClass: 'gap-2.5',
        },
        md: {
            visualClass: 'loader-visual-md',
            labelClass: 'text-sm',
            captionClass: 'text-xs',
            gapClass: 'gap-3',
        },
        lg: {
            visualClass: 'loader-visual-lg',
            labelClass: 'text-base',
            captionClass: 'text-sm',
            gapClass: 'gap-3.5',
        },
    };

    const config = sizeConfig[size] || sizeConfig.md;

    const loader = (
        <div className={`flex flex-col items-center justify-center ${config.gapClass} ${className}`.trim()}>
            <div className={`loader-visual ${config.visualClass}`} aria-hidden="true">
                <span className="loader-visual__halo" />
                <span className="loader-visual__ring" />
                <span className="loader-visual__core" />
                <span className="loader-visual__center" />
            </div>

            {(label || caption) && (
                <div className="space-y-1 text-center">
                    {label && (
                        <p className={`${config.labelClass} font-semibold tracking-[-0.01em] text-surface-700`}>
                            {label}
                        </p>
                    )}
                    {caption && (
                        <p className={`${config.captionClass} max-w-xs leading-relaxed text-surface-500`}>
                            {caption}
                        </p>
                    )}
                </div>
            )}
        </div>
    );

    if (overlay) {
        return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/70 backdrop-blur-md">
                {loader}
            </div>
        );
    }

    return loader;
}
