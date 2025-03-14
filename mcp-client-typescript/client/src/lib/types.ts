export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: TextBlock[] | string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolResultBlock | ToolUseBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type Prompt = {
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
};
