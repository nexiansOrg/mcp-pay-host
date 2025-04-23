#!/usr/bin/env -S npm run tsn -T

import readline from 'readline';
import { configValues } from './config.js'; // Use the new config module
import { Claude } from './llm/claude.js'; // Updated path
import { Bridge as McpBridge } from './mcp/bridge.js'; // Updated path
import { Controller as ChatController } from './chat/controller.js'; // Updated path
import { Message } from './types.js'; // Import Message type for history display

// --- Initialization ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const mcpBridge = new McpBridge();
const llmService = new Claude(); 
// Updated controller instantiation (no ChatHistory)
const chatController = new ChatController(llmService, mcpBridge);

// --- Helper Functions ---

function displayWelcomeMessage() {
  console.log('\n🤖 Claude + MCP Chat (Refactored) - Type "exit" to quit');
  
  const tools = mcpBridge.getTools();
  const resources = mcpBridge.getResources();
  const prompts = mcpBridge.getPrompts();

  if (tools.length > 0) {
    console.log('Available MCP tools:', tools.map(t => t.name).join(', '));
  }
  if (resources.length > 0) {
    console.log('Available MCP resources:', resources.map(r => r.uri).join(', '));
  }
  if (prompts.length > 0) {
    console.log('Available MCP prompts:', prompts.map(p => p.name).join(', '));
  }
  
  console.log('\nSpecial commands:');
  console.log('  /resource [uri] - List or fetch a resource');
  console.log('  /prompt <name> [args] - Use a prompt template');
  console.log('  /history - Show conversation history');
  console.log('  /clear - Clear conversation history');
  console.log('  /help - Show this help message');
  console.log('  /disconnect - Disconnect from the MCP server');
  console.log('  /reconnect - Reconnect to the MCP server');
  console.log('  /list-tools - List available tools');
  console.log('  /list-resources - List available resources');
  console.log('  /call-tool <name> [args] - Call a tool with JSON args');
  console.log('\nAsk Claude anything or use a command.');
}

function displayHelp() {
  console.log('\nSpecial commands:');
  console.log('  /resource [uri] - List available resources or fetch specific one by URI.');
  console.log('                      Example fetch: /resource file:///example.txt');
  console.log('  /prompt <name> [key=value,...] - Use a named prompt template with optional args.');
  console.log('                      Example: /prompt summarize text=long article here');
  console.log('  /history - Show the conversation history.');
  console.log('  /clear - Clear the current conversation history.');
  console.log('  /disconnect - Disconnect from the MCP server.');
  console.log('  /reconnect - Disconnect and reconnect to the MCP server.');
  console.log('  /list-tools - List available tools from the MCP server.');
  console.log('  /list-resources - List available resources from the MCP server.');
  console.log('  /call-tool <name> [args] - Call a tool with JSON arguments.');
  console.log('                      Example: /call-tool greet {"name":"World"}');
  console.log('  /help - Show this help message.');
  console.log('  exit - Quit the application.');
}

async function handleResourceCommand(args: string[]) {
  if (args.length === 0) {
    const resources = mcpBridge.getResources();
    if (resources.length === 0) {
        console.log('No MCP resources available from the server.');
        return;
    }
    console.log('Available resources:');
    resources.forEach(r => console.log(`  ${r.uri}${r.description ? ` - ${r.description}` : ''}`));
  } else {
    const uri = args[0];
    try {
      console.log(`Fetching resource: ${uri}...`);
      const readResult = await mcpBridge.readResource(uri);
      console.log(`--- Resource: ${uri} ---`);
      readResult.contents.forEach(content => {
        console.log(content.text || '[No text content]');
        if (content.mediaType) {
          console.log(`Media type: ${content.mediaType}`);
        }
        console.log('---');
      });
    } catch (error) {
      console.error(`Error reading resource ${uri}:`, error);
    }
  }
}

