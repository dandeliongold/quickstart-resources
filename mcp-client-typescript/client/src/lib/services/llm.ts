import { Tool, Result as ToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Message, ProcessQueryResult } from '../../../../server/src/types.js';

export class LLMService {
  private apiUrl: string;
  private sessionId: string | null;

  constructor(sessionId: string | null = null) {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) {
      throw new Error('VITE_API_URL environment variable is required');
    }
    this.apiUrl = apiUrl;
    this.sessionId = sessionId;
  }

  setSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  private getEndpointUrl(endpoint: string): string {
    const url = new URL(`${this.apiUrl}${endpoint}`);
    if (this.sessionId) {
      url.searchParams.append('sessionId', this.sessionId);
    }
    return url.toString();
  }

  async processQuery(
    query: string, 
    tools: Tool[],
    history: Message[] = [],
    systemPrompt?: string,
    maxTokens: number = 8062,
    temperature: number = 0.4
  ): Promise<ProcessQueryResult> {
    try {
      const response = await fetch(this.getEndpointUrl('/llm/process'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, tools, history, systemPrompt, maxTokens, temperature })
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
    systemPrompt?: string,
    maxTokens: number = 8062,
    temperature: number = 0.4
  ): Promise<ProcessQueryResult> {
    try {
      const response = await fetch(this.getEndpointUrl('/llm/process-tool-result'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ toolCall, toolResult, history, systemPrompt, maxTokens, temperature })
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
