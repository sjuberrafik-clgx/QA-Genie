'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLASS · COGNITION · TAXONOMY — the pre-seeded "business intuition" library
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A human intuitively knows an e-commerce site should end at a receipt, a SaaS tool
 * at a dashboard, and that a validation error or empty screen is a deviation. This
 * module encodes that universal intuition as DATA: a set of industry archetypes,
 * each with (a) intent signals to recognise it, (b) a canonical flow graph of the
 * happy path, and (c) the lexicons that mark advancement, success, and failure.
 *
 * Design tenets:
 *   • Zero-config: universal defaults ship in-tree; no external files required.
 *   • Pure data + pure helpers: no browser, no I/O, no clock, no randomness —
 *     so the whole cognitive kernel is byte-reproducible and unit-testable.
 *   • Additive override: callers may pass extra archetypes/lexicons via opts; the
 *     built-ins are never mutated.
 *
 * @module glass-mcp/cognition/taxonomy
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Universal lexicons — shared across every archetype. These capture the language
 * the whole web uses for the same intents, independent of vertical.
 */
const LEXICON = {
    // Words that mark a state as a completed / correct outcome.
    success: [
        'success', 'successful', 'successfully', 'thank you', 'thanks', 'confirmed', 'confirmation',
        'completed', 'complete', 'congratulations', 'welcome', 'your order', 'order number', 'receipt',
        'saved', 'updated', 'submitted', 'approved', 'done', 'all set', 'you\'re in', 'is now active',
        'has been created', 'has been sent', 'we received', 'payment received', 'booking confirmed',
    ],
    // Words that mark a state as an error / broken / rejected outcome.
    error: [
        'error', 'invalid', 'required', 'failed', 'failure', 'try again', 'something went wrong',
        'went wrong', 'wrong', 'denied', 'not found', 'unable', 'cannot', 'can\'t', 'oops', 'problem',
        'incorrect', 'must be', 'is required', 'please enter', 'please select', 'not valid', 'rejected',
        'declined', 'unauthorized', 'forbidden', 'expired', 'too many attempts', 'does not match',
        'already exists', 'unavailable', 'timeout', 'timed out',
    ],
    // Affordance labels that ADVANCE a business flow (the happy path).
    advance: [
        'continue', 'next', 'proceed', 'submit', 'confirm', 'place order', 'pay', 'pay now', 'checkout',
        'check out', 'buy', 'buy now', 'sign up', 'signup', 'register', 'create account', 'create',
        'save', 'apply', 'finish', 'complete', 'get started', 'start', 'add to cart', 'add to bag',
        'add', 'book', 'reserve', 'subscribe', 'upgrade', 'send', 'accept', 'agree', 'allow', 'ok',
    ],
    // Affordance labels that REGRESS / cancel / destroy (edge cases, not happy path).
    regress: [
        'cancel', 'back', 'go back', 'remove', 'delete', 'clear', 'reset', 'discard', 'logout',
        'log out', 'sign out', 'close', 'skip', 'dismiss', 'decline', 'reject', 'undo', 'abort',
        'previous', 'exit', 'quit', 'no thanks', 'maybe later',
    ],
};

/** URL path fragments that connote a terminal-success or an error route. */
const URL_HINTS = {
    success: [
        'success', 'thank', 'thanks', 'receipt', 'confirm', 'confirmation', 'complete', 'completed',
        'welcome', 'dashboard', 'home', 'order-confirmation', 'order_complete', 'congrat', 'done',
    ],
    error: [
        'error', 'errors', 'denied', 'fail', 'failure', '404', 'not-found', 'notfound', '500',
        'unauthorized', 'forbidden', 'access-denied', 'expired', 'invalid',
    ],
};

/**
 * Archetype library. Each entry:
 *   id/label   — identity.
 *   url        — path/host fragments hinting at this vertical.
 *   text       — page-text / heading phrases hinting at this vertical.
 *   kinds      — affordance-kind fingerprint that tends to dominate this vertical.
 *   flow       — ordered stages of the canonical happy path. Each stage:
 *                { stage, markers, advance?, terminal?, success? }.
 *                `markers` locate the current stage; `advance` are the labels that
 *                move to the NEXT stage; a terminal+success stage is the receipt/goal.
 */
