'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '@/lib/api-client';
import { getFallbackAgentCatalog, normalizeAgentCatalogItem } from '@/lib/agent-options';

export default function useAgentCatalog(options = {}) {
    const includeInactive = options?.includeInactive === true;
    const includeDraft = options?.includeDraft === true;
    const fallbackAgents = useMemo(() => getFallbackAgentCatalog(), []);
    const [agents, setAgents] = useState(fallbackAgents);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiClient.listChatAgents({ includeInactive, includeDraft });
            const items = Array.isArray(data?.items) && data.items.length > 0
                ? data.items.map(normalizeAgentCatalogItem)
                : fallbackAgents;
            setAgents(items);
            setError(null);
            return items;
        } catch (err) {
            setAgents((current) => (Array.isArray(current) && current.length > 0 ? current : fallbackAgents));
            setError(err.message || 'Failed to load agent catalog');
            return fallbackAgents;
        } finally {
            setLoading(false);
        }
    }, [fallbackAgents, includeInactive, includeDraft]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return {
        agents,
        defaultAgent: agents[0] || fallbackAgents[0],
        loading,
        error,
        refresh,
    };
}