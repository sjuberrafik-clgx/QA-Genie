'use strict';

const { google } = require('googleapis');

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (!isNonEmptyString(value)) return fallback;
    return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function escapeDriveQueryValue(value) {
    return String(value || '').replace(/'/g, "\\'");
}

function buildFolderUrl(folderId) {
    return `https://drive.google.com/drive/folders/${folderId}`;
}

function buildSpreadsheetUrl(fileId) {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
}

function normalizePrivateKey(rawValue) {
    if (!isNonEmptyString(rawValue)) return '';
    const trimmed = rawValue.trim();

    if (trimmed.includes('BEGIN PRIVATE KEY')) {
        return trimmed.replace(/\\n/g, '\n');
    }

    try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
        if (decoded.includes('BEGIN PRIVATE KEY')) {
            return decoded.replace(/\\n/g, '\n');
        }
    } catch {
        // Ignore base64 decode errors and fall back to raw value.
    }

    return trimmed.replace(/\\n/g, '\n');
}

function buildDriveRuntimeConfig(overrides = {}) {
    return {
        enabled: parseBoolean(overrides.enabled ?? process.env.GDRIVE_ENABLED, false),
        authMode: String(overrides.authMode || process.env.GDRIVE_AUTH_MODE || 'service_account').trim().toLowerCase(),
        serviceAccountEmail: String(overrides.serviceAccountEmail || process.env.GDRIVE_SERVICE_ACCOUNT_EMAIL || '').trim(),
        serviceAccountPrivateKey: normalizePrivateKey(
            overrides.serviceAccountPrivateKey
            || process.env.GDRIVE_SERVICE_ACCOUNT_PRIVATE_KEY
            || process.env.GDRIVE_SERVICE_ACCOUNT_PRIVATE_KEY_B64
            || ''
        ),
        oauthClientId: String(overrides.oauthClientId || process.env.GDRIVE_OAUTH_CLIENT_ID || '').trim(),
        oauthClientSecret: String(overrides.oauthClientSecret || process.env.GDRIVE_OAUTH_CLIENT_SECRET || '').trim(),
        oauthRefreshToken: String(overrides.oauthRefreshToken || process.env.GDRIVE_OAUTH_REFRESH_TOKEN || '').trim(),
        testResultsFolderId: String(overrides.testResultsFolderId || process.env.GDRIVE_TEST_RESULTS_FOLDER_ID || '').trim(),
        expectedSpreadsheetCount: Number(overrides.expectedSpreadsheetCount || process.env.GDRIVE_EXPECTED_SPREADSHEET_COUNT || 3),
        strictCount: parseBoolean(overrides.strictCount ?? process.env.GDRIVE_STRICT_SPREADSHEET_COUNT, true),
        reuseDestinationFolder: parseBoolean(overrides.reuseDestinationFolder ?? process.env.GDRIVE_REUSE_DESTINATION_FOLDER, true),
        dryRun: parseBoolean(overrides.dryRun ?? process.env.GDRIVE_DRY_RUN, false),
    };
}

function validateDriveRuntimeConfig(config) {
    if (!config.enabled) {
        throw new Error('Google Drive automation is disabled. Set GDRIVE_ENABLED=true to use this feature.');
    }

    if (!isNonEmptyString(config.testResultsFolderId)) {
        throw new Error('GDRIVE_TEST_RESULTS_FOLDER_ID is required to target the Test Results parent folder.');
    }

    if (config.authMode === 'service_account') {
        if (!isNonEmptyString(config.serviceAccountEmail) || !isNonEmptyString(config.serviceAccountPrivateKey)) {
            throw new Error('Service account mode requires GDRIVE_SERVICE_ACCOUNT_EMAIL and GDRIVE_SERVICE_ACCOUNT_PRIVATE_KEY.');
        }
        return;
    }

    if (config.authMode === 'oauth') {
        if (!isNonEmptyString(config.oauthClientId)
            || !isNonEmptyString(config.oauthClientSecret)
            || !isNonEmptyString(config.oauthRefreshToken)) {
            throw new Error('OAuth mode requires GDRIVE_OAUTH_CLIENT_ID, GDRIVE_OAUTH_CLIENT_SECRET, and GDRIVE_OAUTH_REFRESH_TOKEN.');
        }
        return;
    }

    if (config.authMode === 'hybrid') {
        const hasService = isNonEmptyString(config.serviceAccountEmail) && isNonEmptyString(config.serviceAccountPrivateKey);
        const hasOAuth = isNonEmptyString(config.oauthClientId)
            && isNonEmptyString(config.oauthClientSecret)
            && isNonEmptyString(config.oauthRefreshToken);
        if (!hasService && !hasOAuth) {
            throw new Error('Hybrid mode requires either valid service account credentials or OAuth credentials.');
        }
        return;
    }

    throw new Error(`Unsupported GDRIVE_AUTH_MODE value: ${config.authMode}. Use service_account, oauth, or hybrid.`);
}

