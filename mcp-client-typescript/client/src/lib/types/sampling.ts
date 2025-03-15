import type { SamplingMessage } from "@modelcontextprotocol/sdk/types.js";

export interface ModelPreferences {
  intelligencePriority?: number;
  speedPriority?: number;
  costPriority?: number;
  hints?: Array<{ name: string }>;
}

export interface SamplingRequest {
  params: {
    messages: SamplingMessage[];
    modelPreferences?: ModelPreferences;
    systemPrompt?: string;
    maxTokens?: number;
  };
  method: string;
}

export interface PendingRequest {
  id: number;
  request: SamplingRequest;
}
