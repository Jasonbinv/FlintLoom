let buffer = Buffer.alloc(0);

function writeMessage(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp", version: "0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo text back",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
          },
        ],
      },
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === "echo") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: String(args.text ?? "") }],
        },
      });
      return;
    }
  }

  if (id !== undefined) {
    writeMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  }
}

function tryParseLines() {
  while (true) {
    const index = buffer.indexOf(0x0a);
    if (index === -1) {
      return;
    }
    const line = buffer.subarray(0, index).toString("utf8").replace(/\r$/, "");
    buffer = buffer.subarray(index + 1);
    if (line.length === 0) {
      continue;
    }
    try {
      handleMessage(JSON.parse(line));
    } catch {
      // ignore bad json
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  tryParseLines();
});

process.stdin.on("end", () => {
  process.exit(0);
});
