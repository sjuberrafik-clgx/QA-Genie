'use client';

import { useEffect, useMemo, useState } from 'react';
import apiClient, { isAbortError } from '@/lib/api-client';
import { MODEL_GROUPS, getDefaultModel, flattenModelGroups } from '@/lib/model-options';

const MODEL_CATALOG_RETRY_MS = 3000;
const MODEL_CATALOG_MAX_RETRIES = 6;

const FALLBACK_CATALOG = {
    groups: MODEL_GROUPS,
    models: flattenModelGroups(MODEL_GROUPS),
    defaultModel: getDefaultModel(MODEL_GROUPS),
    configuredDefaultModel: getDefaultModel(MODEL_GROUPS),
    defaultModelSource: 'client-fallback',
    source: 'client-fallback',
    warnings: ['Using built-in model fallback until the backend runtime catalog is available.'],
    ready: false,
};

export function useModelCatalog() {
    const [catalog, setCatalog] = useState(FALLBACK_CATALOG);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let disposed = false;
        let retryTimer = null;
        let attempts = 0;
        let activeController = null;

        function clearRetryTimer() {
            if (retryTimer !== null) {
                window.clearTimeout(retryTimer);
                retryTimer = null;
            }
        }

        function abortActiveRequest() {
            if (activeController) {
                activeController.abort();
                activeController = null;
            }
        }

        function withUniqueWarnings(currentCatalog, messages) {
            const merged = [...(currentCatalog.warnings || []), ...messages];
            return {
                ...currentCatalog,
                warnings: Array.from(new Set(merged)),
            };
        }

        function shouldRetry(result) {
            return attempts < MODEL_CATALOG_MAX_RETRIES && (!result?.ready || result?.source === 'fallback');
        }

        function scheduleRetry() {
            if (disposed) return;
            clearRetryTimer();
            retryTimer = window.setTimeout(() => {
                retryTimer = null;
                void loadCatalog(true);
            }, MODEL_CATALOG_RETRY_MS);
        }

        async function loadCatalog(refresh = false) {
            if (disposed) return;

            clearRetryTimer();
            abortActiveRequest();

            const controller = new AbortController();
            activeController = controller;

            try {
                const result = await apiClient.getModelCatalog(refresh, { signal: controller.signal });
                if (!disposed && !controller.signal.aborted) {
                    setCatalog(result);
                    setError(null);

                    if (shouldRetry(result)) {
                        attempts += 1;
                        scheduleRetry();
                    }
                }
            } catch (err) {
                if (disposed || controller.signal.aborted || isAbortError(err)) {
                    return;
                }

                if (!disposed) {
                    setError(err.message);
                    setCatalog(current => withUniqueWarnings(current, [
                        'Backend model catalog unavailable; using local fallback.',
                    ]));

                    if (attempts < MODEL_CATALOG_MAX_RETRIES) {
                        attempts += 1;
                        scheduleRetry();
                    }
                }
            } finally {
                if (activeController === controller) {
                    activeController = null;
                }

                if (!disposed && !controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }

        void loadCatalog();
        return () => {
            disposed = true;
            clearRetryTimer();
            abortActiveRequest();
        };
    }, []);

    return useMemo(() => ({
        groups: catalog.groups || MODEL_GROUPS,
        models: catalog.models || flattenModelGroups(MODEL_GROUPS),
        defaultModel: catalog.defaultModel || getDefaultModel(MODEL_GROUPS),
        configuredDefaultModel: catalog.configuredDefaultModel || getDefaultModel(MODEL_GROUPS),
        defaultModelSource: catalog.defaultModelSource || 'client-fallback',
        source: catalog.source || 'client-fallback',
        warnings: catalog.warnings || [],
        ready: catalog.ready ?? false,
        loading,
        error,
    }), [catalog, error, loading]);
}

export default useModelCatalog;