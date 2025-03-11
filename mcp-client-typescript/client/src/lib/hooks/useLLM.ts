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

const generateResourceDocumentation = (resources: Resource[] = []): string => {
  if (resources.length === 0) {
    return "No resources are currently available.";
  }

  let documentation = "Available Resources:\n\n";
  resources.forEach(resource => {
    documentation += `Resource: ${resource.name}\n`;
    documentation += `URI: ${resource.uri}\n\n`;
  });
  return documentation;
};

const generateToolDocumentation = (tools: Tool[] = []): string => {
  if (tools.length === 0) {
    return "No tools are currently available.";
  }

  let documentation = "Available Tools:\n\n";
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

export function useLLM(makeRequest: MakeRequestFunction, tools: Tool[] = [], resources: Resource[] = []) {
  const llmService = useMemo(() => new LLMService(), []);
  const [processing, setProcessing] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [maxTokens, setMaxTokens] = useState<number>(8062);
  const [temperature, setTemperature] = useState<number>(0.4);

  useEffect(() => {
    const toolDocs = generateToolDocumentation(tools);
    const resourceDocs = generateResourceDocumentation(resources);
    
    let prompt = `You have access to various tools from connected MCP servers. When a user asks for information that requires using these tools, you should use the appropriate tool rather than stating you don't have access to that information.

${toolDocs}

When using tools:
1. Choose the most appropriate tool based on the user's request
2. Provide all required parameters
3. Format the response in a user-friendly way
4. If a tool call fails, check the error message and try again if it's recoverable`;

    if (resources.length > 0) {
      prompt += `\n\nYou also have access to the following resources:\n\n${resourceDocs}`;
    }

    setSystemPrompt(prompt);
  }, [tools, resources]);

  const processQuery = async (query: string, maxTokens: number = 8062, temperature: number = 0.4) => {
    setProcessing(true);
    try {
      // Get available tools
      const { tools } = await makeRequest(
        { method: "tools/list" },
        ListToolsResultSchema
      );

      // Process with LLM
      const result = await llmService.processQuery(query, tools, history, systemPrompt, maxTokens, temperature);

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
        const toolResult = await makeRequest(
          {
            method: "tools/call",
            params: {
              name: toolCall.name,
              arguments: toolCall.args
            }
          },
          ResultSchema
        );

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
