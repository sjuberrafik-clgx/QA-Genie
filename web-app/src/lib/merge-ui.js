/**
 * merge-ui.js — Nuxt UI–style theme slot merger.
 *
 * Each component defines a `defaultUi` object mapping slot names to Tailwind class strings.
 * Users can pass a `ui` prop to override specific slots.
 * This helper merges them: override replaces the default for that slot,
 * or APPENDS when the override string starts with "+".
 *
 * @example
 *   mergeUi(
 *     { root: 'bg-white p-4', title: 'font-bold' },
 *     { root: 'bg-red-500' }            // replaces root entirely
 *   ) // → { root: 'bg-red-500', title: 'font-bold' }
 *
 *   mergeUi(
 *     { root: 'bg-white p-4' },
 *     { root: '+ border' }              // appends to root
 *   ) // → { root: 'bg-white p-4 border' }
 */
export function mergeUi(defaults = {}, overrides = {}) {
    if (!overrides || Object.keys(overrides).length === 0) return { ...defaults };

    const merged = { ...defaults };

    for (const [slot, value] of Object.entries(overrides)) {
        if (value == null) continue;

        const str = String(value).trim();
        if (str.startsWith('+')) {
            // Append mode — prepend existing default then the addition
            merged[slot] = `${defaults[slot] || ''} ${str.slice(1).trim()}`.trim();
        } else {
            // Replace mode
            merged[slot] = str;
        }
    }

    return merged;
}

/**
 * Tiny className joiner — combines truthy values into a single class string.
 * Replacement for clsx without adding a dependency.
 *
 * @example cx('block', false, 'mt-2', undefined, 'p-4') → 'block mt-2 p-4'
 */
export function cx(...args) {
    return args.filter(Boolean).join(' ');
}
