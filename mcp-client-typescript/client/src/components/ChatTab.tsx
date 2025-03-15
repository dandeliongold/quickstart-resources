import { TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect } from "react";
import { useLLM } from "@/lib/hooks/useLLM";
import { z } from "zod";
import { ContentBlock } from '../../../server/src/types.js';
import { 
  Tool, 
  Prompt, 
  GetPromptResult, 
  PromptReference,
  TextContent,
  ImageContent,
  EmbeddedResource,
  Resource,
  Root
} from "@modelcontextprotocol/sdk/types.js";
import { ReactNode } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: TextContent | ImageContent;
}

interface ModelPreferences {
  intelligencePriority?: number;
  speedPriority?: number;
  costPriority?: number;
  hints?: Array<{ name: string }>;
}

interface SamplingRequest {
  params: {
    messages: Message[];
    modelPreferences?: ModelPreferences;
    systemPrompt?: string;
    maxTokens?: number;
  };
  method: string;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[] | string;
  timestamp?: number;
}

interface SamplingHistoryItem {
  type: 'sampling_request';
  id: number;
  request: SamplingRequest;
  status: 'pending' | 'approved' | 'rejected';
  timestamp?: number;
}

type HistoryItem = HistoryMessage | SamplingHistoryItem;

function renderContent(content: ContentBlock[] | string): ReactNode {
  if (Array.isArray(content)) {
    return content.map((block: ContentBlock, j: number) => {
      if (block.type === 'text') {
        return (
          <pre key={j} className="bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64">
            {block.text}
          </pre>
        );
      }
      if (block.type === 'tool_result') {
        const content = block.content;
        return (
          <div key={j} className="bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm">
            <div className="font-medium mb-2">Tool Result (ID: {block.tool_use_id})</div>
            {Array.isArray(content) ? (
              <div className="space-y-2">
                {(content as Array<TextContent | ImageContent | EmbeddedResource>).map((item, k) => {
                  if (item.type === "text") {
                    // Try to parse as JSON for better formatting
                    try {
                      const parsed = JSON.parse(item.text);
                      return (
                        <pre key={k} className="overflow-auto max-h-64">
                          {JSON.stringify(parsed, null, 2)}
                        </pre>
                      );
                    } catch {
                      return (
                        <pre key={k} className="overflow-auto max-h-64">
                          {item.text}
                        </pre>
                      );
                    }
                  }
                  if (item.type === "image") {
                    return (
                      <img
                        key={k}
                        src={`data:${item.mimeType};base64,${item.data}`}
                        alt="Tool result image"
                        className="max-w-full h-auto rounded"
                      />
                    );
                  }
                  if (item.type === "resource" && item.resource) {
                    if (item.resource.mimeType?.startsWith("audio/")) {
                      return (
                        <audio
                          key={k}
                          controls
                          src={`data:${item.resource.mimeType};base64,${item.resource.blob}`}
                          className="w-full"
                        >
                          <p>Your browser does not support audio playback</p>
                        </audio>
                      );
                    }
                    return (
                      <pre key={k} className="overflow-auto max-h-64 whitespace-pre-wrap break-words">
                        {JSON.stringify(item.resource, null, 2)}
                      </pre>
                    );
                  }
                  return null;
                })}
              </div>
            ) : (
              <pre className="overflow-auto max-h-64">
                {(() => {
                  // Try to parse string content as JSON
                  try {
                    const parsed = JSON.parse(content);
                    return JSON.stringify(parsed, null, 2);
                  } catch {
                    return content;
                  }
                })()}
              </pre>
            )}
          </div>
        );
      }
      if (block.type === 'tool_use') {
        return (
          <div key={j} className="bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm">
            <div className="font-medium mb-2">Tool Use: {block.name}</div>
            <pre className="overflow-auto max-h-64">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
        );
      }
      return null;
    });
  }
  return content;
}
import { Combobox } from "@/components/ui/combobox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Plus, Minus, Save } from "lucide-react";