async function handlePromptCommand(args: string[]) {
  if (args.length === 0) {
    const prompts = mcpBridge.getPrompts();
    if (prompts.length === 0) {
        console.log('No MCP prompts available from the server.');
        return;
    }
    console.log('Available prompts:');
    prompts.forEach(p => console.log(`  ${p.name}${p.description ? ` - ${p.description}` : ''}`));
  } else {
    const promptName = args[0];
    const promptArgsStr = args.slice(1).join(' ');
    const promptArgs: Record<string, string> = {};
    // Basic key=value parsing (assumes no spaces in keys/values or quotes needed)
    if (promptArgsStr.trim()) {
      promptArgsStr.split(',').forEach(pair => {
        const [key, ...valueParts] = pair.split('=');
        if (key && valueParts.length > 0) {
          promptArgs[key.trim()] = valueParts.join('=').trim();
        }
      });
    }

    try {
      console.log(`Using prompt template: ${promptName} with args:`, promptArgs);
      const promptResult = await mcpBridge.getPrompt(promptName, promptArgs);
      
      // Find the user message in the prompt result to send to the LLM
      const userMessageContent = promptResult.messages
          .find(m => m.role === 'user')?.content;
          
      if (!userMessageContent) {
          console.log('Prompt template did not provide a user message.');
          return;
      }
      
      // Assume content is string or { type: 'text', text: ... } for simplicity
      const userText = typeof userMessageContent === 'string' 
          ? userMessageContent 
          : Array.isArray(userMessageContent) && userMessageContent[0]?.type === 'text' 
              ? userMessageContent[0].text
              : JSON.stringify(userMessageContent); // Fallback
              
      console.log('\n--- Prompt Output ---\n' + userText);
      // Optional: Ask user if they want to send this to the LLM
      // For now, just display it.
      // If sending: await processChatInput(userText);

    } catch (error) {
      console.error(`Error using prompt template ${promptName}:`, error);
    }
  }
}

function handleHistoryCommand() {
    const history: Message[] = chatController.getHistory(); // Call controller method
    if (history.length === 0) {
        console.log('Conversation history is empty.');
        return;
    }
    console.log('\n--- Conversation History ---');
    history.forEach(msg => {
        const contentStr = typeof msg.content === 'string' 
            ? msg.content 
            : JSON.stringify(msg.content, null, 2); // Pretty print complex content
        console.log(`${msg.role.toUpperCase()}: ${contentStr}`);
    });
    console.log('--- End History ---\n');
}

function handleClearCommand() {
    chatController.clearHistory(); // Call controller method
    console.log('Conversation history cleared.');
}

async function handleDisconnectCommand() {
  try {
    console.log('Disconnecting from MCP server...');
    await mcpBridge.disconnect();
    console.log('Disconnected from MCP server.');
  } catch (error) {
    console.error('Error disconnecting from MCP server:', error);
  }
}

async function handleReconnectCommand() {
  try {
    console.log('Reconnecting to MCP server...');
    
    // First disconnect
    await mcpBridge.disconnect();
    console.log('Disconnected.');
    
    // Then reconnect and reinitialize
    await mcpBridge.connect();
    console.log('Connected.');
    
    await mcpBridge.initialize();
    console.log('Initialized.');
    
    // Display current state
    const tools = mcpBridge.getTools();
    const resources = mcpBridge.getResources();
    const prompts = mcpBridge.getPrompts();
    
    console.log('Reconnected successfully!');
    if (tools.length > 0) {
      console.log('Available tools:', tools.map(t => t.name).join(', '));
    }
    if (resources.length > 0) {
      console.log('Available resources count:', resources.length);
    }
    if (prompts.length > 0) {
      console.log('Available prompts:', prompts.map(p => p.name).join(', '));
    }
  } catch (error) {
    console.error('Error reconnecting to MCP server:', error);
  }
}

async function handleListToolsCommand() {
  const tools = mcpBridge.getTools();
  if (tools.length === 0) {
    console.log('No MCP tools available from the server.');
    return;
  }
  
  console.log('Available tools:');
  tools.forEach(tool => {
    console.log(`  ${tool.name}${tool.description ? ` - ${tool.description}` : ''}`);
    // Optionally display input schema if detailed view is desired
    // console.log(`  Input schema: ${JSON.stringify(tool.input_schema, null, 2)}`);
    console.log('---');
  });
}

