import { ILLMService, Message, Tool, ToolUseContent, ToolResultContent, TextContent, MessageContent, MessageContentBlock } from '../types.js'; // Correct path relative to src/chat/
import { Bridge as McpBridge } from '../mcp/bridge.js'; // Correct path relative to src/chat/
// Removed ChatHistory import

// Renamed class to match file name
export class Controller {
  private llmService: ILLMService;
  private mcpBridge: McpBridge;
  private history: Message[] = []; // Integrated history

  constructor(llmService: ILLMService, mcpBridge: McpBridge) { // Removed chatHistory param
    this.llmService = llmService;
    this.mcpBridge = mcpBridge;
    // No need to assign chatHistory
  }

  // Method for CLI to get history
  getHistory(): Message[] {
      return [...this.history]; // Return copy
  }

  // Method for CLI to clear history
  clearHistory(): void {
      this.history = [];
  }

  async processUserMessage(userInput: string): Promise<string> {
    // Add user message to history
    this.history.push({ role: 'user', content: userInput }); // Use internal history

    return this.getNextAssistantResponse();
  }

  private async getNextAssistantResponse(): Promise<string> {
    console.log('LLM is thinking...');
    const currentHistory = [...this.history]; // Use internal history
    const tools = this.mcpBridge.getTools();

    const response = await this.llmService.sendMessage(currentHistory, tools);

    // Add raw assistant response structure to history (before processing tool use)
    this.history.push({ role: 'assistant', content: response.content }); // Use internal history

    if (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(
        (block: TextContent | ToolUseContent): block is ToolUseContent => block.type === 'tool_use'
      );

      if (toolUseBlock) {
        console.log(`LLM wants to use tool: ${toolUseBlock.name}`);
        console.log(`With input: ${JSON.stringify(toolUseBlock.input)}`);

        // Call the tool via MCP bridge
        const toolResult = await this.handleToolUse(toolUseBlock);

        // Add tool result to history
        // Use internal history
        this.history.push({ role: 'user', content: [toolResult] }); // Anthropic expects tool results as user role

        // Call LLM again with the tool result
        return this.getNextAssistantResponse();
      } else {
        console.error('Tool use indicated but no tool_use block found.');
        return 'An internal error occurred (missing tool use block).';
      }
    } else {
      // Normal text response
      const textResponse = response.content
        .filter((block: TextContent | ToolUseContent): block is TextContent => block.type === 'text')
        .map((block: TextContent) => block.text)
        .join('\n');
      
      return textResponse || '[LLM returned empty response]';
    }
  }

  private async handleToolUse(toolUse: ToolUseContent): Promise<ToolResultContent> {
    try {
      const mcpResult = await this.mcpBridge.callTool(toolUse.name, toolUse.input);
      console.log('MCP tool result:', mcpResult.content);
      
      // Convert MCP result content to the generic ToolResultContent format
      // Assuming MCP result content is compatible or needs simple mapping
      const toolResultContent: Array<TextContent> = mcpResult.content.map((item: any): TextContent => {
          if (item.type === 'text') {
              return { type: 'text' as const, text: item.text };
          }
          // Handle other MCP content types if necessary, converting them to text for now
          console.warn('Converting non-text MCP tool result content to JSON string');
          return { type: 'text' as const, text: JSON.stringify(item) };
      });

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: toolResultContent, // Use the converted content
      };
    } catch (error: any) {
      console.error(`Error calling MCP tool ${toolUse.name}:`, error);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: [{ type: 'text', text: `Error executing tool: ${error.message || error}` }],
        is_error: true,
      };
    }
  }
} 