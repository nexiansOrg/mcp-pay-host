import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// ... other MCP SDK imports ...
import { Tool } from '../types.js';
import { configValues } from '../config.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    ListToolsRequest,
    ListToolsResultSchema,
    CallToolRequest,
    CallToolResultSchema,
    ListResourcesRequest,
    ListResourcesResultSchema,
    ReadResourceRequest,
    ReadResourceResultSchema,
    ListPromptsRequest,
    ListPromptsResultSchema,
    GetPromptRequest,
    GetPromptResultSchema,
    Tool as McpToolDefinition,
    Resource,
    Prompt,
    CallToolResult,
    ReadResourceResult,
    GetPromptResult,
    LoggingMessageNotificationSchema,
    InitializeResult,
    InitializeResultSchema
} from '@modelcontextprotocol/sdk/types.js';
import { getPayerAddress, signPayload } from '../wallet/wallet.js';

// Rename class to BaseBridge
export class BaseBridge {
  // Keep client, transport, sessionId, lastToolEventId
  protected client: Client | null = null; // Changed to protected
  protected transport: StreamableHTTPClientTransport | null = null; // Changed to protected
  protected sessionId: string | undefined = undefined; // Changed to protected
  protected lastToolEventId: string | undefined = undefined; // Changed to protected

  // Keep tools, resources, prompts state
  protected tools: Tool[] = []; // Changed to protected
  protected resources: Resource[] = []; // Changed to protected
  protected prompts: Prompt[] = []; // Changed to protected
  protected isConnected = false; // Changed to protected

  // Store server capabilities
  protected serverCapabilities: InitializeResult['capabilities'] | undefined = undefined;
  protected serverInitializationOptions: Record<string, unknown> | undefined = undefined;

  constructor() {}

  // connect method remains largely the same, but remove the call to fetchDepositInfo
  async connect(): Promise<void> {
    if (this.isConnected && this.client && this.transport) {
      console.log('Already connected to MCP server.');
      return;
    }
    
    this.isConnected = false;
    this.client = null;
    this.transport = null;
    this.serverCapabilities = undefined; // Reset on disconnect/reconnect
    this.serverInitializationOptions = undefined; // Reset on disconnect/reconnect

    console.log(`Connecting to MCP server at: ${configValues.mcpServerUrl}`);
    try {
        this.client = new Client({
          name: 'claude-mcp-bridge',
          version: '1.0.0',
        });

        this.client.onerror = (error: Error) => {
          console.error('\x1b[31mMCP Client Error:', error, '\x1b[0m');
          this.isConnected = false;
        };

        this.transport = new StreamableHTTPClientTransport(
          new URL(configValues.mcpServerUrl),
          { sessionId: this.sessionId }
        );
        
        // connect doesn't return initialize result directly
        await this.client.connect(this.transport);
        
        // Session ID is set after connection
        this.sessionId = this.transport.sessionId;
        this.isConnected = true;
        console.log(`Connected to MCP server! Session ID: ${this.sessionId}`);

        // Fetch tools/resources/prompts (Payment capabilities fetched separately)
        console.log('Fetching base tools, resources, and prompts...');
        await this.fetchMcpTools();
        await this.fetchMcpResources();
        await this.fetchMcpPrompts();
        console.log('Base fetching complete.');

    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      this.isConnected = false;
      this.client = null;
      this.transport = null;
      this.sessionId = undefined;
      this.serverCapabilities = undefined;
      this.serverInitializationOptions = undefined;
      throw new Error('MCP connection failed');
    }
  }

  // disconnect method remains the same
  async disconnect(): Promise<void> {
      // ... (Disconnection logic as before) ...
  }

  // getTools, getResources, getPrompts return the stored array, which is initialized empty
  getTools(): Tool[] { return this.tools; } // No return error needed
  getResources(): Resource[] { return this.resources; } // No return error needed
  getPrompts(): Prompt[] { return this.prompts; } // No return error needed

  // fetchMcpTools, fetchMcpResources, fetchMcpPrompts remain the same
  protected async fetchMcpTools(): Promise<void> { // Changed to protected
    if (!this.client) return;
    try {
      const request: ListToolsRequest = { method: 'tools/list' };
      const result = await this.client.request(request, ListToolsResultSchema);
      // Map MCP tool definition to simpler Tool type for Claude
      this.tools = result.tools.map(tool => ({
        name: tool.name,
        description: tool.description ?? '',
        input_schema: tool.inputSchema,
      }));
      console.log(`Fetched ${this.tools.length} tools.`);
    } catch (error) {
      console.error('Error fetching MCP tools:', error);
      this.tools = []; // Reset on error
    }
  }
  protected async fetchMcpResources(): Promise<void> { // Changed to protected
    if (!this.client) return;
    try {
      const request: ListResourcesRequest = { method: 'resources/list' };
      const result = await this.client.request(request, ListResourcesResultSchema);
      this.resources = result.resources;
      console.log(`Fetched ${this.resources.length} resources.`);
    } catch (error) {
      console.error('Error fetching MCP resources:', error);
      this.resources = []; // Reset on error
    }
  }
  protected async fetchMcpPrompts(): Promise<void> { // Changed to protected
    if (!this.client) return;
    try {
      const request: ListPromptsRequest = { method: 'prompts/list' };
      const result = await this.client.request(request, ListPromptsResultSchema);
      this.prompts = result.prompts;
      console.log(`Fetched ${this.prompts.length} prompts.`);
    } catch (error) {
      console.error('Error fetching MCP prompts:', error);
      this.prompts = []; // Reset on error
    }
  }

  // readResource, getPrompt remain the same
  async readResource(uri: string): Promise<ReadResourceResult> {
    if (!this.client) throw new Error('Not connected');
    const request: ReadResourceRequest = {
      method: 'resources/read',
      params: { uri },
    };
    return this.client.request(request, ReadResourceResultSchema);
  }
  async getPrompt(name: string, args: Record<string, string>): Promise<GetPromptResult> {
    if (!this.client) throw new Error('Not connected');
    const request: GetPromptRequest = {
      method: 'prompts/get',
      params: { name, arguments: args },
    };
    return this.client.request(request, GetPromptResultSchema);
  }

  // Remove attachAuth helper, move to McpPayBridge
  // private async attachAuth(params: Record<string, unknown>): Promise<Record<string, unknown>> { ... }

  // callTool remains, but remove authentication logic
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new Error('Not connected');
    
    // No authentication logic here in the base bridge
    const finalArgs = { name, arguments: args };
    
    const request: CallToolRequest = {
      method: 'tools/call',
      params: finalArgs,
    };
    
    try {
        const result = await this.client.request(request, CallToolResultSchema);
        return result;
    } catch (error) {
        console.error(`Error calling tool ${name}:`, error);
        throw error;
    }
  }

  // Remove payment-specific methods
  // getDepositInfo(): string | undefined { ... }
  // getCurrentBalance(): string | undefined { ... }
  // async fetchDepositInfo(): Promise<void> { ... }
  // async fetchBalance(): Promise<void> { ... }
} 