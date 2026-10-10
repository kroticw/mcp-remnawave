import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RemnawaveClient } from './client/index.js';
import { Config } from './config.js';
import { setRedactionEnabled } from './redact.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';

export async function verifyPanelIdentity(config: Config): Promise<void> {
    if (!config.expectedTitle) return;

    const status = (await new RemnawaveClient(config).getAuthStatus()) as {
        response?: { branding?: { title?: string } };
    };
    const title = status.response?.branding?.title;
    if (title !== config.expectedTitle) {
        throw new Error(
            `Panel identity mismatch: expected title "${config.expectedTitle}", the panel at ${config.baseUrl} says "${title}"`,
        );
    }
}

export function createServer(config: Config): McpServer {
    const server = new McpServer({
        name: config.expectedTitle ? `remnawave-mcp (${config.expectedTitle})` : 'remnawave-mcp',
        version: '2.4.0',
    });

    setRedactionEnabled(config.redact);
    const client = new RemnawaveClient(config);

    registerAllTools(server, client, config.readonly);
    registerAllResources(server, client);
    registerAllPrompts(server);

    return server;
}
