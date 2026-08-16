import { describe, expect, it } from "vitest";
import { ModelRegistry, type GuardProvider } from "@flintloom/models";
import { ToolRegistry } from "../src/index.ts";

describe("ToolRegistry", () => {
  it("does not call the tool when guard denies", async () => {
    const tools = new ToolRegistry();
    let callCount = 0;

    tools.register({
      name: "touch",
      description: "touch file",
      parameters: {},
      async execute() {
        callCount += 1;
        return "touched";
      },
    });

    const models = new ModelRegistry();
    const guard: GuardProvider = {
      async gate() {
        return "deny";
      },
    };
    models.registerGuard("default-guard", guard);
    models.setDefault("guard", "default-guard");

    const result = await tools.execute(
      "touch",
      {},
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        channel: "test",
      },
      models,
    );

    expect(callCount).toBe(0);
    expect(result).toBe("guard denied: touch");
  });
});