import { PendingRequest } from "./SamplingTab";
import SamplingRequestMessage from "./SamplingRequestMessage";
import { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";

interface ChatTabProps {
  makeRequest: <T extends z.ZodType>(
    request: any,
    schema: T,
    options?: { signal?: AbortSignal; timeout?: number; suppressToast?: boolean }
  ) => Promise<z.output<T>>;
  tools: Tool[] | undefined;
  listTools: () => void;
  clearTools: () => void;
  prompts: Prompt[];
  listPrompts: () => void;
  getPrompt: (name: string, args: Record<string, string>) => Promise<GetPromptResult>;
  handleCompletion: (
    ref: PromptReference,
    argName: string,
    value: string,
  ) => Promise<string[]>;
  completionsSupported: boolean;
  resources: Resource[];
  listResources: () => void;
  sessionId: string | null;
  roots: Root[];
  setRoots: React.Dispatch<React.SetStateAction<Root[]>>;
  onRootsChange: () => void;
  pendingRequests: PendingRequest[];
  onApprove: (id: number, result: CreateMessageResult) => void;
  onReject: (id: number) => void;
}

const ChatTab = ({ 
  makeRequest, 
  tools, 
  listTools, 
  prompts, 
  listPrompts, 
  getPrompt, 
  handleCompletion, 
  completionsSupported, 
  resources, 
  listResources, 
  sessionId,
  roots,
  setRoots,
  onRootsChange,
  pendingRequests,
  onApprove,
  onReject
}: ChatTabProps) => {
  const [query, setQuery] = useState('');
  const [includeResources, setIncludeResources] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [promptContent, setPromptContent] = useState<GetPromptResult | null>(null);
  const [completionOptions, setCompletionOptions] = useState<Record<string, string[]>>({});

  const handlePreviewPrompt = async () => {
    if (selectedPrompt) {
      try {
        const content = await getPrompt(selectedPrompt.name, promptArgs);
        setPromptContent(content);
      } catch (error) {
        console.error('Error fetching prompt preview:', error);
      }
    }
  };

  // Clear completion options and prompt content when prompt changes
  useEffect(() => {
    setCompletionOptions({});
    setPromptContent(null);
  }, [selectedPrompt]);

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
  } = useLLM({
    makeRequest,
    tools,
    resources: includeResources ? resources : [],
    sessionId
  });

  const handleSubmit = async () => {
    if (!query.trim() && !promptContent) return;

    try {
      let finalMessage = "";
      
      if (promptContent) {
        // Combine all text content from prompt messages
        const promptText = promptContent.messages
          .map(msg => {
            if (msg.content.type === 'text') {
              return msg.content.text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n\n');
        
        finalMessage = query.trim() 
          ? `${promptText}\n\n${query}`
          : promptText;
      } else {
        finalMessage = query;
      }

      await processQuery(finalMessage, maxTokens, temperature);
      setQuery('');
      setSelectedPrompt(null);
      setPromptArgs({});
      setPromptContent(null);
    } catch (error) {
      console.error('Error processing query:', error);
    }
  };

  return (
    <TabsContent 
      value="chat" 
      className="h-full flex flex-col"
    >
      <div className="space-y-2">
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b border-border bg-card">
            <label className="text-sm font-medium">Prompt Selection</label>
            <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-4 border-b border-border bg-card space-y-4">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-sm font-medium">Select Prompt</label>
                    <Combobox
                      value={selectedPrompt?.name || ""}
                      onChange={(value) => {
                        const prompt = prompts.find(p => p.name === value);
                        setSelectedPrompt(prompt || null);
                        setPromptArgs({});
                        setPromptContent(null);
                        
                        // If prompt has no arguments, get content immediately
                        if (prompt && (!prompt.arguments || prompt.arguments.length === 0)) {
                          getPrompt(prompt.name, {})
                            .then(setPromptContent)
                            .catch(console.error);
                        }
                      }}
                      onInputChange={() => {}}
                      options={prompts.map(p => p.name)}
                    />
                  </div>
                  <Button 
                    onClick={listPrompts}
                    className="shrink-0 self-end mb-[2px]"
                  >
                    Update Prompts
                  </Button>
                </div>

                {selectedPrompt?.arguments && (
                  <div className="space-y-4">
                    <div className="space-y-4">
                      {selectedPrompt.arguments.map((arg) => (
                        <div key={arg.name}>
                          <label className="text-sm font-medium" htmlFor={arg.name}>
                            {arg.name}
                            {arg.required && <span className="text-xs text-red-500 ml-1">*</span>}
                          </label>
                          <Combobox
                            id={arg.name}
                            placeholder={`Enter ${arg.name}`}
                            value={promptArgs[arg.name] || ""}
                            onChange={(value) => {
                              const newArgs = { ...promptArgs, [arg.name]: value };
                              setPromptArgs(newArgs);
                            }}
                            onInputChange={(value) => {
                              if (completionsSupported && selectedPrompt) {
                                handleCompletion(
                                  { type: "ref/prompt", name: selectedPrompt.name },
                                  arg.name,
                                  value
                                ).then((completions) => {
                                  setCompletionOptions(prev => ({
                                    ...prev,
                                    [arg.name]: completions
                                  }));
                                });
                              }
                            }}
                            options={completionOptions[arg.name] || []}
                          />
                          {arg.description && (
                            <p className="text-xs text-gray-500 mt-1">
                              {arg.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    <Button 
                      onClick={handlePreviewPrompt}
                      className="w-full"
                      variant="secondary"
                    >
                      Preview Prompt
                    </Button>
                  </div>
                )}

                {promptContent && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Preview</label>
                    <div className="bg-muted p-4 rounded space-y-4">
                      {promptContent.messages.map((msg, i) => (
                        <div key={i} className={`p-2 rounded ${
                          msg.role === 'user' ? 'bg-primary/10' : 'bg-secondary/10'
                        }`}>
                          <div className="text-xs text-gray-500 mb-1">
                            {msg.role === 'user' ? 'User' : 'Assistant'}
                          </div>
                          {msg.content.type === 'text' && (
                            <div className="whitespace-pre-wrap text-sm">
                              {msg.content.text}
                            </div>
                          )}
                          {msg.content.type === 'image' && (
                            <div className="mt-2">
                              <img 
                                src={`data:${msg.content.mimeType};base64,${msg.content.data}`}
                                alt="Prompt image"
                                className="max-w-full h-auto rounded"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {query && (
                        <div className="p-2 rounded bg-primary/10">
                          <div className="text-xs text-gray-500 mb-1">
                            Additional Message
                          </div>
                          <div className="whitespace-pre-wrap text-sm">
                            {query}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b border-border bg-card">
            <label className="text-sm font-medium">System Prompt</label>
            <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-4 border-b border-border bg-card space-y-2">
              <div className="flex gap-2">
                <Textarea
                  id="systemPrompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Enter system prompt..."
                  className="h-24 resize-none"
                />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="includeResources"
                      checked={includeResources}
                      onCheckedChange={(checked) => setIncludeResources(checked as boolean)}
                    />
                    <Label htmlFor="includeResources" className="text-sm">
                      Include Resources
                    </Label>
                  </div>
                  <Button 
                    onClick={async () => {
                      // Always list tools
                      await listTools();
                      
                      // List resources if checkbox is checked
                      if (includeResources) {
                        await listResources();
                      }
                    }}
                    className="shrink-0"
                  >
                    Update System Prompt
                  </Button>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b border-border bg-card">
            <label className="text-sm font-medium">Model Settings</label>
            <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-4 border-b border-border bg-card space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="maxTokens">Max Tokens</label>
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
                <label className="text-sm font-medium" htmlFor="temperature">Temperature</label>
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

        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b border-border bg-card">
            <label className="text-sm font-medium">Roots</label>
            <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-4 border-b border-border bg-card space-y-4">
              <Alert>
                <AlertDescription>
                  Configure the root directories that the server can access
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                {roots.map((root, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <Input
                      placeholder="file:// URI"
                      value={root.uri}
                      onChange={(e) => setRoots(currentRoots => 
                        currentRoots.map((r, i) => 
                          i === index ? { ...r, uri: e.target.value } : r
                        )
                      )}
                      className="flex-1"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRoots(currentRoots => currentRoots.filter((_, i) => i !== index))}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setRoots(currentRoots => [...currentRoots, { uri: "file://", name: "" }])}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Root
                  </Button>
                  <Button onClick={onRootsChange}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="flex-1 overflow-auto space-y-2 p-2 min-h-[40vh]">
        {([...history, ...pendingRequests.map(req => ({
          type: 'sampling_request',
          id: req.id,
          request: req.request,
          status: 'pending' as const
        }))] as HistoryItem[]).sort((a, b) => {
          const aTime = a.timestamp ?? 0;
          const bTime = b.timestamp ?? 0;
          return aTime - bTime;
        }).map((item: HistoryItem, i) => (
          'type' in item && item.type === 'sampling_request' ? (
            <SamplingRequestMessage
              key={`sampling-${item.id}`}
              id={item.id}
              request={item.request}
              status={item.status}
              onApprove={onApprove}
              onReject={onReject}
            />
          ) : (
          <div
            key={`msg-${i}`}
            className={`p-4 rounded-lg ${
              'role' in item && item.role === 'user'
                ? 'bg-primary/10 ml-8'
                : 'bg-muted mr-8'
            }`}
          >
            <div className="font-semibold mb-1">
              {'role' in item ? (item.role === 'user' ? 'You' : 'Assistant') : ''}
            </div>
            <div className="whitespace-pre-wrap space-y-2">
              {('role' in item) ? renderContent(item.content) : null}
            </div>
          </div>
          )
        ))}
      </div>

      <div className="p-2 border-t">
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
            disabled={processing || (!query.trim() && !promptContent)}
          >
            <div className="flex items-center gap-2">
              {processing ? (
                <>
                  <LoadingSpinner />
                  <span>Processing...</span>
                </>
              ) : (
                'Send'
              )}
            </div>
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
