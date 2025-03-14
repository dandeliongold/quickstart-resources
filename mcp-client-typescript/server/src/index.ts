#!/usr/bin/env node

import 'dotenv/config';
import cors from "cors";
import { parseArgs } from "node:util";
import { parse as shellParseArgs } from "shell-quote";
import { LLMService } from "./services/llm.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { findActualExecutable } from "spawn-rx";
import mcpProxy from "./mcpProxy.js";

const SSE_HEADERS_PASSTHROUGH = ["authorization"];

const defaultEnvironment = {
  ...getDefaultEnvironment(),
  ...(process.env.MCP_ENV_VARS ? JSON.parse(process.env.MCP_ENV_VARS) : {}),
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    env: { type: "string", default: "" },
    args: { type: "string", default: "" },
  },
});

const app = express();
app.use(cors());

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

// Track active client instances and their associated services
interface ClientInstance {
  client: Client;
  llmService: LLMService;
}

const activeClients = new Map<string, ClientInstance>();

// Create a new client instance for each connection
function createClientInstance(): ClientInstance {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const client = new Client({ 
    name: "mcp-server", 
    version: "1.0.0",
    capabilities: {
      resources: {
        listChanged: true,
        subscribe: true
      },
      sampling: {}
    }
  });

  const llmService = new LLMService(process.env.ANTHROPIC_API_KEY, client);

  return { client, llmService };
}

app.post("/llm/process", express.json(), async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    const clientInstance = activeClients.get(sessionId);
    if (!clientInstance) {
      throw new Error('No active MCP connection for this session');
    }

    const { query, tools, history, systemPrompt, maxTokens, temperature } = req.body;
    const result = await clientInstance.llmService.processQuery(
      query, 
      tools, 
      history, 
      systemPrompt,
      maxTokens,
      temperature
    );
    res.json(result);
  } catch (error: unknown) {
    console.error("Error processing LLM query:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'An unknown error occurred' 
    });
  }
});

app.post("/llm/process-tool-result", express.json(), async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    const clientInstance = activeClients.get(sessionId);
    if (!clientInstance) {
      throw new Error('No active MCP connection for this session');
    }

    const { toolCall, toolResult, history, systemPrompt, maxTokens, temperature } = req.body;
    const result = await clientInstance.llmService.processToolResult(
      toolCall, 
      toolResult, 
      history, 
      systemPrompt,
      maxTokens,
      temperature
    );
    res.json(result);
  } catch (error: unknown) {
    console.error("Error processing tool result:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'An unknown error occurred' 
    });
  }
});


let webAppTransports: SSEServerTransport[] = [];

const createTransport = async (req: express.Request) => {
  const query = req.query;
  console.log("Query parameters:", query);

  const transportType = query.transportType as string;

  if (transportType === "stdio") {
    const command = query.command as string;
    const origArgs = shellParseArgs(query.args as string) as string[];
    const queryEnv = query.env ? JSON.parse(query.env as string) : {};
    const env = { ...process.env, ...defaultEnvironment, ...queryEnv };

    const { cmd, args } = findActualExecutable(command, origArgs);

    console.log(`Stdio transport: command=${cmd}, args=${args}`);

    console.log("Creating stdio transport");
    return new StdioClientTransport({
      command: cmd,
      args,
      env,
      stderr: "pipe",
    });
  } else if (transportType === "sse") {
    const url = query.url as string;
    const headers: HeadersInit = {};
    for (const key of SSE_HEADERS_PASSTHROUGH) {
      if (req.headers[key] === undefined) {
        continue;
      }

      const value = req.headers[key];
      headers[key] = Array.isArray(value) ? value[value.length - 1] : value;
    }

    console.log(`SSE transport: url=${url}, headers=${Object.keys(headers)}`);

    const transport = new SSEClientTransport(new URL(url), {
      eventSourceInit: {
        fetch: (url, init) => fetch(url, { ...init, headers }),
      },
      requestInit: {
        headers,
      },
    });
    await transport.start();

    console.log("Connected to SSE transport");
    return transport;
  } else {
    console.error(`Invalid transport type: ${transportType}`);
    throw new Error("Invalid transport type specified");
  }
};

app.get("/sse", async (req, res) => {
  try {
    console.log("New SSE connection");

    let backingServerTransport;
    try {
      backingServerTransport = await createTransport(req);
    } catch (error) {
      if (error instanceof SseError && error.code === 401) {
        console.error(
          "Received 401 Unauthorized from MCP server:",
          error.message,
        );
        res.status(401).json(error);
        return;
      }

      throw error;
    }

    console.log("Connected MCP client to backing server transport");

    // Create new client instance for this connection
    const sessionId = Date.now().toString();
    const clientInstance = createClientInstance();
    
    try {
      // Connect the client to the transport
      await clientInstance.client.connect(backingServerTransport);
      
      // Initialize LLM service after connection is established
      await clientInstance.llmService.initialize();
      
      // Store the active client
      activeClients.set(sessionId, clientInstance);

      const webAppTransport = new SSEServerTransport("/message", res);
      console.log("Created web app transport");

      webAppTransports.push(webAppTransport);
      await webAppTransport.start();

      if (backingServerTransport instanceof StdioClientTransport) {
        backingServerTransport.stderr!.on("data", (chunk) => {
          webAppTransport.send({
            jsonrpc: "2.0",
            method: "notifications/stderr",
            params: {
              content: chunk.toString(),
            },
          });
        });
      }

      mcpProxy({
        transportToClient: webAppTransport,
        transportToServer: backingServerTransport,
      });

      console.log("Set up MCP proxy");

      // Handle cleanup when the connection is closed
      res.on('close', async () => {
        console.log('SSE connection closed');
        const instance = activeClients.get(sessionId);
        if (instance) {
          await instance.client.close();
          activeClients.delete(sessionId);
        }
        const index = webAppTransports.indexOf(webAppTransport);
        if (index > -1) {
          webAppTransports.splice(index, 1);
        }
      });

      // Send session ID in initial response
      webAppTransport.send({
        jsonrpc: "2.0",
        method: "session/created",
        params: {
          sessionId
        }
      });
    } catch (error) {
      console.error("Error setting up connection:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error in /sse route:", error);
    res.status(500).json(error);
  }
});

app.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    console.log(`Received message for sessionId ${sessionId}`);

    const transport = webAppTransports.find((t) => t.sessionId === sessionId);
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Error in /message route:", error);
    res.status(500).json(error);
  }
});

app.get("/config", (req, res) => {
  try {
    res.json({
      defaultEnvironment,
      defaultCommand: values.env,
      defaultArgs: values.args,
    });
  } catch (error) {
    console.error("Error in /config route:", error);
    res.status(500).json(error);
  }
});

const PORT = process.env.PORT || 3000;

try {
  const server = app.listen(PORT);

  server.on("listening", () => {
    const addr = server.address();
    const port = typeof addr === "string" ? addr : addr?.port;
    console.log(`Proxy server listening on port ${port}`);
  });
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}
