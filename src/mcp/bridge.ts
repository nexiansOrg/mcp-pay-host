import { Client } from '@modelcontextprotocol/sdk/client/index.js';
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
} from '@modelcontextprotocol/sdk/types.js';
import { Tool } from '../types.js';
import { configValues } from '../config.js';
import { z } from 'zod';

export class Bridge {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private sessionId: string | undefined = undefined;
  private lastToolEventId: string | undefined = undefined;

  private tools: Tool[] = [];
  private resources: Resource[] = [];
  private prompts: Prompt[] = [];
  private isConnected = false;

  constructor() {}

  async connect(): Promise<void> {
    if (this.isConnected && this.client && this.transport) {
      console.log('Already connected to MCP server.');
      return;
    }
    
    this.isConnected = false;
    this.client = null;
    this.transport = null;

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

        this.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification: z.infer<typeof LoggingMessageNotificationSchema>) => {
          console.log(`[MCP NOTIFICATION] ${notification.params.level}: ${notification.params.data}`);
        });
        
        const transport = new StreamableHTTPClientTransport(
          new URL(configValues.mcpServerUrl),
          { sessionId: this.sessionId }
        );
        
        await this.client.connect(transport);
        
        this.transport = transport;
        this.sessionId = transport.sessionId;
        this.isConnected = true;
        console.log(`Connected to MCP server! Session ID: ${this.sessionId}`);

    } catch (error) {
        console.error('Failed to connect to MCP server:', error);
        this.isConnected = false;
        this.client = null;
        this.transport = null;
        this.sessionId = undefined;
        throw new Error('MCP connection failed');
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected || !this.client || !this.transport) {
        console.log('Not connected, nothing to disconnect.');
        return;
    }

    const currentSessionId = this.sessionId;
    const currentTransport = this.transport;

    this.isConnected = false;
    this.client = null;
    this.transport = null;
    this.sessionId = undefined;

    if (currentSessionId) {
      try {
        console.log(`Attempting to terminate MCP session: ${currentSessionId}`);
        await currentTransport.terminateSession();
        console.log(`MCP session ${currentSessionId} terminated successfully.`);
      } catch (termError) {
        console.error(`Error terminating MCP session ${currentSessionId}:`, termError);
      } finally {
          try {
             await currentTransport.close();
          } catch (closeError) {
             console.error('Error during transport close:', closeError);
          }
      }
    } else {
        console.log('No session ID found, skipping server termination request.');
         try {
             await currentTransport.close();
         } catch (closeError) {
             console.error('Error during transport close:', closeError);
         }
    }
    
    console.log('MCP Bridge disconnected locally.');
  }

  async initialize(): Promise<void> {
    if (!this.isConnected || !this.client) {
        throw new Error('Must connect to MCP server before initializing.');
    }
    console.log('Initializing MCP Bridge (fetching tools, resources, prompts)...');
    await this.fetchMcpTools();
    await this.fetchMcpResources();
    await this.fetchMcpPrompts();
    console.log('MCP Bridge initialized.');
  }

  getTools(): Tool[] {
    return this.tools;
  }

  getResources(): Resource[] {
    return this.resources;
  }

  getPrompts(): Prompt[] {
    return this.prompts;
  }

  private async fetchMcpTools(): Promise<void> {
    if (!this.client) return;
    try {
      const request: ListToolsRequest = { method: 'tools/list', params: {} };
      const result = await this.client.request(request, ListToolsResultSchema);
      console.log('MCP tools found:', result.tools.length);
      this.tools = result.tools.map((tool: McpToolDefinition): Tool => ({
        name: tool.name,
        description: tool.description || `MCP tool: ${tool.name}`,
        input_schema: tool.inputSchema || { type: 'object', properties: {} },
      }));
    } catch (error) {
      console.error('Error fetching MCP tools:', error);
      this.tools = [];
    }
  }

  private async fetchMcpResources(): Promise<void> {
    if (!this.client) return;
    try {
      const request: ListResourcesRequest = { method: 'resources/list', params: {} };
      const result = await this.client.request(request, ListResourcesResultSchema);
      console.log('MCP resources found:', result.resources.length);
      this.resources = result.resources;
    } catch (error) {
      console.error('Error fetching MCP resources:', error);
      this.resources = [];
    }
  }

  private async fetchMcpPrompts(): Promise<void> {
    if (!this.client) return;
    try {
      const request: ListPromptsRequest = { method: 'prompts/list', params: {} };
      const result = await this.client.request(request, ListPromptsResultSchema);
      console.log('MCP prompts found:', result.prompts.length);
      this.prompts = result.prompts;
    } catch (error) {
      console.error('Error fetching MCP prompts:', error);
      this.prompts = [];
    }
  }

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

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new Error('Not connected');
    
    const request: CallToolRequest = {
      method: 'tools/call',
      params: { name, arguments: args },
    };
    
    const onLastEventIdUpdate = (eventId: string) => {
      this.lastToolEventId = eventId;
      console.log(`[MCP BRIDGE] Updated last tool event ID: ${eventId}`);
    };
    
    return this.client.request(request, CallToolResultSchema, {
        resumptionToken: this.lastToolEventId,
        onresumptiontoken: onLastEventIdUpdate
    });
  }
} 