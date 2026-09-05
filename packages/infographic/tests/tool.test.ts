import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createInfographicGetTool, createInfographicPatchTool, createInfographicRenderTool } from "../src/tool.ts";

const exec = (workspaceRoot: string) => ({
  workspaceRoot,
  signal: new AbortController().signal,
  channel: "cli",
});

describe("infographic tools", () => {
  it("gets, patches, creates, and rejects bad path / abort / escape", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ig-"));
    const get = createInfographicGetTool();
    const patch = createInfographicPatchTool();
    const e = exec(workspace);

    expect(await get.execute({ path: "notes.json" }, e)).toBe("failed: bad path");
    expect(await get.execute({ path: "flow.infographic.json" }, e)).toBe("failed: not found");

    const created = await patch.execute(
      {
        path: "flow.infographic.json",
        ops: [
          { op: "addNode", id: "parse", label: "Parse", x: 20, y: 40 },
          { op: "addNode", id: "kb", label: "KB", x: 200, y: 40 },
          { op: "addEdge", from: "parse", to: "kb" },
        ],
      },
      e,
    );
    expect(JSON.parse(created)).toEqual({
      status: "ok",
      path: "flow.infographic.json",
      nodes: 2,
      edges: 1,
    });
    const got = JSON.parse(await get.execute({ path: "flow.infographic.json" }, e));
    expect(got.nodes[1].label).toBe("KB");
    expect(await get.execute({ path: "flow.infographic.json" }, e)).not.toContain("<svg");

    const before = readFileSync(join(workspace, "flow.infographic.json"), "utf8");
    expect(await patch.execute({ path: "flow.infographic.json", ops: [] }, e)).toMatch(
      /^failed:/,
    );
    expect(readFileSync(join(workspace, "flow.infographic.json"), "utf8")).toBe(before);

    expect(
      await patch.execute(
        {
          path: "no-such-dir/x.infographic.json",
          ops: [{ op: "addNode", id: "a", label: "A", x: 0, y: 0 }],
        },
        e,
      ),
    ).toBe("failed: not found");

    const ac = new AbortController();
    ac.abort();
    expect(
      await get.execute({ path: "flow.infographic.json" }, { ...e, signal: ac.signal }),
    ).toBe("aborted");

    await expect(get.execute({ path: "../x.infographic.json" }, e)).rejects.toThrow(
      WorkspaceEscapeError,
    );
  });

  it("renders SWOT and steps from template plus items", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ig-render-"));
    const render = createInfographicRenderTool();
    const e = exec(workspace);

    const swot = JSON.parse(
      await render.execute(
        {
          template: "swot",
          items: [
            { label: "优势 (Strengths)", desc: "核心竞争力、优质资源" },
            { label: "劣势 (Weaknesses)", desc: "资源匮乏" },
            { label: "机遇 (Opportunities)", desc: "市场增长" },
            { label: "威胁 (Threats)", desc: "竞争加剧" },
          ],
        },
        e,
      ),
    ) as { status: string; syntax: string };
    expect(swot.status).toBe("ok");
    expect(swot.syntax).toContain("compare-swot");
    expect(swot.syntax).toContain("- label 优势");
    expect(swot.syntax).toContain("- label 核心竞争力");
    expect(swot.syntax).not.toContain("data {");

    const steps = JSON.parse(
      await render.execute(
        {
          template: "steps",
          items: [
            { label: "调研与收集", desc: "收集资料" },
            { label: "分析与分类", desc: "整理要点" },
            { label: "策略制定", desc: "形成方案" },
          ],
        },
        e,
      ),
    ) as { status: string; syntax: string };
    expect(steps.syntax).toContain("list-column-simple-vertical-arrow");
    expect(steps.syntax).toContain("调研与收集");

    const nested = JSON.parse(
      await render.execute(
        {
          messages: [
            {
              messages: [
                {
                  createSurface: {
                    data: {
                      sequences: [
                        { label: "第一步", desc: "开始" },
                        { label: "第二步", desc: "结束" },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
        e,
      ),
    ) as { status: string; syntax: string };
    expect(nested.syntax).toContain("sequence-steps-simple");
    expect(nested.syntax).toContain("第一步");

    const pathMap = JSON.parse(
      await render.execute(
        {
          items: [
            {
              label: "AI 学习成长路径图",
              children: [
                {
                  label: "1. 数学基础 (数学底座)",
                  children: [
                    { label: "线性代数 & 微积分 (张量/梯度)" },
                    { label: "概率论 & 统计学 (分布/贝叶斯)" },
                    { label: "最优化理论 (极值/收敛)" },
                  ],
                },
                {
                  label: "5. 工程落地 (实战应用)",
                  children: [
                    { label: "RAG (检索增强生成)" },
                    { label: "Agent (智能体/LangChain)" },
                    { label: "模型部署 (vLLM/Ollama/量化)" },
                  ],
                },
              ],
            },
            {
              label: "💡 学习建议'}],template:",
              children: [{ label: "理论 + 代码同步进行 (避免过度沉溺数学)" }],
            },
          ],
          "mindmap<|>,title": "AI 全栈工程师学习路径思维导图",
        },
        e,
      ),
    ) as { status: string; syntax: string };
    expect(pathMap.syntax).toContain("hierarchy-mindmap");
    expect(pathMap.syntax).toContain("AI 全栈工程师学习路径思维导图");
    expect(pathMap.syntax).toContain("线性代数 & 微积分 (张量/梯度)");
    expect(pathMap.syntax).toContain("RAG (检索增强生成)");
    expect(pathMap.syntax).toContain("💡 学习建议");
    expect(pathMap.syntax).not.toContain("template:");

    expect(await render.execute({}, e)).toMatch(/^failed:/);
    const ac = new AbortController();
    ac.abort();
    expect(await render.execute({ template: "swot", items: [{ label: "A" }] }, { ...e, signal: ac.signal })).toBe(
      "aborted",
    );
  });
});
