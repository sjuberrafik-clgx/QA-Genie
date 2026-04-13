const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_GENERATED_ARTIFACT_DIRS = [
    'agentic-workflow/test-artifacts',
    'agentic-workflow/exploration-data',
    'agentic-workflow/test-cases',
    'agentic-workflow/test-results',
    'test-artifacts',
    'test-results',
    'playwright-report',
    'web-app/playwright-report',
    'web-app/test-results',
    'tests/specs',
    'tests-scratch/specs',
];

function normalizeRelativeDir(dirPath) {
    if (typeof dirPath !== 'string') return '';

    const normalized = dirPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    if (!normalized || normalized === '.') return '';
    return normalized.replace(/\/+$/, '');
}

function uniqueRoots(dirPaths, projectRoot = PROJECT_ROOT) {
    const seen = new Set();
    const roots = [];

    for (const dirPath of dirPaths) {
        const normalized = normalizeRelativeDir(dirPath);
        if (!normalized) continue;

        const resolved = path.resolve(projectRoot, normalized);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seen.has(key)) continue;
        seen.add(key);
        roots.push(resolved);
    }

    return roots;
}

function getGeneratedArtifactDirs(config = {}) {
    const dirs = new Set(DEFAULT_GENERATED_ARTIFACT_DIRS);
    const projectPaths = config?.projectPaths || {};

    [
        projectPaths.specsDir,
        projectPaths.testCasesDir,
        projectPaths.explorationDataDir,
        projectPaths.testResultsDir,
        projectPaths.playwrightReportDir,
        config?.documentDesign?.outputDir,
    ].forEach((dirPath) => {
        const normalized = normalizeRelativeDir(dirPath);
        if (normalized) dirs.add(normalized);
    });

    return Array.from(dirs);
}

function getGeneratedArtifactRoots(config = {}, projectRoot = PROJECT_ROOT) {
    return uniqueRoots(getGeneratedArtifactDirs(config), projectRoot);
}

function isPathInside(parentPath, candidatePath) {
    const relativePath = path.relative(parentPath, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isGeneratedArtifactPath(filePath, options = {}) {
    if (!filePath || typeof filePath !== 'string') return false;

    const projectRoot = options.projectRoot || PROJECT_ROOT;
    const roots = Array.isArray(options.roots) && options.roots.length > 0
        ? options.roots
        : getGeneratedArtifactRoots(options.config || {}, projectRoot);
    const resolved = path.resolve(filePath);
    const relativeToProject = path.relative(projectRoot, resolved);

    if (!relativeToProject || relativeToProject.startsWith('..')) return false;
    return roots.some((root) => isPathInside(root, resolved));
}

module.exports = {
    PROJECT_ROOT,
    getGeneratedArtifactDirs,
    getGeneratedArtifactRoots,
    isGeneratedArtifactPath,
    normalizeRelativeDir,
};