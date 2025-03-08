import { Tool, Result as ToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Message, ProcessQueryResult } from '../../../../server/src/types.js';

export class LLMService {
  private apiUrl: string;

  constructor() {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) {
      throw new Error('VITE_API_URL environment variable is required');
    }
    this.apiUrl = apiUrl;
  }

  async processQuery(
    query: string, 
    tools: Tool[],
    history: Message[] = [],
    systemPrompt?: string
  ): Promise<ProcessQueryResult> {
    try {
      const response = await fetch(`${this.apiUrl}/llm/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, tools, history, systemPrompt })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process query');
      }

      return response.json();
    } catch (error) {
      console.error('Error in processQuery:', error);
      throw error;
    }
  }

  async processToolResult(
    toolCall: { name: string; args: Record<string, unknown>; id: string },
    toolResult: ToolResult,
    history: Message[],
    systemPrompt?: string
  ): Promise<ProcessQueryResult> {
    try {
      const response = await fetch(`${this.apiUrl}/llm/process-tool-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ toolCall, toolResult, history, systemPrompt })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process tool result');
      }

      return response.json();
    } catch (error) {
      console.error('Error in processToolResult:', error);
      throw error;
    }
  }
}
