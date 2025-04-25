import { BaseBridge } from '../baseBridge.js';
import { getPayerAddress, signPayload } from '../../wallet/wallet.js';
import { z } from 'zod';
import { CallToolResult, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Replicate server-side types here for parsing capabilities
interface PaidToolInfo {
  toolName: string;
  cost: bigint; 
}

interface PaymentCapabilities {
  depositInfoResourceUri: string;
  balanceToolName: string;
  paidTools: PaidToolInfo[];
}

// Helper function to create canonical message string (moved from baseBridge)
// Ensure params are stringified deterministically
function createCanonicalMessage(method: string, params: Record<string, unknown>): string {
    const { __signature, ...paramsToSign } = params;
    const sortedParams = Object.keys(paramsToSign).sort().reduce((acc, key) => {
        acc[key] = paramsToSign[key];
        return acc;
    }, {} as Record<string, unknown>);
    return `${method}:${JSON.stringify(sortedParams)}`;
}

export class McpPayBridge extends BaseBridge {
  private paymentCapabilities: PaymentCapabilities | null = null;
  private currentBalance: string | undefined = undefined; // Store balance locally

  constructor() {
    super();
  }

  // Remove the connect override - base connect is sufficient now
  // async connect(): Promise<void> { ... }

  // Add method to fetch and parse payment capabilities
  async fetchAndParsePaymentCapabilities(): Promise<void> {
    if (!this.client) {
      console.warn('Cannot fetch payment capabilities: Not connected.');
      return;
    }
    
    console.log('Fetching payment capabilities via payments/getCapabilities...');
    try {
      // Define the request structure locally (could also import from a shared types package)
      const request = { method: 'payments/getCapabilities' };
      
      // Define expected result schema locally (could import)
      const ResultSchema = z.object({
        capabilities: z.object({
          depositInfoResourceUri: z.string(),
          balanceToolName: z.string(),
          paidTools: z.array(z.object({ toolName: z.string(), cost: z.string() })),
        })
      });
      
      const result = await this.client.request(request, ResultSchema);

      // Parse the transport result back into the internal format with BigInt
      this.paymentCapabilities = {
          depositInfoResourceUri: result.capabilities.depositInfoResourceUri,
          balanceToolName: result.capabilities.balanceToolName,
          paidTools: result.capabilities.paidTools.map(tool => ({
              toolName: tool.toolName,
              cost: BigInt(tool.cost) // Parse string cost back to BigInt
          })),
      };
      console.log('Payment capabilities parsed:', this.paymentCapabilities);

    } catch (error) {
        console.error('Error fetching or parsing payment capabilities:', error);
        this.paymentCapabilities = null; // Reset on error
    }
  }

  // --- Convenience methods for accessing capabilities ---
  getDepositInfoUri(): string | undefined {
      return this.paymentCapabilities?.depositInfoResourceUri;
  }

  getBalanceToolName(): string | undefined {
      return this.paymentCapabilities?.balanceToolName;
  }

  getPaidToolCost(toolName: string): bigint | undefined {
      return this.paymentCapabilities?.paidTools.find(t => t.toolName === toolName)?.cost;
  }

  // --- Authentication Helper (moved from base) ---
  private async attachAuth(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const payerAddress = getPayerAddress();
      if (!payerAddress) {
          console.warn('⚠️ Payer address not available. Cannot attach authentication.');
          return args; 
      }
      
      const argsWithPayer = { ...args, __payer: payerAddress };
      const canonicalMessage = createCanonicalMessage('tools/call', argsWithPayer);
      
      try {
          const signature = await signPayload(canonicalMessage);
          return { ...argsWithPayer, __signature: signature };
      } catch (error) {
          console.error('Failed to sign request payload:', error);
          throw new Error('Failed to create signature for request authentication.');
      }
  }

  // Override callTool to add authentication logic based on capabilities
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    let finalArgs = args;
    const cost = this.getPaidToolCost(name);

    if (cost !== undefined && cost > 0n) { // Check if it's a known paid tool
        console.log(`Attaching authentication for paid tool: ${name}`);
        try {
            finalArgs = await this.attachAuth(finalArgs);
        } catch (authError) {
            console.error('Authentication attachment failed:', authError);
            throw authError; // Propagate error
        }
    } else {
        console.log(`Skipping authentication attachment for tool: ${name} (free or unknown)`);
    }

    // Call the base implementation with potentially authenticated args
    return super.callTool(name, finalArgs);
  }

  // --- Payment-specific methods ---

  getCurrentBalance(): string | undefined {
      return this.currentBalance;
  }

  async fetchBalance(): Promise<void> {
      const balanceToolName = this.getBalanceToolName();
      if (!this.client || !balanceToolName) {
          this.currentBalance = 'Balance tool name not available from server capabilities.';
          console.warn(this.currentBalance);
          return;
      }
      const payerAddress = getPayerAddress();
      if (!payerAddress) {
          this.currentBalance = 'Payer address not configured.';
          console.warn(this.currentBalance);
          return;
      }

      try {
          console.log(`Fetching current balance using tool: ${balanceToolName}...`);
          // Call the balance tool (auth is skipped automatically by override logic if needed)
          const callResult = await this.callTool(balanceToolName, { payerAddress });
          // Assuming simple text result for balance
          const textResult = callResult.content?.find(c => c.type === 'text')?.text;
          this.currentBalance = textResult ?? 'Error: Could not parse balance from tool result.';
          console.log(`Balance: ${this.currentBalance}`);
      } catch (error: any) {
          console.error('Error fetching balance:', error);
           if (error.data?.code === -32001 || error.message?.includes('Payment Required')) {
              this.currentBalance = 'Insufficient credits on server (error during balance check).';
           } else {
              this.currentBalance = 'Error fetching balance.';
           }
      }
  }
} 