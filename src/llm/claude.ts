import Anthropic from '@anthropic-ai/sdk';
import { ILLMService, Message, Tool, LLMResponse, TextContent, ToolUseContent, MessageContentBlock } from '../types.js'; // Path is relative to src/llm/
import { configValues } from '../config.js';

// Renamed class to match file name
export class Claude implements ILLMService {
  private client: Anthropic;
  private model = 'claude-3-5-sonnet-20240620'; // Use the latest appropriate model
  private maxTokens = 1024;

  constructor() {
    this.client = new Anthropic({
      apiKey: configValues.anthropicApiKey,
    });
  }

  async sendMessage(history: Message[], tools?: Tool[]): Promise<LLMResponse> {
    try {
      // Convert generic Message history to Anthropic format
      const anthropicMessages: Anthropic.Messages.MessageParam[] = history.map(msg => {
        // Explicitly handle different content types for conversion
        let anthropicContent: Anthropic.Messages.MessageParam['content'];
        if (typeof msg.content === 'string') {
          anthropicContent = msg.content;
        } else {
          // Add explicit type to contentBlock parameter
          anthropicContent = msg.content.map((contentBlock: MessageContentBlock) => {
            if (contentBlock.type === 'text') {
              return { type: 'text', text: contentBlock.text } as Anthropic.TextBlockParam;
            }
            if (contentBlock.type === 'tool_use') {
              // This case should only appear in assistant messages, but handle defensively
              console.warn('ToolUseContent found in history mapping, this might be unexpected.');
              return { 
                  type: 'tool_use', 
                  id: contentBlock.id, 
                  name: contentBlock.name, 
                  input: contentBlock.input 
              } as Anthropic.ToolUseBlockParam;
            }
            if (contentBlock.type === 'tool_result') {
              // Map our simplified ToolResultContent to Anthropic's ToolResultBlockParam
              return {
                type: 'tool_result',
                tool_use_id: contentBlock.tool_use_id,
                content: contentBlock.content.map(c => ({ type: 'text', text: c.text })), // Map inner content
                is_error: contentBlock.is_error
              } as Anthropic.ToolResultBlockParam;
            }
            // Fallback for unknown types
            console.warn('Unknown content block type during history mapping:', (contentBlock as any).type);
            return { type: 'text', text: `[Unsupported content type]` } as Anthropic.TextBlockParam;
          });
        }
        
        return {
          role: msg.role,
          content: anthropicContent,
        };
      });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: anthropicMessages,
        tools: tools?.length ? tools : undefined,
      });

      // Convert Anthropic response content to generic format
      const genericContent = response.content
        .map((contentBlock: Anthropic.ContentBlock): TextContent | ToolUseContent | null => {
          if (contentBlock.type === 'text') {
            return { type: 'text', text: contentBlock.text };
          }
          if (contentBlock.type === 'tool_use') {
              return {
                  type: 'tool_use',
                  id: contentBlock.id,
                  name: contentBlock.name,
                  input: contentBlock.input as Record<string, unknown>
              };
          }
          // Explicitly ignore other types like 'thinking'
          console.log(`Ignoring Anthropic content block type: ${contentBlock.type}`);
          return null; 
        })
        // Add explicit type definition for the filter parameter `c`
        .filter((c: TextContent | ToolUseContent | null): c is TextContent | ToolUseContent => c !== null);

      return {
        stop_reason: response.stop_reason,
        content: genericContent,
      };
    } catch (error: any) {
      console.error('Error calling Claude API:', error);
      // Return an error-like response
      return {
        stop_reason: 'end_turn', // Treat error as end turn
        content: [{
          type: 'text',
          text: `Error interacting with LLM: ${error.message || error}`,
        }],
      };
    }
  }
} 