import { Anthropic } from '@anthropic-ai/sdk';
import { Tool, Result as ToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Message, ContentBlock, TextBlock, ProcessQueryResult } from '../types.js';


export class LLMService {
  private anthropic: Anthropic;
  private model = "claude-3-7-sonnet-20250219";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.anthropic = new Anthropic({ apiKey });
  }

  async processQuery(
    query: string, 
    tools: Tool[],
    history: Message[] = [],
    systemPrompt?: string
  ): Promise<ProcessQueryResult> {
    try {
      // Format tools according to Anthropic's API spec
      const formattedTools = tools.map(tool => ({
        name: tool.name,
        description: tool.description || "",
        input_schema: {
          type: "object" as const,
          properties: tool.inputSchema?.properties || {},
          required: tool.inputSchema?.required || []
        }
      }));

      // Initial call to Claude
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1000,
        messages: [...history, { role: "user", content: query }],
        system: systemPrompt || "You are a helpful AI assistant that can use tools to accomplish tasks.",
        tools: formattedTools
      });

      return this.processResponse(response, tools);
    } catch (error) {
      console.error('Error in LLM processQuery:', error);
      throw new Error('Failed to process query with LLM service');
    }
  }

  async processToolResult(
    toolCall: { name: string; args: Record<string, unknown>; id: string },
    toolResult: ToolResult,
    history: Message[],
    systemPrompt?: string
  ): Promise<ProcessQueryResult> {
    try {
      // Create a tool result message according to the API spec
      const toolResultMessage = {
        role: "user" as const,
        content: [{
          type: 'tool_result' as const,
          tool_use_id: toolCall.id,
          content: [{ 
            type: 'text' as const, 
            text: typeof toolResult.content === 'string' 
              ? toolResult.content
              : JSON.stringify(toolResult.content)
          }]
        }]
      };

      // Get the last assistant message which should contain the tool use
      const lastAssistantMessage = history[history.length - 1];
      if (!lastAssistantMessage || lastAssistantMessage.role !== 'assistant') {
        throw new Error('No assistant message found with tool use');
      }

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1000,
        messages: [
          ...history.slice(0, -1),
          lastAssistantMessage,
          toolResultMessage
        ],
        system: systemPrompt || "You are a helpful AI assistant that can use tools to accomplish tasks."
      });

      return this.processResponse(response, []);
    } catch (error) {
      console.error('Error in LLM processToolResult:', error);
      throw new Error('Failed to process tool result with LLM service');
    }
  }

  private async processResponse(
    response: any,
    tools: Tool[]
  ): Promise<ProcessQueryResult> {
    const toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];
    const finalText: string[] = [];

    // Handle both string content and array of content blocks
    const content = Array.isArray(response.content) ? response.content : [{ type: 'text', text: response.content }];

    for (const block of content) {
      if (block.type === 'text') {
        finalText.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          args: block.input,
          id: block.id
        });
      }
    }

    return {
      text: finalText.join('\n'),
      toolCalls,
      rawResponse: response
    };
  }
}
