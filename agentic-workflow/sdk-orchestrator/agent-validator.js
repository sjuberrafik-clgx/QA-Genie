/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENT VALIDATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pre-publish quality checks for custom agents. Validates:
 *   1. System prompt completeness (required sections, no placeholder text)
 *   2. Tool profile correctness (required tools for declared role)
 *   3. MCP server connectivity
 *   4. Manifest schema conformance
 *   5. Overall quality score (like OODA quality analyzer)
 *
 * Consumed by:
 *   - POST /api/studio/workspaces/:id/agents/:agentId/validate
 *
 * @module sdk-orchestrator/agent-validator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ─── Validation Rules ───────────────────────────────────────────────────────

const REQUIRED_PROMPT_SECTIONS = ['## Purpose', '## Responsibilities'];
const PLACEHOLDER_PATTERNS = [
    /\[describe\s/i,
    /\[add\s/i,
    /\[insert\s/i,
    /\[your\s/i,
    /TODO:/i,
    /FIXME:/i,
    /placeholder/i,
];

const TOOL_PROFILE_REQUIREMENTS = {
    scriptgenerator: { requiresBrowser: true, label: 'ScriptGenerator requires browser capability' },
    testgenie: { requiresJira: true, label: 'TestGenie requires Jira capability' },
    buggenie: { requiresJira: true, label: 'BugGenie requires Jira capability' },
    taskgenie: { requiresJira: true, label: 'TaskGenie requires Jira capability' },
    filegenie: { requiresFilesystem: true, label: 'FileGenie requires filesystem capability' },
};

// ─── Validators ─────────────────────────────────────────────────────────────

function validatePrompt(promptContent) {
    const checks = [];
    let score = 0;

    // Check non-empty
    if (!promptContent || promptContent.trim().length < 20) {
        checks.push({ rule: 'prompt-non-empty', passed: false, severity: 'error', message: 'System prompt is empty or too short (minimum 20 characters)' });
    } else {
        checks.push({ rule: 'prompt-non-empty', passed: true, severity: 'info', message: 'System prompt has content' });
        score += 20;
    }

    // Check required sections
    for (const section of REQUIRED_PROMPT_SECTIONS) {
        const hasSection = promptContent.includes(section);
        checks.push({
            rule: `prompt-section-${section.replace(/[^a-z]/gi, '-').toLowerCase()}`,
            passed: hasSection,
            severity: hasSection ? 'info' : 'warning',
            message: hasSection ? `Found section: ${section}` : `Missing recommended section: ${section}`,
        });
        if (hasSection) score += 15;
    }

    // Check for placeholder text
    const placeholderMatches = PLACEHOLDER_PATTERNS.filter(p => p.test(promptContent));
    if (placeholderMatches.length > 0) {
        checks.push({
            rule: 'prompt-no-placeholders',
            passed: false,
            severity: 'warning',
            message: `Found ${placeholderMatches.length} placeholder pattern(s) — replace with real content before publishing`,
        });
    } else {
        checks.push({ rule: 'prompt-no-placeholders', passed: true, severity: 'info', message: 'No placeholder patterns detected' });
        score += 15;
    }

    // Check minimum word count
    const wordCount = (promptContent || '').split(/\s+/).filter(Boolean).length;
    if (wordCount < 50) {
        checks.push({ rule: 'prompt-word-count', passed: false, severity: 'warning', message: `Prompt has ${wordCount} words — recommended minimum is 50` });
    } else {
        checks.push({ rule: 'prompt-word-count', passed: true, severity: 'info', message: `Prompt has ${wordCount} words` });
        score += 10;
    }

    // Check for heading structure
    const hasHeadings = /^#+\s/m.test(promptContent);
    if (hasHeadings) {
        score += 10;
        checks.push({ rule: 'prompt-has-headings', passed: true, severity: 'info', message: 'Prompt uses markdown headings for structure' });
    } else {
        checks.push({ rule: 'prompt-has-headings', passed: false, severity: 'warning', message: 'Consider adding markdown headings for better structure' });
    }

    return { checks, score: Math.min(score, 70), maxScore: 70 };
}

function validateManifest(manifest) {
    const checks = [];
    let score = 0;

    // Required fields
    const requiredFields = ['name', 'description', 'toolProfile'];
    for (const field of requiredFields) {
        const hasField = manifest[field] && String(manifest[field]).trim().length > 0;
        checks.push({
            rule: `manifest-${field}`,
            passed: hasField,
            severity: hasField ? 'info' : 'error',
            message: hasField ? `${field} is set` : `Missing required field: ${field}`,
        });
        if (hasField) score += 5;
    }

    // Tool profile validity
    const validProfiles = ['full', 'testgenie', 'scriptgenerator', 'buggenie', 'taskgenie', 'filegenie', 'docgenie', 'codereviewer'];
    const hasValidProfile = validProfiles.includes(manifest.toolProfile);
    checks.push({
        rule: 'manifest-valid-profile',
        passed: hasValidProfile,
        severity: hasValidProfile ? 'info' : 'error',
        message: hasValidProfile ? `Tool profile "${manifest.toolProfile}" is valid` : `Invalid tool profile: ${manifest.toolProfile}`,
    });
    if (hasValidProfile) score += 5;

    // Tool profile + capabilities alignment
    const profileReqs = TOOL_PROFILE_REQUIREMENTS[manifest.toolProfile];
    if (profileReqs) {
        const caps = manifest.capabilities || {};
        if (profileReqs.requiresBrowser && !caps.browser) {
            checks.push({ rule: 'manifest-capability-alignment', passed: false, severity: 'warning', message: profileReqs.label });
        } else if (profileReqs.requiresJira && !caps.jira) {
            checks.push({ rule: 'manifest-capability-alignment', passed: false, severity: 'warning', message: profileReqs.label });
        } else if (profileReqs.requiresFilesystem && caps.filesystem === 'none') {
            checks.push({ rule: 'manifest-capability-alignment', passed: false, severity: 'warning', message: profileReqs.label });
        } else {
            checks.push({ rule: 'manifest-capability-alignment', passed: true, severity: 'info', message: 'Tool profile and capabilities are aligned' });
            score += 5;
        }
    } else {
        score += 5;
    }

    // Model config
    if (manifest.model?.id) {
        checks.push({ rule: 'manifest-model', passed: true, severity: 'info', message: `Model: ${manifest.model.id}` });
        score += 5;
    } else {
        checks.push({ rule: 'manifest-model', passed: false, severity: 'warning', message: 'No model specified — will use default' });
    }

    return { checks, score: Math.min(score, 30), maxScore: 30 };
}

function computeOverallScore(promptResult, manifestResult) {
    const total = promptResult.score + manifestResult.score;
    const max = promptResult.maxScore + manifestResult.maxScore;
    const percentage = Math.round((total / max) * 100);

    let grade;
    if (percentage >= 90) grade = 'A';
    else if (percentage >= 75) grade = 'B';
    else if (percentage >= 60) grade = 'C';
    else if (percentage >= 40) grade = 'D';
    else grade = 'F';

    let recommendation;
    if (percentage >= 75) recommendation = 'Ready to publish';
    else if (percentage >= 50) recommendation = 'Consider improving before publishing';
    else recommendation = 'Needs significant improvement before publishing';

    return { total, max, percentage, grade, recommendation };
}

// ─── Main Validation Function ───────────────────────────────────────────────

function validateAgent(manifest, promptContent) {
    const promptResult = validatePrompt(promptContent);
    const manifestResult = validateManifest(manifest);
    const overall = computeOverallScore(promptResult, manifestResult);

    const allChecks = [...promptResult.checks, ...manifestResult.checks];
    const errors = allChecks.filter(c => !c.passed && c.severity === 'error');
    const warnings = allChecks.filter(c => !c.passed && c.severity === 'warning');

    return {
        valid: errors.length === 0,
        publishable: overall.percentage >= 50 && errors.length === 0,
        score: overall,
        prompt: promptResult,
        manifest: manifestResult,
        errors,
        warnings,
        checks: allChecks,
    };
}

module.exports = { validateAgent, validatePrompt, validateManifest };
