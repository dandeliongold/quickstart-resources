import { useState, useMemo, useEffect } from 'react';
import { LLMService } from '../services/llm';
import { ReadResourceResultSchema, ResultSchema, Tool, Resource } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Message, ContentBlock, TextBlock, ImageBlock, ResourceBlock, ToolUseBlock } from '../../../../server/src/types.js';

type MakeRequestFunction = <T extends z.ZodType>(
  request: any,
  schema: T,
  options?: { signal?: AbortSignal; timeout?: number; suppressToast?: boolean }
) => Promise<z.output<T>>;

const generateResourceDocumentation = (resources: Resource[] = []): string | null => {
  if (resources.length === 0) {
    return null;
  }

  let documentation = "Available Resources:\n\n";
  resources.forEach(resource => {
    documentation += `Resource: ${resource.name}\n`;
    documentation += `URI: ${resource.uri}\n\n`;
  });
  return documentation;
};

const getResourceReadingTool = (): Tool => {
  return {
    name: "read_resource",
    description: "Read the content of a resource by its URI",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "The URI of the resource to read"
        }
      },
      required: ["uri"]
    }
  };
};

const generateToolDocumentation = (tools: Tool[] = [], resources: Resource[] = []): string => {
  if (tools.length === 0 && resources.length === 0) {
    return "No tools are currently available.";
  }

  let documentation = "Available Tools:\n\n";
  
  // Add read_resource tool first if resources are available
  if (resources.length > 0) {
    const readResourceTool = getResourceReadingTool();
    documentation += `Tool: ${readResourceTool.name}\n`;
    documentation += `Description: ${readResourceTool.description}\n`;
    documentation += "Parameters:\n";
    documentation += `- uri (Required): string\n`;
    documentation += `  The URI of the resource to read\n\n`;
  }

  // Add other tools
  tools.forEach(tool => {
    documentation += `Tool: ${tool.name}\n`;
    documentation += `Description: ${tool.description || 'No description available'}\n`;
    
    if (tool.inputSchema?.properties) {
      documentation += "Parameters:\n";
      const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
      const properties = tool.inputSchema?.properties || {};
      Object.entries(properties).forEach(([paramName, paramDetails]) => {
        const isRequired = required.includes(paramName);
        const details = paramDetails as { type?: string; description?: string };
        documentation += `- ${paramName}${isRequired ? ' (Required)' : ' (Optional)'}: ${details.type || 'any'}\n`;
        if (details.description) {
          documentation += `  ${details.description}\n`;
        }
      });
    }
    documentation += "\n";
  });
  return documentation;
};

interface UseLLMProps {
  makeRequest: MakeRequestFunction;
  tools?: Tool[];
  resources?: Resource[];
  sessionId: string | null;
}

