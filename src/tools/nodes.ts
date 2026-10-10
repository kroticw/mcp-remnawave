import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RemnawaveClient } from '../client/index.js';
import { toolResult, toolError } from './helpers.js';

export function registerNodeTools(server: McpServer, client: RemnawaveClient, readonly: boolean) {
    server.tool(
        'nodes_list',
        'List all Remnawave nodes',
        {},
        async () => {
            try {
                const result = await client.getNodes();
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_get',
        'Get a specific node by UUID',
        {
            uuid: z.string().describe('Node UUID'),
        },
        async ({ uuid }) => {
            try {
                const result = await client.getNodeByUuid(uuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_tags_list',
        'List all node tags',
        {},
        async () => {
            try {
                const result = await client.getNodeTags();
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    if (readonly) return;

    server.tool(
        'nodes_create',
        'Create a new node in Remnawave',
        {
            name: z.string().describe('Node name'),
            address: z.string().describe('Node address (IP or hostname)'),
            port: z.number().optional().describe('Node port'),
            countryCode: z
                .string()
                .optional()
                .describe('Country code (e.g. US, DE, NL)'),
            isTrafficTrackingActive: z
                .boolean()
                .optional()
                .describe('Enable traffic tracking'),
            trafficLimitBytes: z
                .number()
                .optional()
                .describe('Traffic limit in bytes'),
            trafficResetDay: z
                .number()
                .optional()
                .describe('Day of month to reset traffic (1-31)'),
            notifyPercent: z
                .number()
                .optional()
                .describe('Traffic notification threshold percentage'),
            consumptionMultiplier: z
                .number()
                .optional()
                .describe('Traffic consumption multiplier'),
            activeConfigProfileUuid: z
                .string()
                .describe('Config profile UUID to assign'),
            activeInbounds: z
                .array(z.string())
                .describe('Array of inbound UUIDs to enable'),
        },
        async (params) => {
            try {
                const body: Record<string, unknown> = {
                    name: params.name,
                    address: params.address,
                    configProfile: {
                        activeConfigProfileUuid:
                            params.activeConfigProfileUuid,
                        activeInbounds: params.activeInbounds,
                    },
                };
                if (params.port !== undefined) body.port = params.port;
                if (params.countryCode !== undefined)
                    body.countryCode = params.countryCode;
                if (params.isTrafficTrackingActive !== undefined)
                    body.isTrafficTrackingActive =
                        params.isTrafficTrackingActive;
                if (params.trafficLimitBytes !== undefined)
                    body.trafficLimitBytes = params.trafficLimitBytes;
                if (params.trafficResetDay !== undefined)
                    body.trafficResetDay = params.trafficResetDay;
                if (params.notifyPercent !== undefined)
                    body.notifyPercent = params.notifyPercent;
                if (params.consumptionMultiplier !== undefined)
                    body.consumptionMultiplier = params.consumptionMultiplier;

                const result = await client.createNode(body);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_update',
        'Update an existing node. `activeConfigProfileUuid` and `activeInbounds` go together and replace the node profile binding. A new inbound list is stored but not pushed to the node: disable and enable the node to apply it',
        {
            uuid: z.string().describe('Node UUID to update'),
            name: z.string().optional().describe('New node name'),
            address: z.string().optional().describe('New address'),
            port: z.number().optional().describe('New port'),
            countryCode: z.string().optional().describe('New country code'),
            isTrafficTrackingActive: z
                .boolean()
                .optional()
                .describe('Enable/disable traffic tracking'),
            trafficLimitBytes: z
                .number()
                .optional()
                .describe('New traffic limit'),
            trafficResetDay: z
                .number()
                .optional()
                .describe('New traffic reset day'),
            notifyPercent: z
                .number()
                .optional()
                .describe('New notification threshold'),
            consumptionMultiplier: z
                .number()
                .optional()
                .describe('New consumption multiplier'),
            activeConfigProfileUuid: z
                .string()
                .optional()
                .describe('Config profile UUID; required together with activeInbounds'),
            activeInbounds: z
                .array(z.string())
                .optional()
                .describe('Inbounds active on the node, replacing the current list; requires activeConfigProfileUuid. UUIDs, or tags as "tag:<name>"'),
            addActiveInbounds: z
                .array(z.string())
                .optional()
                .describe('Activate these inbounds of the current profile (UUIDs or "tag:<name>")'),
            removeActiveInbounds: z
                .array(z.string())
                .optional()
                .describe('Deactivate these inbounds (UUIDs or "tag:<name>")'),
        },
        async ({ activeConfigProfileUuid, activeInbounds, addActiveInbounds, removeActiveInbounds, ...params }) => {
            try {
                if ((activeConfigProfileUuid === undefined) !== (activeInbounds === undefined)) {
                    throw new Error('activeConfigProfileUuid and activeInbounds must be set together');
                }
                const body: Record<string, unknown> = { ...params };
                if (activeConfigProfileUuid !== undefined || addActiveInbounds || removeActiveInbounds) {
                    body.configProfile = await resolveNodeProfile(client, params.uuid, {
                        activeConfigProfileUuid,
                        activeInbounds,
                        addActiveInbounds,
                        removeActiveInbounds,
                    });
                }
                const result = await client.updateNode(body);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_delete',
        'Delete a node from Remnawave',
        {
            uuid: z.string().describe('Node UUID to delete'),
        },
        async ({ uuid }) => {
            try {
                await client.deleteNode(uuid);
                return toolResult({
                    success: true,
                    message: `Node ${uuid} deleted`,
                });
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_enable',
        'Enable a disabled node',
        {
            uuid: z.string().describe('Node UUID'),
        },
        async ({ uuid }) => {
            try {
                const result = await client.enableNode(uuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_disable',
        'Disable a node',
        {
            uuid: z.string().describe('Node UUID'),
        },
        async ({ uuid }) => {
            try {
                const result = await client.disableNode(uuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_restart',
        'Restart a specific node',
        {
            uuid: z.string().describe('Node UUID'),
            forceRestart: z
                .boolean()
                .optional()
                .describe('Restart even if the node reports it is busy (default false)'),
        },
        async ({ uuid, forceRestart }) => {
            try {
                const result = await client.restartNode(uuid, forceRestart ?? false);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_restart_all',
        'Restart all nodes',
        {
            forceRestart: z
                .boolean()
                .optional()
                .describe('Restart even if nodes report they are busy (default false)'),
        },
        async ({ forceRestart }) => {
            try {
                const result = await client.restartAllNodes(forceRestart ?? false);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_reset_traffic',
        'Reset traffic counter for a node',
        {
            uuid: z.string().describe('Node UUID'),
        },
        async ({ uuid }) => {
            try {
                const result = await client.resetNodeTraffic(uuid);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_reorder',
        'Reorder nodes by providing an ordered array of node positions',
        {
            nodes: z
                .array(z.object({
                    viewPosition: z.number().describe('Sort position (0-based)'),
                    uuid: z.string().describe('Node UUID'),
                }))
                .describe('Ordered array of { viewPosition, uuid } objects'),
        },
        async ({ nodes }) => {
            try {
                const result = await client.reorderNodes(nodes);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_bulk_profile_modification',
        'Bulk modify config profile for selected nodes',
        {
            uuids: z.array(z.string()).describe('Array of node UUIDs'),
            configProfileUuid: z.string().describe('New config profile UUID'),
            activeInbounds: z.array(z.string()).describe('Array of inbound UUIDs to enable'),
        },
        async (params) => {
            try {
                const body = {
                    uuids: params.uuids,
                    configProfile: {
                        activeConfigProfileUuid: params.configProfileUuid,
                        activeInbounds: params.activeInbounds,
                    },
                };
                const result = await client.bulkNodeProfileModification(body);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_bulk_actions',
        'Bulk actions on selected nodes (enable/disable/restart/reset traffic)',
        {
            uuids: z.array(z.string()).describe('Array of node UUIDs'),
            action: z.enum(['ENABLE', 'DISABLE', 'RESTART', 'RESET_TRAFFIC']).describe('Action to perform'),
        },
        async (params) => {
            try {
                const result = await client.bulkNodeActions(params);
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );

    server.tool(
        'nodes_bulk_update',
        'Bulk update properties for selected nodes',
        {
            uuids: z.array(z.string()).describe('Array of node UUIDs'),
            countryCode: z.string().optional().describe('New country code'),
            consumptionMultiplier: z.number().optional().describe('New consumption multiplier'),
            providerUuid: z.string().optional().describe('Infra provider UUID'),
            tags: z.array(z.string()).optional().describe('Node tags'),
            activePluginUuid: z.string().optional().describe('Active plugin UUID'),
        },
        async (params) => {
            try {
                const { uuids, ...fields } = params;
                const result = await client.bulkUpdateNodes({ uuids, fields });
                return toolResult(result);
            } catch (e) {
                return toolError(e);
            }
        },
    );
}

const TAG_PREFIX = 'tag:';

interface InboundRef {
    uuid: string;
    tag: string;
}

/** Resolves "tag:<name>" references against `known`; anything else is taken as an inbound UUID. */
function inboundResolver(known: InboundRef[], scope: string): (ref: string) => string {
    return (ref) => {
        if (!ref.startsWith(TAG_PREFIX)) return ref;
        const tag = ref.slice(TAG_PREFIX.length);
        const matches = known.filter((i) => i.tag === tag);
        if (matches.length !== 1) throw new Error(`Inbound tag "${tag}" matches ${matches.length} inbounds of ${scope}`);
        return matches[0].uuid;
    };
}

function hasTags(...lists: (string[] | undefined)[]): boolean {
    return lists.some((l) => l?.some((r) => r.startsWith(TAG_PREFIX)));
}

function applyEdits(current: string[], add: string[], remove: string[]): string[] {
    const out = [...current];
    for (const id of add) if (!out.includes(id)) out.push(id);
    const drop = new Set(remove);
    return out.filter((id) => !drop.has(id));
}

/** Builds the configProfile block for a node update; fails on unknown inbound tags. */
async function resolveNodeProfile(
    client: RemnawaveClient,
    nodeUuid: string,
    edits: {
        activeConfigProfileUuid?: string;
        activeInbounds?: string[];
        addActiveInbounds?: string[];
        removeActiveInbounds?: string[];
    },
): Promise<{ activeConfigProfileUuid: string; activeInbounds: string[] }> {
    const editing = edits.addActiveInbounds !== undefined || edits.removeActiveInbounds !== undefined;
    let profileUuid = edits.activeConfigProfileUuid;
    let current: string[] = [];
    if (editing && edits.activeInbounds === undefined) {
        const node = (await client.getNodeByUuid(nodeUuid)) as {
            response?: { configProfile?: { activeConfigProfileUuid?: string | null; activeInbounds?: InboundRef[] } };
        };
        const cp = node.response?.configProfile;
        profileUuid = cp?.activeConfigProfileUuid ?? undefined;
        current = (cp?.activeInbounds ?? []).map((i) => i.uuid);
    }
    if (!profileUuid) throw new Error('The node has no config profile; set activeConfigProfileUuid and activeInbounds');

    let known: InboundRef[] = [];
    if (hasTags(edits.activeInbounds, edits.addActiveInbounds, edits.removeActiveInbounds)) {
        const list = (await client.getInboundsByProfileUuid(profileUuid)) as { response?: { inbounds?: InboundRef[] } };
        known = list.response?.inbounds ?? [];
    }
    const toUuid = inboundResolver(known, `profile ${profileUuid}`);
    const base = edits.activeInbounds ? edits.activeInbounds.map(toUuid) : current;
    return {
        activeConfigProfileUuid: profileUuid,
        activeInbounds: applyEdits(base, (edits.addActiveInbounds ?? []).map(toUuid), (edits.removeActiveInbounds ?? []).map(toUuid)),
    };
}
