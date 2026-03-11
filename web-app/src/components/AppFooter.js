/**
 * AppFooter — Nuxt UI v4–style responsive footer, ported to React / Next.js.
 *
 * Three-zone layout (left · center · right) that stacks on mobile
 * and becomes a horizontal row on desktop (lg:).
 *
 * Props (mirror Nuxt UI's UFooter API):
 * ──────────────────────────────────────
 * @prop {string}        [as='footer'] – Root element tag
 * @prop {object}        [ui]          – Per-slot theme overrides
 * @prop {ReactNode}     [left]        – Left zone (e.g. copyright)
 * @prop {ReactNode}     [children]    – Center zone (e.g. nav links)
 * @prop {ReactNode}     [right]       – Right zone (e.g. social icons)
 * @prop {ReactNode}     [top]         – Content above the main footer (e.g. columns)
 * @prop {ReactNode}     [bottom]      – Content below the main footer
 *
 * @see https://ui.nuxt.com/docs/components/footer
 */

import { mergeUi, cx } from '@/lib/merge-ui';
import Container from '@/components/Container';

/* ─── Default Theme Slots (exact Nuxt UI v4 classes) ───────────── */
const defaultUi = {
    root: 'app-footer',
    top: 'py-8 lg:py-12',
    bottom: 'py-8 lg:py-12',
    container: 'py-8 lg:py-4 lg:flex lg:items-center lg:justify-between lg:gap-x-3',
    left: 'flex items-center justify-center lg:justify-start lg:flex-1 gap-x-1.5 mt-3 lg:mt-0 lg:order-1',
    center: 'mt-3 lg:mt-0 lg:order-2 flex items-center justify-center',
    right: 'lg:flex-1 flex items-center justify-center lg:justify-end gap-x-1.5 lg:order-3',
};

export default function AppFooter({
    as: Tag = 'footer',
    ui: uiOverrides,
    left,
    children,
    right,
    top,
    bottom,
}) {
    const ui = mergeUi(defaultUi, uiOverrides);

    return (
        <Tag className={cx(ui.root)} data-slot="footer">
            {/* Top section (e.g. FooterColumns) */}
            {top && (
                <Container>
                    <div className={cx(ui.top)}>{top}</div>
                </Container>
            )}

            {/* Main footer bar */}
            <Container>
                <div className={cx(ui.container)}>
                    {/* Left zone — copyright, branding */}
                    {left && <div className={cx(ui.left)}>{left}</div>}

                    {/* Center zone — nav links */}
                    {children && <div className={cx(ui.center)}>{children}</div>}

                    {/* Right zone — social icons, badges */}
                    {right && <div className={cx(ui.right)}>{right}</div>}
                </div>
            </Container>

            {/* Bottom section */}
            {bottom && (
                <Container>
                    <div className={cx(ui.bottom)}>{bottom}</div>
                </Container>
            )}
        </Tag>
    );
}