const ARCHETYPES = [
    {
        id: 'ecommerce',
        label: 'E-commerce / Retail',
        url: ['cart', 'checkout', 'product', 'products', 'shop', 'store', 'catalog', 'basket', 'order', 'bag'],
        text: ['add to cart', 'add to bag', 'buy now', 'checkout', 'shopping cart', 'in stock', 'out of stock',
            'free shipping', 'subtotal', 'quantity', 'proceed to checkout', 'your bag', 'wishlist'],
        kinds: ['card', 'button', 'select'],
        flow: [
            { stage: 'browse', markers: ['products', 'catalog', 'shop', 'search', 'filter', 'category', 'results'], advance: ['view', 'details', 'add to cart', 'add to bag'] },
            { stage: 'cart', markers: ['cart', 'bag', 'basket', 'subtotal', 'quantity', 'your order summary'], advance: ['checkout', 'check out', 'proceed', 'continue'] },
            { stage: 'checkout', markers: ['shipping', 'billing', 'address', 'delivery', 'contact information'], advance: ['continue', 'next', 'continue to payment', 'proceed'] },
            { stage: 'payment', markers: ['payment', 'card number', 'credit card', 'cvv', 'card details', 'billing address'], advance: ['pay', 'place order', 'confirm', 'submit order', 'pay now'] },
            { stage: 'confirmation', markers: ['thank you', 'order confirmed', 'order number', 'receipt', 'your order has been', 'order complete'], advance: [], terminal: true, success: true },
        ],
    },
    {
        id: 'saas',
        label: 'B2B SaaS / Productivity',
        url: ['dashboard', 'app', 'workspace', 'projects', 'reports', 'settings', 'admin', 'console', 'overview'],
        text: ['dashboard', 'workspace', 'projects', 'analytics', 'reports', 'invite team', 'members',
            'create project', 'new workspace', 'integrations', 'api key', 'usage', 'plan', 'billing'],
        kinds: ['menu', 'tab', 'button', 'card'],
        flow: [
            { stage: 'landing', markers: ['get started', 'sign up free', 'start free trial', 'request demo', 'product', 'features', 'pricing'], advance: ['get started', 'sign up', 'start free trial', 'try'] },
            { stage: 'onboarding', markers: ['welcome', 'set up', 'create your', 'name your workspace', 'invite', 'first project', 'tell us about'], advance: ['continue', 'next', 'create', 'finish', 'skip'] },
            { stage: 'workspace', markers: ['dashboard', 'workspace', 'overview', 'projects', 'no projects yet', 'recent activity'], advance: ['create', 'new', 'add', 'invite', 'open'] },
            { stage: 'productive', markers: ['project', 'board', 'report', 'settings', 'analytics', 'saved', 'members'], advance: [], terminal: true, success: true },
        ],
    },
    {
        id: 'fintech',
        label: 'Fintech / Payments / Billing',
        url: ['pay', 'payment', 'billing', 'invoice', 'transfer', 'wallet', 'account', 'transactions', 'subscribe', 'plans'],
        text: ['payment', 'amount', 'invoice', 'billing', 'card number', 'routing number', 'account number',
            'transfer', 'balance', 'transaction', 'subscription', 'per month', 'monthly', 'annually', 'total due'],
        kinds: ['field', 'button', 'select'],
        flow: [
            { stage: 'select', markers: ['plan', 'amount', 'choose', 'select a plan', 'how much', 'pricing'], advance: ['continue', 'select', 'choose', 'next', 'subscribe'] },
            { stage: 'details', markers: ['card number', 'billing', 'cardholder', 'expiry', 'cvv', 'account number', 'routing'], advance: ['continue', 'review', 'next'] },
            { stage: 'review', markers: ['review', 'confirm your', 'total', 'you will be charged', 'order summary'], advance: ['pay', 'confirm', 'authorize', 'submit payment', 'pay now'] },
            { stage: 'settled', markers: ['payment successful', 'payment received', 'transaction complete', 'receipt', 'confirmation number', 'paid'], advance: [], terminal: true, success: true },
        ],
    },
    {
        id: 'crm',
        label: 'CRM / Records / Data-entry',
        url: ['records', 'contacts', 'leads', 'customers', 'accounts', 'deals', 'tickets', 'entities', 'crm', 'new', 'edit'],
        text: ['contacts', 'leads', 'accounts', 'deals', 'add contact', 'new record', 'create record',
            'assigned to', 'status', 'pipeline', 'save record', 'first name', 'last name', 'company'],
        kinds: ['field', 'select', 'button'],
        flow: [
            { stage: 'list', markers: ['records', 'contacts', 'all leads', 'table', 'no records', 'showing', 'rows'], advance: ['new', 'add', 'create', 'import'] },
            { stage: 'form', markers: ['name', 'email', 'phone', 'company', 'status', 'assigned', 'required'], advance: ['save', 'create', 'submit', 'add record'] },
            { stage: 'saved', markers: ['record created', 'saved', 'successfully added', 'has been created', 'changes saved'], advance: [], terminal: true, success: true },
        ],
    },
    {
        id: 'auth',
        label: 'Authentication / Registration',
        url: ['login', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'auth', 'account', 'password', 'verify', 'otp'],
        text: ['sign in', 'log in', 'sign up', 'register', 'create account', 'email', 'password',
            'forgot password', 'remember me', 'confirm password', 'verification code', 'two-factor'],
        kinds: ['field', 'button'],
        flow: [
            { stage: 'credentials', markers: ['email', 'username', 'password', 'sign in', 'log in', 'sign up', 'register'], advance: ['sign in', 'log in', 'sign up', 'register', 'continue', 'next'] },
            { stage: 'verify', markers: ['verification', 'verify', 'code', 'otp', 'two-factor', 'we sent', 'enter the code'], advance: ['verify', 'confirm', 'submit', 'continue'] },
            { stage: 'authenticated', markers: ['welcome', 'dashboard', 'you are signed in', 'logged in', 'account created', 'home'], advance: [], terminal: true, success: true },
        ],
    },
    {
        id: 'content',
        label: 'Content / Media / Publishing',
        url: ['article', 'articles', 'post', 'posts', 'blog', 'news', 'watch', 'video', 'read', 'story', 'media'],
        text: ['read more', 'subscribe', 'newsletter', 'comments', 'share', 'related articles',
            'published', 'author', 'watch now', 'play', 'episodes', 'read the full'],
        kinds: ['link', 'media', 'text'],
        flow: [
            { stage: 'index', markers: ['latest', 'trending', 'articles', 'stories', 'browse', 'categories', 'topics'], advance: ['read', 'read more', 'view', 'watch', 'open'] },
            { stage: 'consume', markers: ['published', 'author', 'min read', 'comments', 'share', 'related'], advance: ['subscribe', 'comment', 'share', 'next'] },
            { stage: 'engaged', markers: ['subscribed', 'thanks for subscribing', 'comment posted', 'welcome to'], advance: [], terminal: true, success: true },
        ],
    },
    {
        id: 'search',
        label: 'Search / Listing / Marketplace',
        url: ['search', 'results', 'listings', 'browse', 'explore', 'find', 'directory', 'map', 'filter'],
        text: ['search', 'filter', 'sort by', 'results', 'showing', 'refine', 'price', 'location',
            'availability', 'reviews', 'per night', 'listings', 'no results found'],
        kinds: ['field', 'card', 'select'],
        flow: [
            { stage: 'query', markers: ['search', 'find', 'where', 'what are you looking', 'enter a'], advance: ['search', 'find', 'go', 'apply filters'] },
            { stage: 'results', markers: ['results', 'showing', 'listings', 'sort by', 'filter', 'refine'], advance: ['view', 'details', 'select', 'open', 'book'] },
            { stage: 'detail', markers: ['details', 'description', 'reviews', 'availability', 'contact', 'book now'], advance: ['book', 'reserve', 'contact', 'select', 'continue'] },
            { stage: 'secured', markers: ['booked', 'reserved', 'request sent', 'confirmed', 'thank you'], advance: [], terminal: true, success: true },
        ],
    },
];

