import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer, verifyPanelIdentity } from './server.js';

const config = loadConfig();
await verifyPanelIdentity(config);
const server = createServer(config);
const transport = new StdioServerTransport();

await server.connect(transport);
