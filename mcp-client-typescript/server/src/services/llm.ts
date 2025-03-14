import { Anthropic } from '@anthropic-ai/sdk';
import { Tool, Result as ToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Message, ContentBlock, TextBlock, ProcessQueryResult, ToolUseBlock } from '../types.js';
import type { Message as AnthropicMessageType } from '@anthropic-ai/sdk/resources/messages/messages.mjs';

type SimplifiedMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function convertToAnthropicMessage(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content.map((block: ContentBlock) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'tool_result') return JSON.stringify(block.content);
    return '';
  }).join('\n');
}

function convertFromAnthropicContent(content: AnthropicMessageType['content']): ContentBlock[] {
  return content.map(block => {
    if (block.type === 'text') {
      return {
        type: 'text',
        text: block.text
      } as TextBlock;
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        name: block.name,
        input: block.input as Record<string, unknown>,
        id: block.id
      } as ToolUseBlock;
    }
    throw new Error(`Unsupported content block type: ${block.type}`);
  });
}

export class LLMService {
  private anthropic: Anthropic;
  private model = "claude-3-7-sonnet-20250219";
  private mcp: Client;
  private initialized = false;

  constructor(apiKey: string, mcpClient: Client) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.anthropic = new Anthropic({ apiKey });
    this.mcp = mcpClient;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async processQuery(
    query: string, 
    tools: Tool[],
    history: Message[] = [],
    systemPrompt?: string,
    maxTokens: number = 8062,
    temperature: number = 0.4
  ): Promise<ProcessQueryResult> {
    if (!this.initialized) {
      throw new Error('LLM service not initialized');
    }

    const fullSystemPrompt = systemPrompt || "You are a helpful AI assistant that can use tools to accomplish tasks.";
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
        max_tokens: maxTokens,
        temperature: temperature,
        messages: [
          ...history.map(msg => ({
            role: msg.role,
            content: convertToAnthropicMessage(msg.content)
          })) as SimplifiedMessage[],
          { role: "user", content: query }
        ],
        system: fullSystemPrompt,
        tools: formattedTools
      });

      // Process tool calls
      const toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }> = [];
      
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const input = block.input as Record<string, unknown>;
          toolCalls.push({
            name: block.name,
            args: input,
            id: block.id
          });
        }
      }

      const finalContent = convertFromAnthropicContent(response.content);

      return {
        text: finalContent
          .filter((block): block is TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
        toolCalls,
        rawResponse: { ...response, content: finalContent }
      };
    } catch (error) {
      console.error('Error in LLM processQuery:', error);
      throw new Error('Failed to process query with LLM service');
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
    if (!this.initialized) {
      throw new Error('LLM service not initialized');
    }

    const fullSystemPrompt = systemPrompt || "You are a helpful AI assistant that can use tools to accomplish tasks.";

    try {
      // Create a tool result message according to the API spec
      const toolResultMessage: Message = {
        role: "user",
        content: [{
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: typeof toolResult.content === 'string'
            ? [{ type: 'text', text: toolResult.content }]
            : Array.isArray(toolResult.content)
              ? toolResult.content.map(item => {
                  if (item.type === 'image') {
                    return {
                      type: 'text',
                      text: `[Image: ${item.mimeType}]`
                    };
                  }
                  if ('text' in item) {
                    return { type: 'text', text: item.text };
                  }
                  return { type: 'text', text: JSON.stringify(item) };
                })
              : [{ type: 'text', text: JSON.stringify(toolResult.content, null, 2) }]
        }] as ContentBlock[]
      };

      // Get the last assistant message which should contain the tool use
      const lastAssistantMessage = history[history.length - 1];
      if (!lastAssistantMessage || lastAssistantMessage.role !== 'assistant') {
        throw new Error('No assistant message found with tool use');
      }

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: temperature,
        messages: [
          ...history.slice(0, -1).map(msg => ({
            role: msg.role,
            content: convertToAnthropicMessage(msg.content)
          })) as SimplifiedMessage[],
          {
            role: lastAssistantMessage.role,
            content: convertToAnthropicMessage(lastAssistantMessage.content)
          },
          {
            role: toolResultMessage.role,
            content: convertToAnthropicMessage(toolResultMessage.content)
          }
        ] as SimplifiedMessage[],
        system: fullSystemPrompt
      });

      const finalContent = convertFromAnthropicContent(response.content);

      return {
        text: finalContent
          .filter((block): block is TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('\n'),
        toolCalls: [],
        rawResponse: { ...response, content: finalContent }
      };
    } catch (error) {
      console.error('Error in LLM processToolResult:', error);
      throw new Error('Failed to process tool result with LLM service');
    }
  }
}