function createOAuthClient(config) {
    const oauthClient = new google.auth.OAuth2(config.oauthClientId, config.oauthClientSecret);
    oauthClient.setCredentials({ refresh_token: config.oauthRefreshToken });
    return oauthClient;
}

async function createDriveAuth(config) {
    validateDriveRuntimeConfig(config);

    if (config.authMode === 'service_account') {
        return {
            auth: new google.auth.JWT({
                email: config.serviceAccountEmail,
                key: config.serviceAccountPrivateKey,
                scopes: ['https://www.googleapis.com/auth/drive'],
            }),
            mode: 'service_account',
        };
    }

    if (config.authMode === 'oauth') {
        return {
            auth: createOAuthClient(config),
            mode: 'oauth',
        };
    }

    const hasService = isNonEmptyString(config.serviceAccountEmail) && isNonEmptyString(config.serviceAccountPrivateKey);
    if (hasService) {
        return {
            auth: new google.auth.JWT({
                email: config.serviceAccountEmail,
                key: config.serviceAccountPrivateKey,
                scopes: ['https://www.googleapis.com/auth/drive'],
            }),
            mode: 'service_account',
        };
    }

    return {
        auth: createOAuthClient(config),
        mode: 'oauth',
    };
}

function createDriveClient(auth) {
    return google.drive({ version: 'v3', auth });
}

async function getFolderById(drive, folderId) {
    const response = await drive.files.get({
        fileId: folderId,
        fields: 'id,name,mimeType,webViewLink,parents,trashed',
        supportsAllDrives: true,
    });

    const folder = response?.data;
    if (!folder || folder.trashed) {
        throw new Error(`Folder ${folderId} is unavailable or trashed.`);
    }
    if (folder.mimeType !== DRIVE_FOLDER_MIME) {
        throw new Error(`ID ${folderId} is not a folder.`);
    }

    return {
        id: folder.id,
        name: folder.name,
        webViewLink: folder.webViewLink || buildFolderUrl(folder.id),
    };
}