async function handleListResourcesCommand() {
  const resources = mcpBridge.getResources();
  if (resources.length === 0) {
    console.log('No MCP resources available from the server.');
    return;
  }
  
  console.log('Available resources:');
  resources.forEach(resource => {
    console.log(`  Name: ${resource.name || 'unnamed'}`);
    console.log(`  URI: ${resource.uri}`);
    if (resource.description) {
      console.log(`  Description: ${resource.description}`);
    }
    if (resource.mimeType) {
      console.log(`  MIME Type: ${resource.mimeType}`);
    }
    console.log('---');
  });
}

async function handleCallToolCommand(args: string[]) {
  if (args.length === 0) {
    return handleListToolsCommand(); // If no args, show available tools
  }
  
  const toolName = args[0];
  let toolArgs = {};
  
  // Try to parse arguments as JSON
  if (args.length > 1) {
    const argsText = args.slice(1).join(' ');
    try {
      toolArgs = JSON.parse(argsText);
      console.log(`Parsed arguments: ${JSON.stringify(toolArgs)}`);
    } catch (error) {
      console.error(`Error parsing JSON arguments: ${error}`);
      console.log('Using empty arguments instead.');
    }
  }
  
  try {
    console.log(`Calling tool '${toolName}' with arguments:`, toolArgs);
    const result = await mcpBridge.callTool(toolName, toolArgs);
    
    console.log('\nTool result:');
    if (result.content && result.content.length > 0) {
      result.content.forEach(item => {
        if (item.type === 'text') {
          console.log(`  ${item.text}`);
        } else {
          console.log(`  Content (${item.type}):`);
          console.log(JSON.stringify(item, null, 2));
        }
      });
    } else {
      console.log('  No content in result');
    }
  } catch (error) {
    console.error(`Error calling tool '${toolName}':`, error);
  }
}

async function handleSpecialCommand(input: string): Promise<boolean> {
  const [command, ...args] = input.slice(1).split(' ');
  const commandLower = command.toLowerCase();

  switch (commandLower) {
    case 'help':
      displayHelp();
      return true;
    case 'resource':
      await handleResourceCommand(args);
      return true;
    case 'prompt':
      await handlePromptCommand(args);
      return true;
    case 'history':
      handleHistoryCommand();
      return true;
    case 'clear':
      handleClearCommand();
      return true;
    case 'disconnect':
      await handleDisconnectCommand();
      return true;
    case 'reconnect':
      await handleReconnectCommand();
      return true;
    case 'list-tools':
      await handleListToolsCommand();
      return true;
    case 'list-resources':
      await handleListResourcesCommand();
      return true;
    case 'call-tool':
      await handleCallToolCommand(args);
      return true;
    default:
      console.log(`Unknown command: /${command}. Type /help for available commands.`);
      return true; // Indicate a command was handled (even if unknown)
  }
}

async function processChatInput(input: string) {
  try {
    const responseText = await chatController.processUserMessage(input);
    console.log(`\nClaude: ${responseText}\n`);
  } catch (error) {
    console.error('An error occurred during chat processing:', error);
  }
}

// --- Main Application Logic ---

async function main() {
  try {
    // Connect and initialize MCP Bridge first
    await mcpBridge.connect();
    await mcpBridge.initialize();

    displayWelcomeMessage();
    startChatLoop();

  } catch (error) {
    console.error('Fatal error during initialization:', error);
    shutdown();
  }
}

function startChatLoop() {
  rl.question('You: ', async (input) => {
    if (input.toLowerCase() === 'exit') {
      shutdown();
      return;
    }

    if (input.startsWith('/')) {
        await handleSpecialCommand(input);
    } else {
        await processChatInput(input);
    }
    
    startChatLoop(); // Continue the loop
  });
}

function shutdown() {
    console.log('\nShutting down...');
    mcpBridge.disconnect().finally(() => {
        console.log('Goodbye! 👋');
        rl.close();
        process.exit(0);
    });
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', shutdown);

// Start the application
main(); 