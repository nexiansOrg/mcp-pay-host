# Claude + MCP Integration (Refactored)

A ChatGPT-like command-line interface that combines Claude with MCP tools and resources, refactored for modularity.

## Features

- Interactive command-line chat with Claude
- Seamless access to MCP server tools, resources, and prompts
- Modular design with separation of concerns (CLI, Controller, Services)
- Pluggable LLM service interface (currently implemented for Claude)
- Command handling for MCP resources and prompts
- Connects to an MCP server specified by `MCP_SERVER_URL`.
- Bridges Anthropic API calls to the MCP server's tools, resources, and prompts.
- Uses `viem` to manage a payer wallet derived from the `USER_MNEMONIC` environment variable.
- Automatically attaches authentication (`__payer` address and `__signature`) to paid MCP `tools/call` requests.
- Provides a simple CLI for interaction, including:
    - Sending chat messages to Claude (which may trigger MCP tool use).
    - Listing available MCP tools, resources, and prompts.
    - Directly calling MCP tools (`.tool <name> [json_args]`).
    - Checking payment deposit info (`.deposit`) and current balance (`.balance`).
    - Managing the MCP connection (`.connect`, `.disconnect`).

## Installation

```bash
# Install dependencies
npm install

# Create .env file with your API key
# Ensure MCP_SERVER_URL points to your running MCP server (defaults to http://localhost:3000/mcp)
cp .env.example .env 
# Then edit .env with your Anthropic API key
```

## Usage

First, make sure your MCP server is running. Then:

```bash
npm start
```

This will start the interactive chat. You can:

- Chat normally with Claude
- Ask Claude to use tools available from the MCP server (e.g., "Use the greet tool to say hello to Moritz")
- Use special commands:
  - `/resource [uri]` - List or fetch a resource
  - `/prompt <name> [key=value,...]` - Use a prompt template (output shown, not automatically sent to Claude)
  - `/history` - Show conversation history
  - `/clear` - Clear conversation history
  - `/help` - Show help message
  - `exit` - Quit the application

## Development

Build the TypeScript code:

```bash
npm run build
```

## Project Structure (`src/`)

- `cli.ts`: Main entry point, handles readline UI and command parsing.
- `config.ts`: Loads and provides configuration.
- `types.ts`: Core shared interfaces (`ILLMService`) and data types (`Message`, `Tool`).
- `chat/`: Contains the core chat engine:
  - `controller.ts`: Orchestrates the chat flow, manages history.
- `llm/`: Contains Language Model service implementations:
  - `claude.ts`: Implements `ILLMService` for Anthropic Claude.
- `mcp/`: Contains MCP interaction logic:
  - `bridge.ts`: Handles communication with the MCP server.
- `mcp-sdk/`: Contains the low-level MCP client SDK. 