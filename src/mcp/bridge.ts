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
import { getPayerAddress, signPayload } from '../wallet/wallet.js';

const DepositInfoResultSchema = z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
});
const GetBalanceResultSchema = z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
});

// Helper function to create canonical message string
// Ensure params are stringified deterministically
function createCanonicalMessage(method: string, params: Record<string, unknown>): string {
    // Create a copy of params excluding __signature
    const { __signature, ...paramsToSign } = params;
    // Ensure consistent key order by sorting
    const sortedParams = Object.keys(paramsToSign).sort().reduce((acc, key) => {
        acc[key] = paramsToSign[key];
        return acc;
    }, {} as Record<string, unknown>);
    return `${method}:${JSON.stringify(sortedParams)}`;
}

export class Bridge {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private sessionId: string | undefined = undefined;
  private lastToolEventId: string | undefined = undefined;

  private tools: Tool[] = [];
  private resources: Resource[] = [];
  private prompts: Prompt[] = [];
  private isConnected = false;

  private depositInfo: string | undefined = undefined;
  private currentBalance: string | undefined = undefined;

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
          {
            sessionId: this.sessionId,
          }
        );
        
        await this.client.connect(transport);
        
        this.transport = transport;
        this.sessionId = transport.sessionId;
        this.isConnected = true;
        console.log(`Connected to MCP server! Session ID: ${this.sessionId}`);

        await this.fetchDepositInfo();

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
    console.log('Initializing MCP Bridge (fetching tools, resources, prompts, payment info)...');
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

  // Helper to attach payer address and signature to request params
  private async attachAuth(params: Record<string, unknown>): Promise<Record<string, unknown>> {
      const payerAddress = getPayerAddress();
      if (!payerAddress) {
          console.warn('⚠️ Payer address not available. Cannot attach authentication.');
          // Depending on server requirements, might need to throw or return unmodified params
          return params; 
      }
      
      const paramsWithPayer = { ...params, __payer: payerAddress };
      
      // Create the canonical message string for signing
      const canonicalMessage = createCanonicalMessage('tools/call', paramsWithPayer);
      
      try {
          const signature = await signPayload(canonicalMessage);
          return { ...paramsWithPayer, __signature: signature };
      } catch (error) {
          console.error('Failed to sign request payload:', error);
          // Decide how to handle signing errors - throw or send without signature?
          // For MVP, maybe throw to make the issue visible
          throw new Error('Failed to create signature for request authentication.');
      }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new Error('Not connected');
    
    let finalArgs = { name, arguments: args };

    // Attach authentication ONLY for tool calls (as per plan)
    // Payment methods are excluded on the server-side check, but we could also exclude them here
    if (name !== 'payments/depositInfo' && name !== 'payments/getBalance') {
        try {
            finalArgs.arguments = await this.attachAuth(finalArgs.arguments);
        } catch (authError) {
            console.error('Authentication attachment failed:', authError);
            // Propagate the error - the call cannot proceed without auth
            throw authError;
        }
    } else {
        console.log(`Skipping authentication attachment for payment tool: ${name}`);
    }
    
    const request: CallToolRequest = {
      method: 'tools/call',
      params: finalArgs, // Use potentially modified args
    };
    
    try {
        const result = await this.client.request(request, CallToolResultSchema);
        return result;
    } catch (error) {
        console.error(`Error calling tool ${name}:`, error);
        throw error;
    }
  }

  getDepositInfo(): string | undefined {
      return this.depositInfo;
  }

  getCurrentBalance(): string | undefined {
      return this.currentBalance;
  }

  async fetchDepositInfo(): Promise<void> {
      if (!this.client) return;
      try {
          console.log('Fetching payment deposit info...');
          // Use the standard tools/call mechanism to invoke the payment tool
          const callResult = await this.callTool('payments_depositInfo', {});
          // Re-parse to our narrow schema for safety
          const result = DepositInfoResultSchema.parse(callResult);
          this.depositInfo = result.content[0]?.text ?? 'Error fetching deposit info.';
          console.log(`Deposit Info: ${this.depositInfo}`);
      } catch (error) {
          console.error('Error fetching deposit info:', error);
          this.depositInfo = 'Error fetching deposit info.';
      }
  }

  async fetchBalance(): Promise<void> {
      if (!this.client) return;
      const payerAddress = getPayerAddress();
      if (!payerAddress) {
          this.currentBalance = 'Payer address not configured.';
          return;
      }
      try {
          console.log('Fetching current balance...');
          // Invoke the payment balance tool via tools/call as required by the spec
          const callResult = await this.callTool('payments_getBalance', { payerAddress });
          const result = GetBalanceResultSchema.parse(callResult);
          this.currentBalance = result.content[0]?.text ?? 'Error fetching balance.';
          console.log(`Balance: ${this.currentBalance}`);
      } catch (error: any) {
          console.error('Error fetching balance:', error);
           if (error.data?.code === -32001 || error.message?.includes('Payment Required')) {
              this.currentBalance = 'Insufficient credits on server.';
           } else {
              this.currentBalance = 'Error fetching balance.';
           }
      }
  }
} 