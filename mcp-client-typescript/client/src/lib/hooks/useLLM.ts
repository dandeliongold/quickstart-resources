import { useState, useMemo } from 'react';
import { LLMService } from '../services/llm';
import { ListToolsResultSchema, ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Message } from '../../../../server/src/types.js';

type MakeRequestFunction = <T extends z.ZodType>(
  request: any,
  schema: T,
  options?: { signal?: AbortSignal; timeout?: number; suppressToast?: boolean }
) => Promise<z.output<T>>;

export function useLLM(makeRequest: MakeRequestFunction) {
  const llmService = useMemo(() => new LLMService(), []);
  const [processing, setProcessing] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are a helpful AI assistant that can use tools to accomplish tasks."
  );

  const processQuery = async (query: string) => {
    setProcessing(true);
    try {
      // Get available tools
      const { tools } = await makeRequest(
        { method: "tools/list" },
        ListToolsResultSchema
      );

      // Process with LLM
      const result = await llmService.processQuery(query, tools, history, systemPrompt);

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
          systemPrompt
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
                : [{ 
                    type: 'text' as const, 
                    text: JSON.stringify(toolResult.content)
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
    setSystemPrompt
  };
}
