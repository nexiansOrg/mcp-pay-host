import { config } from 'dotenv';
import path from 'path';

// Load .env file from project root or current working directory
config({ path: path.resolve(process.cwd(), '.env') });

// Check for essential environment variables
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  console.error('Please add your API key to the .env file');
  process.exit(1);
}

export const configValues = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  mcpServerUrl: process.env.MCP_SERVER_URL || 'http://localhost:3000/mcp',
}; 