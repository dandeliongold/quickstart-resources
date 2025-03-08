import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useLLM } from "@/lib/hooks/useLLM";
import { z } from "zod";
import { Message, ContentBlock, TextBlock } from '../../../server/src/types.js';

interface ChatTabProps {
  makeRequest: <T extends z.ZodType>(
    request: any,
    schema: T,
    options?: { signal?: AbortSignal; timeout?: number; suppressToast?: boolean }
  ) => Promise<z.output<T>>;
}

const ChatTab = ({ makeRequest }: ChatTabProps) => {
  const [query, setQuery] = useState('');
  const {
    processQuery,
    processing,
    history,
    clearHistory,
    systemPrompt,
    setSystemPrompt
  } = useLLM(makeRequest);

  const handleSubmit = async () => {
    if (!query.trim()) return;

    try {
      await processQuery(query);
      setQuery('');
    } catch (error) {
      console.error('Error processing query:', error);
    }
  };

  return (
    <TabsContent value="chat" className="h-96 flex flex-col">
      <div className="p-4 border-b">
        <div className="space-y-2">
          <label htmlFor="systemPrompt" className="text-sm font-medium">
            System Prompt
          </label>
          <Textarea
            id="systemPrompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Enter system prompt..."
            className="h-24 resize-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto space-y-4 p-4">
        {history.map((msg, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg ${
              msg.role === 'user'
                ? 'bg-primary/10 ml-8'
                : 'bg-muted mr-8'
            }`}
          >
            <div className="font-semibold mb-1">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div className="whitespace-pre-wrap">
              {Array.isArray(msg.content)
                ? msg.content.map((block: ContentBlock, j: number) => {
                    if (block.type === 'text') {
                      return <div key={j}>{block.text}</div>;
                    }
                    if (block.type === 'tool_result') {
                      return <div key={j}>Tool result: {
                        Array.isArray(block.content) 
                          ? block.content.map((c: TextBlock) => c.text).join(' ')
                          : block.content
                      }</div>;
                    }
                    return null;
                  })
                : msg.content}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter your message..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            onClick={handleSubmit}
            disabled={processing || !query.trim()}
          >
            {processing ? 'Processing...' : 'Send'}
          </Button>
          <Button
            variant="outline"
            onClick={clearHistory}
            disabled={processing || history.length === 0}
          >
            Clear
          </Button>
        </div>
      </div>
    </TabsContent>
  );
};

export default ChatTab;
