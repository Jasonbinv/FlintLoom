let buffer = Buffer.alloc(0);

function writeMessage(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  process.stdout.write(header + body);
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

function tryParseFrames() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }
    const headerText = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /^Content-Length:\s*(\d+)/i.exec(headerText);
    if (match === null) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) {
      return;
    }
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try {
      handleMessage(JSON.parse(body));
    } catch {
      // ignore bad json
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  tryParseFrames();
});

process.stdin.on("end", () => {
  process.exit(0);
});
