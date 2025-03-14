import { useState, useMemo, useEffect } from 'react';
import { LLMService } from '../services/llm';
import { ListToolsResultSchema, ResultSchema, Tool, Resource } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Message } from '../../../../server/src/types.js';

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
      // Get available tools but don't include read_resource in the server tools list
      const { tools } = await makeRequest(
        { method: "tools/list" },
        ListToolsResultSchema
      );

      // Process with LLM, including read_resource in the tools list for Claude
      const allTools = resources.length > 0 ? [...tools, getResourceReadingTool()] : tools;
      const result = await llmService.processQuery(query, allTools, history, systemPrompt, maxTokens, temperature);

      // Add the initial query and response to history
      // Add query and assistant response to history
      const newHistory = [
        ...history,
        { role: 'user' as const, content: query },
        { role: 'assistant' as const, content: result.rawResponse.content }
      ];
      setHistory(newHistory);

      // Handle tool calls
      for (const toolCall of result.toolCalls) {
        let toolResult;
        if (toolCall.name === 'read_resource') {
          // Handle resource reading directly
          toolResult = await makeRequest(
            {
              method: "resources/read",
              params: {
                uri: toolCall.args.uri
              }
            },
            ResultSchema
          );
        } else {
          // Handle other tools normally
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

        // Feed result back to LLM with updated history
        const followUp = await llmService.processToolResult(
          toolCall,
          toolResult,
          newHistory,
          systemPrompt,
          maxTokens,
          temperature
        );

        // Update history with tool result and follow-up
        newHistory.push(
          {
            role: 'user' as const,
            content: [{
              type: 'tool_result' as const,
              tool_use_id: toolCall.id,
              content: typeof toolResult.content === 'string'
                ? toolResult.content
                : Array.isArray(toolResult.content)
                  ? toolResult.content  // Already an array of TextBlocks
                  : [{ 
                      type: 'text' as const, 
                      text: JSON.stringify(toolResult.content, null, 2)  // Format JSON nicely
                    }]
            }]
          },
          {
            role: 'assistant' as const,
            content: followUp.rawResponse.content
          }
        );
        setHistory([...newHistory]);
      }

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