export function useLLM({ makeRequest, tools = [], resources = [], sessionId }: UseLLMProps) {
  const llmService = useMemo(() => new LLMService(sessionId), []);
  const [processing, setProcessing] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<number>(8062);
  const [temperature, setTemperature] = useState<number>(0.4);

  // Update LLM service when sessionId changes
  useEffect(() => {
    if (sessionId) {
      llmService.setSessionId(sessionId);
    }
  }, [sessionId, llmService]);

  useEffect(() => {
    const toolDocs = generateToolDocumentation(tools, resources);
    const resourceDocs = generateResourceDocumentation(resources);
    
    let prompt = `You have access to various tools from connected MCP servers. When a user asks for information that requires using these tools, you should use the appropriate tool rather than stating you don't have access to that information.

${toolDocs}

When using tools:
1. Choose the most appropriate tool based on the user's request
2. Provide all required parameters
3. Format the response in a user-friendly way
4. If a tool call fails, check the error message and try again if it's recoverable`;

    if (resourceDocs) {
      prompt += `\n\nYou have access to the following resources. To read a resource's content, use the read_resource tool with the resource's URI:\n\n${resourceDocs}`;
    }

    setSystemPrompt(prompt);
  }, [tools, resources]);

  const processQuery = async (query: string, maxTokens: number = 8062, temperature: number = 0.4) => {
    setProcessing(true);
    try {
      // Use the tools from props, adding read_resource if resources are available
      const allTools = resources.length > 0 ? [...tools, getResourceReadingTool()] : tools;
      const result = await llmService.processQuery(query, allTools, history, systemPrompt, maxTokens, temperature);

      // Add the initial query to history
      const newHistory = [...history, { role: 'user' as const, content: query }];

      // Process the initial response and any tool calls
      let currentAssistantContent: ContentBlock[] = [];
      
      // Add any text blocks from the initial response
      for (const block of result.rawResponse.content as ContentBlock[]) {
        if (block.type === 'text') {
          currentAssistantContent.push(block);
        }
      }

      // Handle tool calls
      for (const toolCall of result.toolCalls) {
        // Add the tool use block to the assistant's message
        const toolUseBlock = result.rawResponse.content.find(
          (block: ContentBlock) => block.type === 'tool_use' && block.id === toolCall.id
        ) as ToolUseBlock | undefined;
        if (toolUseBlock) {
          currentAssistantContent.push(toolUseBlock);
        }

        // Add the assistant's message with tool use
        const assistantMessage = {
          role: 'assistant' as const,
          content: currentAssistantContent
        };
        newHistory.push(assistantMessage);

        // Execute the tool and get result
        let toolResult;
        try {
          if (toolCall.name === 'read_resource') {
            toolResult = await makeRequest(
              {
                method: "resources/read",
                params: {
                  uri: toolCall.args.uri
                }
              },
              ReadResourceResultSchema
            );
            
            toolResult = {
              ...toolResult,
              content: [{
                type: 'text',
                text: JSON.stringify(toolResult, null, 2)
              }]
            };
          } else {
            toolResult = await makeRequest(
              {
                method: "tools/call",
                params: {
                  name: toolCall.name,
                  arguments: toolCall.args
                }
              },
              ResultSchema
            );
          }

          // Format tool result content
          const formattedContent = (() => {
            if (typeof toolResult.content === 'string') {
              return [{ type: 'text' as const, text: toolResult.content }];
            }
            if (Array.isArray(toolResult.content)) {
              return toolResult.content.map(item => {
                if (item.type === 'image') {
                  return {
                    type: 'image' as const,
                    mimeType: item.mimeType,
                    data: item.data
                  } as ImageBlock;
                }
                if (item.type === 'resource' && item.resource) {
                  return {
                    type: 'resource' as const,
                    resource: {
                      uri: item.resource.uri,
                      mimeType: item.resource.mimeType,
                      blob: item.resource.blob
                    }
                  } as ResourceBlock;
                }
                if ('text' in item) {
                  return { 
                    type: 'text' as const, 
                    text: item.text 
                  } as TextBlock;
                }
                return { 
                  type: 'text' as const, 
                  text: JSON.stringify(item, null, 2)
                } as TextBlock;
              });
            }
            return [{ 
              type: 'text' as const, 
              text: JSON.stringify(toolResult.content, null, 2)
            }];
          })();

          // Create and add tool result message to history
          const toolResultMessage = {
            role: 'user' as const,
            content: [{
              type: 'tool_result' as const,
              tool_use_id: toolCall.id,
              content: formattedContent
            }]
          };
          newHistory.push(toolResultMessage);

          // Get follow-up response with complete history
          const followUp = await llmService.processToolResult(
            toolCall,
            toolResult,
            newHistory,
            systemPrompt,
            maxTokens,
            temperature
          );

          // Update current assistant content for next iteration
          currentAssistantContent = followUp.rawResponse.content;

        } catch (error: unknown) {
          console.error('Error executing tool:', error);
          // In case of error, keep the assistant message but don't add failed tool result
          currentAssistantContent = [{
            type: 'text',
            text: `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`
          }];
        }
      }

      // Add final assistant message if there's remaining content
      if (currentAssistantContent.length > 0) {
        newHistory.push({
          role: 'assistant' as const,
          content: currentAssistantContent
        });
      }

      setHistory(newHistory);

      return result.text;
    } finally {
      setProcessing(false);
    }
  };

  return {
    processQuery,
    processing,
    history,
    clearHistory: () => setHistory([]),
    systemPrompt,
    setSystemPrompt,
    maxTokens,
    setMaxTokens,
    temperature,
    setTemperature
  };
}
