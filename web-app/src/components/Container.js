/**
 * Container — Nuxt UI–style responsive container.
 *
 * Centers content horizontally and constrains width to `--ui-container` (1280px).
 * Mirrors the UContainer component API.
 *
 * @prop {string}           [as='div']   – HTML element to render
 * @prop {string}           [className]  – Additional classes
 * @prop {{ base?: string }} [ui]        – Theme override object
 * @prop {React.ReactNode}  children     – Content
 *
 * @see https://ui.nuxt.com/docs/components/container
 */

import { mergeUi, cx } from '@/lib/merge-ui';

const defaultUi = {
    base: 'w-full max-w-[var(--ui-container)] mx-auto px-4 sm:px-6 lg:px-8',
};

export default function Container({
    as: Tag = 'div',
    className,
    ui,
    children,
    ...rest
}) {
    const theme = mergeUi(defaultUi, ui);

    return (
        <Tag className={cx(theme.base, className)} {...rest}>
            {children}
        </Tag>
    );
}