async function findChildFolderByName(drive, parentFolderId, folderName) {
    const query = [
        `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
        `mimeType='${DRIVE_FOLDER_MIME}'`,
        `name='${escapeDriveQueryValue(folderName)}'`,
        'trashed=false',
    ].join(' and ');

    const response = await drive.files.list({
        q: query,
        fields: 'files(id,name,webViewLink,createdTime)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'allDrives',
        pageSize: 10,
    });

    const files = Array.isArray(response?.data?.files) ? response.data.files : [];
    const folder = files
        .slice()
        .sort((left, right) => String(left.createdTime || '').localeCompare(String(right.createdTime || '')))[0];

    if (!folder) return null;

    return {
        id: folder.id,
        name: folder.name,
        webViewLink: folder.webViewLink || buildFolderUrl(folder.id),
    };
}

async function createFolder(drive, parentFolderId, folderName) {
    const response = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: DRIVE_FOLDER_MIME,
            parents: [parentFolderId],
        },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
    });

    const folder = response?.data;
    if (!folder?.id) {
        throw new Error(`Failed to create destination folder ${folderName}.`);
    }

    return {
        id: folder.id,
        name: folder.name,
        webViewLink: folder.webViewLink || buildFolderUrl(folder.id),
    };
}

async function createOrReuseChildFolder(drive, parentFolderId, folderName, reuseExisting) {
    if (reuseExisting) {
        const existing = await findChildFolderByName(drive, parentFolderId, folderName);
        if (existing) {
            return { ...existing, reused: true };
        }
    }

    const created = await createFolder(drive, parentFolderId, folderName);
    return { ...created, reused: false };
}

async function listSpreadsheetFilesInFolder(drive, folderId) {
    const query = [
        `'${escapeDriveQueryValue(folderId)}' in parents`,
        `mimeType='${DRIVE_SPREADSHEET_MIME}'`,
        'trashed=false',
    ].join(' and ');

    const files = [];
    let pageToken;

    do {
        const response = await drive.files.list({
            q: query,
            fields: 'nextPageToken,files(id,name,mimeType,webViewLink,createdTime,modifiedTime)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            corpora: 'allDrives',
            pageSize: 100,
            pageToken,
        });

        const pageFiles = Array.isArray(response?.data?.files) ? response.data.files : [];
        files.push(...pageFiles.map(file => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink || buildSpreadsheetUrl(file.id),
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
        })));

        pageToken = response?.data?.nextPageToken;
    } while (pageToken);

    return files.sort((left, right) => left.name.localeCompare(right.name));
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildReleaseAwareName(sourceName, sourceRelease, targetRelease) {
    const normalizedName = String(sourceName || '').trim();
    if (!normalizedName) return `${targetRelease} - Spreadsheet`;

    if (isNonEmptyString(sourceRelease)) {
        const releaseRegex = new RegExp(escapeRegex(sourceRelease), 'ig');
        if (releaseRegex.test(normalizedName)) {
            return normalizedName.replace(releaseRegex, targetRelease);
        }
    }

    const genericReleaseRegex = /R\d+\.\d+\.\d+/i;
    if (genericReleaseRegex.test(normalizedName)) {
        return normalizedName.replace(genericReleaseRegex, targetRelease);
    }

    return `${targetRelease} - ${normalizedName}`;
}

async function copySpreadsheetFile(drive, sourceFile, destinationFolderId, destinationName) {
    const response = await drive.files.copy({
        fileId: sourceFile.id,
        requestBody: {
            name: destinationName,
            parents: [destinationFolderId],
        },
        fields: 'id,name,webViewLink,mimeType',
        supportsAllDrives: true,
    });

    const file = response?.data;
    if (!file?.id) {
        throw new Error(`Failed to copy spreadsheet ${sourceFile.name}.`);
    }

    return {
        sourceId: sourceFile.id,
        sourceName: sourceFile.name,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink || buildSpreadsheetUrl(file.id),
    };
}

function findSanityResultsFile(files = []) {
    return files.find(file => /sanity\s*results/i.test(String(file?.name || '')))
        || files.find(file => /sanity/i.test(String(file?.name || '')))
        || null;
}

async function resolveSourceFolder(drive, config, options) {
    const sourceFolderId = isNonEmptyString(options.sourceFolderId)
        ? options.sourceFolderId.trim()
        : '';

    if (sourceFolderId) {
        return getFolderById(drive, sourceFolderId);
    }

    const sourceFolderName = String(options.sourceFolderName || '').trim();
    if (!sourceFolderName) {
        throw new Error('Provide sourceFolderId or sourceFolderName to locate the source regression folder.');
    }

    const parentFolderId = String(options.sourceParentFolderId || config.testResultsFolderId || '').trim();
    if (!parentFolderId) {
        throw new Error('A source parent folder ID is required when resolving sourceFolderName.');
    }

    const folder = await findChildFolderByName(drive, parentFolderId, sourceFolderName);
    if (!folder) {
        throw new Error(`Could not find source folder "${sourceFolderName}" under parent ${parentFolderId}.`);
    }

    return folder;
}

function validateReleaseOptions(config, options) {
    const targetRelease = String(options.targetRelease || '').trim();
    if (!targetRelease) {
        throw new Error('targetRelease is required (for example: R5.22.2).');
    }

    return {
        targetRelease,
        sourceRelease: String(options.sourceRelease || '').trim(),
        expectedSpreadsheetCount: Number(options.expectedSpreadsheetCount || config.expectedSpreadsheetCount || 3),
        strictCount: options.strictCount !== undefined ? Boolean(options.strictCount) : config.strictCount,
        destinationFolderName: String(options.destinationFolderName || `${targetRelease} HotFix Sanity`).trim(),
        dryRun: options.dryRun !== undefined ? Boolean(options.dryRun) : config.dryRun,
        reuseDestinationFolder: options.reuseDestinationFolder !== undefined
            ? Boolean(options.reuseDestinationFolder)
            : config.reuseDestinationFolder,
    };
}

async function prepareReleaseSanityWorkspace(rawOptions = {}) {
    const config = buildDriveRuntimeConfig(rawOptions.runtimeConfig || {});
    const releaseOptions = validateReleaseOptions(config, rawOptions);
    const { auth, mode } = await createDriveAuth(config);
    const drive = createDriveClient(auth);

    const testResultsFolder = await getFolderById(drive, config.testResultsFolderId);
    const sourceFolder = await resolveSourceFolder(drive, config, rawOptions);
    const destinationFolder = await createOrReuseChildFolder(
        drive,
        config.testResultsFolderId,
        releaseOptions.destinationFolderName,
        releaseOptions.reuseDestinationFolder
    );

    const sourceSpreadsheets = await listSpreadsheetFilesInFolder(drive, sourceFolder.id);
    const expectedCount = Math.max(1, releaseOptions.expectedSpreadsheetCount);

    if (releaseOptions.strictCount && sourceSpreadsheets.length < expectedCount) {
        throw new Error(
            `Expected at least ${expectedCount} spreadsheet files in source folder ${sourceFolder.name}, found ${sourceSpreadsheets.length}.`
        );
    }

    const selectedFiles = sourceSpreadsheets.slice(0, expectedCount);
    const copiedFiles = [];

    for (const sourceFile of selectedFiles) {
        const destinationName = buildReleaseAwareName(
            sourceFile.name,
            releaseOptions.sourceRelease,
            releaseOptions.targetRelease
        );

        if (releaseOptions.dryRun) {
            copiedFiles.push({
                sourceId: sourceFile.id,
                sourceName: sourceFile.name,
                id: `dryrun-${sourceFile.id}`,
                name: destinationName,
                mimeType: sourceFile.mimeType,
                webViewLink: sourceFile.webViewLink,
                dryRun: true,
            });
            continue;
        }

        copiedFiles.push(await copySpreadsheetFile(drive, sourceFile, destinationFolder.id, destinationName));
    }

    const sanityResultsFile = findSanityResultsFile(copiedFiles);

    return {
        success: true,
        authModeUsed: mode,
        dryRun: releaseOptions.dryRun,
        testResultsFolder,
        sourceFolder,
        destinationFolder,
        copiedFiles,
        selectedSourceFileCount: selectedFiles.length,
        sourceSpreadsheetCount: sourceSpreadsheets.length,
        sanityResultsFile,
        sanityResultsUrl: sanityResultsFile?.webViewLink || null,
        summary: {
            destinationFolderName: destinationFolder.name,
            destinationFolderUrl: destinationFolder.webViewLink || buildFolderUrl(destinationFolder.id),
            copiedCount: copiedFiles.length,
            sanityResultsFound: Boolean(sanityResultsFile),
        },
    };
}

module.exports = {
    buildDriveRuntimeConfig,
    buildFolderUrl,
    buildSpreadsheetUrl,
    buildReleaseAwareName,
    createDriveAuth,
    prepareReleaseSanityWorkspace,
};