/**
 * Build a taxonomy view, optionally merging caller-supplied archetypes/lexicons.
 * The built-in constants are never mutated (additive override only).
 * @param {{archetypes?:Object[], lexicon?:Object, urlHints?:Object}} [opts]
 * @returns {{archetypes:Object[], lexicon:Object, urlHints:Object, byId:(id:string)=>Object}}
 */
function buildTaxonomy(opts = {}) {
    const archetypes = ARCHETYPES.concat(Array.isArray(opts.archetypes) ? opts.archetypes : []);
    const lexicon = {
        success: LEXICON.success.concat((opts.lexicon && opts.lexicon.success) || []),
        error: LEXICON.error.concat((opts.lexicon && opts.lexicon.error) || []),
        advance: LEXICON.advance.concat((opts.lexicon && opts.lexicon.advance) || []),
        regress: LEXICON.regress.concat((opts.lexicon && opts.lexicon.regress) || []),
    };
    const urlHints = {
        success: URL_HINTS.success.concat((opts.urlHints && opts.urlHints.success) || []),
        error: URL_HINTS.error.concat((opts.urlHints && opts.urlHints.error) || []),
    };
    const index = new Map(archetypes.map((a) => [a.id, a]));
    return {
        archetypes,
        lexicon,
        urlHints,
        byId: (id) => index.get(id) || null,
    };
}

module.exports = { ARCHETYPES, LEXICON, URL_HINTS, buildTaxonomy };
