import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { toolResult, toolError } from './helpers.js';

export function registerSubscriptionTools(
    server: McpServer,
    client: RemnawaveClient,
) {
    server.tool(
        'subscriptions_get_by_id',
        'Get subscription details by numeric user ID',
        {
            userId: z.number().int().describe('Numeric user ID'),
        },
        async ({ userId }) => {
            try {
                const result = await client.getSubscriptionByUserId(userId);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'subscriptions_get_by_username',
        'Get subscription details by username',
        {
            username: z.string().describe('Username'),
        },
        async ({ username }) => {
            try {
                const result =
                    await client.getSubscriptionByUsername(username);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'subscriptions_get_by_short_uuid',
        'Get subscription details by short UUID',
        {
            shortUuid: z.string().describe('Short UUID'),
        },
        async ({ shortUuid }) => {
            try {
                const result =
                    await client.getSubscriptionByShortUuid(shortUuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'subscription_info',
        'Get subscription info by short UUID (public endpoint)',
        {
            shortUuid: z.string().describe('Short UUID'),
        },
        async ({ shortUuid }) => {
            try {
                const result =
                    await client.getSubscriptionInfo(shortUuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'subscriptions_get_raw_by_short_uuid',
        'Get raw subscription config by short UUID',
        { shortUuid: z.string().describe('Short UUID') },
        async ({ shortUuid }) => {
            try { return toolResult(await client.getSubscriptionByShortUuidRaw(shortUuid)); } catch (e) { return toolError(e); }
        },
    );

    server.tool(
        'subscriptions_get_subpage_config',
        'Get subscription page configuration',
        { shortUuid: z.string().describe('Short UUID') },
        async ({ shortUuid }) => {
            try { return toolResult(await client.getSubscriptionSubpageConfig(shortUuid)); } catch (e) { return toolError(e); }
        },
    );

    server.tool(
        'subscriptions_get_connection_keys',
        'Get connection keys of a user by numeric user ID',
        { userId: z.number().int().describe('Numeric user ID') },
        async ({ userId }) => {
            try { return toolResult(await client.getConnectionKeysByUserId(userId)); } catch (e) { return toolError(e); }
        },
    );

    server.tool(
        'subscription_request_history_list',
        'List subscription request history',
        {},
        async () => {
            try { return toolResult(await client.getSubscriptionRequestHistory()); } catch (e) { return toolError(e); }
        },
    );

    server.tool(
        'subscription_request_history_stats',
        'Get subscription request history statistics',
        {},
        async () => {
            try { return toolResult(await client.getSubscriptionRequestHistoryStats()); } catch (e) { return toolError(e); }
        },
    );
}
