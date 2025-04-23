import Anthropic from '@anthropic-ai/sdk';

// --- Generic Message Types ---
export type MessageRole = 'user' | 'assistant';

export type TextContent = {
  type: 'text';
  text: string;
};

export type ToolUseContent = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultContent = {
  type: 'tool_result';
  tool_use_id: string;
  content: Array<TextContent>; // Simplify to only allow TextContent for now
  is_error?: boolean;
};

export type MessageContentBlock = TextContent | ToolUseContent | ToolResultContent;

export type MessageContent = string | Array<MessageContentBlock>;

export interface Message {
  role: MessageRole;
  content: MessageContent;
}

// --- Generic Tool Types ---
// Aligning with Anthropic.Tool for simplicity for now
export type Tool = Anthropic.Messages.Tool;

// --- Generic LLM Service Types ---
export interface LLMResponse {
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null; // Simplified
  content: Array<TextContent | ToolUseContent>; // Assuming response can be text or tool request
}

// --- LLM Service Interface ---
export interface ILLMService {
  sendMessage(
    history: Message[],
    tools?: Tool[]
  ): Promise<LLMResponse>;
} 