import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { useLLM } from "@/lib/hooks/useLLM";
import { z } from "zod";
import { Message, ContentBlock, TextBlock } from '../../../server/src/types.js';
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

interface ChatTabProps {
  makeRequest: <T extends z.ZodType>(
    request: any,
    schema: T,
    options?: { signal?: AbortSignal; timeout?: number; suppressToast?: boolean }
  ) => Promise<z.output<T>>;
  tools: Tool[] | undefined;
  listTools: () => void;
  clearTools: () => void;
}

const ChatTab = ({ makeRequest, tools, listTools }: ChatTabProps) => {
  const [query, setQuery] = useState('');
  const {
    processQuery,
    processing,
    history,
    clearHistory,
    systemPrompt,
    setSystemPrompt,
    maxTokens,
    setMaxTokens,
    temperature,
    setTemperature
  } = useLLM(makeRequest, tools);

  const handleSubmit = async () => {
    if (!query.trim()) return;

    try {
      await processQuery(query, maxTokens, temperature);
      setQuery('');
    } catch (error) {
      console.error('Error processing query:', error);
    }
  };

  return (
    <TabsContent 
      value="chat" 
      className="h-96 flex flex-col"
    >
      <div className="space-y-2">
        <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b">
          <div className="text-sm font-medium">System Prompt</div>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-4 border-b">
            <div className="flex gap-2">
              <Textarea
                id="systemPrompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter system prompt..."
                className="h-24 resize-none"
              />
              <Button 
                onClick={listTools}
                className="shrink-0"
              >
                Update System Prompt
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b">
          <div className="text-sm font-medium">Model Settings</div>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-4 border-b space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maxTokens">Max Tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                min={1}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
                className="w-full"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
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
