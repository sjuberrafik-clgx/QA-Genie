/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PopupHandler — Centralized Popup & Modal Dismissal Utility
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Facade over individual popup page objects. Generated scripts MUST import and
 * use this utility instead of writing inline popup-dismiss code.
 *
 * Usage:
 *   const { PopupHandler } = require('../../utils/popupHandler');
 *   const popups = new PopupHandler(page);
 *   await popups.dismissAll();               // dismiss every known popup
 *   await popups.waitForPageReady();          // networkidle + dismiss all
 *
 * Also available through POmanager:
 *   poManager.dismissAllPopups()
 *   poManager.welcomePopUp()
 *   poManager.agentBranding()
 *   poManager.skipAllComparePopUp()
 *   poManager.offLimitsAgentPopUp()
 *
 * @module popupHandler
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const WelcomePopUp = require('../pageobjects/welcomePopUp');
const AgentBranding = require('../pageobjects/agentBranding');
const CompareAllPopUp = require('../pageobjects/compareAllPopUp');
const OffLimitsAgentPopUp = require('../pageobjects/offLimitsAgentPopUp');

class PopupHandler {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // Delegate to existing page objects — no duplicated locators
        this._welcome = new WelcomePopUp(page);
        this._agentBranding = new AgentBranding(page);
        this._compare = new CompareAllPopUp(page);
        this._offLimits = new OffLimitsAgentPopUp(page);
    }

    // ─── Individual Dismiss Methods ─────────────────────────────────

    /**
     * Dismiss the welcome / agent-branding modal (Continue CTA).
     * Covers both the classic welcome-modal and the agent-branding variant.
     */
    async dismissWelcome() {
        try {
            const container = this._agentBranding.agentBrandingContainer;
            await container.waitFor({ state: 'visible', timeout: 5000 });
            // Prefer the primary "Continue" button inside the modal
            const continueBtn = this._agentBranding.ContinueAgentPopUp;
            if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await continueBtn.click();
            } else {
                // Fallback to close icon
                await this._agentBranding.closeCTA.click();
            }
            await this.page.waitForLoadState('domcontentloaded');
        } catch {
            // Modal not present — continue silently
        }
    }

    /**
     * Dismiss the agent branding popup specifically.
     */
    async dismissAgentBranding() {
        try {
            const container = this._agentBranding.agentBrandingContainer;
            if (await container.isVisible({ timeout: 3000 }).catch(() => false)) {
                await this._agentBranding.closeCTA.click();
                await this.page.waitForLoadState('domcontentloaded');
            }
        } catch {
            // Not present
        }
    }

    /**
     * Dismiss the compare / tour-step popover ("Skip All").
     */
    async dismissComparePopup() {
        try {
            await this._compare.skipAllComparePopUp();
        } catch {
            // Not present
        }
    }

    /**
     * Alias for dismissComparePopup — matches copilot-instructions naming.
     */
    async dismissTourOverlay() {
        await this.dismissComparePopup();
    }

    /**
     * Dismiss the "Off Limits in Agent Preview" modal (OK button).
     */
    async dismissOffLimitsPopup() {
        try {
            const container = this._offLimits.container;
            if (await container.isVisible({ timeout: 3000 }).catch(() => false)) {
                await this._offLimits.okButton.click();
                await this.page.waitForLoadState('domcontentloaded');
            }
        } catch {
            // Not present
        }
    }

    // ─── Batch Dismiss ──────────────────────────────────────────────

    /**
     * Dismiss ALL known popups in precedence order.
     * Safe to call at any point — silently skips popups that aren't showing.
     */
    async dismissAll() {
        await this.dismissWelcome();
        await this.dismissAgentBranding();
        await this.dismissComparePopup();
        await this.dismissOffLimitsPopup();
    }

    // ─── Convenience ────────────────────────────────────────────────

    /**
     * Wait for network idle + dismiss all known popups.
     * Use after page.goto() or any navigation action.
     */
    async waitForPageReady() {
        await this.page.waitForLoadState('networkidle').catch(() => { });
        await this.dismissAll();
    }

    // ─── Static Analysis Helper ──────────────────────────────────

    /**
     * Analyze MCP exploration data and map detected popups to handler methods.
     * Used by the SDK `suggest_popup_handler` custom tool.
     *
     * @param {Object} explorationData - Parsed exploration JSON
     * @param {Array}  explorationData.popupsDetected - Array of { type, selector, dismissButton }
     * @returns {{ suggestions: Array, importStatement: string, usageExample: string }}
     */
    static suggestPopupHandler(explorationData) {
        const KNOWN_HANDLERS = {
            'welcome-modal': { method: 'dismissWelcome()', className: 'PopupHandler' },
            'agent-branding': { method: 'dismissAgentBranding()', className: 'PopupHandler' },
            'compare-popup': { method: 'dismissComparePopup()', className: 'PopupHandler' },
            'tour-overlay': { method: 'dismissTourOverlay()', className: 'PopupHandler' },
            'off-limits': { method: 'dismissOffLimitsPopup()', className: 'PopupHandler' },
            'compare-all': { method: 'dismissComparePopup()', className: 'PopupHandler' },
        };

        const popups = (explorationData && explorationData.popupsDetected) || [];
        const suggestions = popups.map(popup => {
            const key = (popup.type || '').toLowerCase().replace(/[\s_]+/g, '-');
            const handler = KNOWN_HANDLERS[key] || null;
            return {
                type: popup.type,
                selector: popup.selector || null,
                handled: !!handler,
                handlerMethod: handler ? `popups.${handler.method}` : null,
                suggestion: handler
                    ? `await popups.${handler.method};`
                    : `// TODO: New popup type "${popup.type}" — consider adding to PopupHandler`,
            };
        });

        const hasUnhandled = suggestions.some(s => !s.handled);
        return {
            suggestions,
            allHandled: !hasUnhandled,
            importStatement: "const { PopupHandler } = require('../../utils/popupHandler');",
            usageExample: [
                'const popups = new PopupHandler(page);',
                'await popups.dismissAll();               // dismiss every known popup',
                'await popups.waitForPageReady();          // networkidle + dismiss all',
            ].join('\n'),
            batchDismiss: 'await popups.dismissAll();',
        };
    }
}

module.exports = { PopupHandler };
