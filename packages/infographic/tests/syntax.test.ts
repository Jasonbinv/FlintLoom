import { describe, expect, it } from "vitest";
import { INFOGRAPHIC_MAX_BYTES, parseAntvSyntax, repairAntvSyntax } from "../src/syntax.ts";

const SAMPLE = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc Start
`;

describe("parseAntvSyntax", () => {
  it("accepts a local template syntax block", () => {
    expect(parseAntvSyntax(SAMPLE)).toContain("list-row-simple-horizontal-arrow");
  });

  it("rejects remote urls, empty text, and oversized payloads", () => {
    expect(() => parseAntvSyntax("infographic x\nicon https://cdn.example/a.svg\n")).toThrow(
      /remote url/,
    );
    expect(() => parseAntvSyntax("   \n")).toThrow(/bad syntax/);
    expect(() => parseAntvSyntax("not a template\n")).toThrow(/bad syntax/);
    expect(() => parseAntvSyntax(`infographic x\n${"a".repeat(INFOGRAPHIC_MAX_BYTES)}`)).toThrow(
      /too large/,
    );
  });
});

describe("repairAntvSyntax", () => {
  it("leaves a valid list template unchanged", () => {
    expect(repairAntvSyntax(SAMPLE).trim()).toBe(SAMPLE.trim());
  });

  it("rewrites invented stepList syntax into a list template with data.lists", () => {
    const repaired = repairAntvSyntax(`infographic stepList
step 1: 接收指令
理解用户输入的自然语言意图
step 2: 任务规划
将意图转化为可执行计划
step 3: 执行与交付
完成输出
`);
    expect(repaired).toMatch(/^infographic list-column-simple-vertical-arrow\n/);
    expect(repaired).toContain("data\n  lists");
    expect(repaired).toContain("- label 接收指令");
    expect(repaired).toContain("desc 理解用户输入的自然语言意图");
    expect(repaired).toContain("- label 任务规划");
    expect(repaired).toContain("- label 执行与交付");
  });

  it("rewrites timeline + 2024 Q1 headings into list data", () => {
    const repaired = repairAntvSyntax(`infographic timeline
2024 Q1: 概念验证与原型设计
完成用户调研并输出交互原型
2024 Q2: 核心开发与 MVP 构建
打通主链路并完成内部试用
2024 Q3: 系统集成与 Beta 测试
联调外部系统并收集反馈
2024 Q4: 全面发布与规模化运营
稳定运行并启动增长
`);
    expect(repaired).toMatch(/^infographic list-row-simple-horizontal-arrow\n/);
    expect(repaired).toContain("data\n  lists");
    expect(repaired).toContain("- label 2024 Q1");
    expect(repaired).toContain("desc 概念验证与原型设计");
    expect(repaired).toContain("- label 2024 Q2");
    expect(repaired).toContain("- label 2024 Q4");
    expect(repaired).toContain("规模化运营");
  });

  it("rewrites compare + titled bullet columns into data.compares", () => {
    const repaired = repairAntvSyntax(`infographic compare
传统开发模式
- 依赖手动编写代码与单元测试
- 周期长，反馈循环慢
- 资源密集型，人工成本高

AI 驱动开发模式
- 自动化生成代码与自然语言驱动
- 实时迭代，反馈即时
- 智能化辅助，大幅提升研发效能
`);
    expect(repaired).toMatch(/^infographic compare-binary-horizontal-simple-vs\n/);
    expect(repaired).toContain("data\n  compares");
    expect(repaired).toContain("- label 传统开发模式");
    expect(repaired).toContain("依赖手动编写代码与单元测试");
    expect(repaired).toContain("- label AI 驱动开发模式");
    expect(repaired).toContain("智能化辅助");
  });

  it("rewrites titled stepList sections with bullets into data.lists", () => {
    const repaired = repairAntvSyntax(`infographic stepList
需求评审阶段
- 检查用户痛点是否明确
- 评估技术实现难度

逻辑分支：技术可行性
- 高可行性 -> 进入开发计划
- 中可行性 -> 优化方案并重新评审
- 低可行性 -> 需求暂缓或重新定义
`);
    expect(repaired).toMatch(/^infographic list-column-simple-vertical-arrow\n/);
    expect(repaired).toContain("data\n  lists");
    expect(repaired).toContain("- label 需求评审阶段");
    expect(repaired).toContain("检查用户痛点是否明确");
    expect(repaired).toContain("- label 逻辑分支：技术可行性");
    expect(repaired).toContain("进入开发计划");
  });

  it("rewrites mindmap headings into a hierarchy root with children", () => {
    const repaired = repairAntvSyntax(`infographic mindmap
AI 学习路径
Step 1: 数学与编程基础
线性代数、微积分、Python
Step 2: 机器学习核心
监督学习、无监督学习
Step 3: 深度学习进阶
神经网络、Transformer
`);
    expect(repaired).toMatch(/^infographic hierarchy-mindmap-branch-gradient-capsule-item\n/);
    expect(repaired).toContain("data\n  root");
    expect(repaired).toContain("label AI 学习路径");
    expect(repaired).toContain("- label 数学与编程基础");
    expect(repaired).toContain("- label 线性代数");
    expect(repaired).toContain("- label 机器学习核心");
    expect(repaired).toContain("- label 深度学习进阶");
    expect(repaired).not.toContain("data\n  lists");
  });

  it("rewrites YAML-style root/label:/children: mindmap into official data.root", () => {
    const repaired = repairAntvSyntax(`infographic mindmap
root
 label: AI 学习路径
 children:
 label: 1. 基础准备
 children:
 label: 数学
 label: 编程
 label: CS 基础
 label: 2. 机器学习
 children:
 label: 经典模型
 label: 学习范式
 label: 3. 深度学习
 children:
 label: 神经网络
 label: Transformer
`);
    expect(repaired).toMatch(/^infographic hierarchy-mindmap-branch-gradient-capsule-item\n/);
    expect(repaired).toContain("data\n  root");
    expect(repaired).toContain("label AI 学习路径");
    expect(repaired).not.toMatch(/^\s*label:/m);
    expect(repaired).toContain("- label 1. 基础准备");
    expect(repaired).toContain("- label 数学");
    expect(repaired).toContain("- label 编程");
    expect(repaired).toContain("- label 2. 机器学习");
    expect(repaired).toContain("- label 经典模型");
    expect(repaired).toContain("- label 3. 深度学习");
    expect(repaired).toContain("- label Transformer");
  });

  it("rewrites indented YAML mindmap with a data wrapper and colons", () => {
    const repaired = repairAntvSyntax(`infographic hierarchy-mindmap-branch-gradient-capsule-item
data
  root
    label: AI 学习路径
    children:
      - label: 基础准备
        children:
          - label: 数学
          - label: Python
`);
    expect(repaired).toContain("data\n  root");
    expect(repaired).toContain("label AI 学习路径");
    expect(repaired).toContain("- label 基础准备");
    expect(repaired).toContain("- label 数学");
    expect(repaired).toContain("- label Python");
    expect(repaired).not.toMatch(/label:/);
  });

  it("lifts SWOT root desc into children so letter-cards are not empty", () => {
    const repaired = repairAntvSyntax(`infographic compare-swot
data
  compares
    - label 优势 (Strengths)
      desc 基础研究领先、商业化应用广泛、政策支持力度大、人才储备丰富
    - label 劣势 (Weaknesses)
      desc 算力与高端芯片依赖、大模型幻觉问题
    - label 机遇 (Opportunities)
      desc 多模态融合、Agent系统发展
    - label 威胁 (Threats)
      desc 监管政策收紧、数据隐私风险
`);
    expect(repaired).toContain("- label 优势");
    expect(repaired).not.toContain("优势 (Strengths)");
    expect(repaired).toContain("children");
    expect(repaired).toContain("- label 基础研究领先");
    expect(repaired).toContain("- label 商业化应用广泛");
    expect(repaired).toContain("- label 算力与高端芯片依赖");
    expect(repaired).toContain("- label 多模态融合");
    expect(repaired).toContain("- label 监管政策收紧");
    expect(repaired).not.toMatch(/^\s*desc /m);
  });

  it("rewrites quadrant aliases into the official 2x2 quadrant template", () => {
    const repaired = repairAntvSyntax(`infographic quadrant
data
  compares
    - label 高价值高复杂度
      desc 核心突破
    - label 高价值低复杂度
      desc 规模应用
    - label 低价值高复杂度
      desc 潜力探索
    - label 低价值低复杂度
      desc 基础工具
`);
    expect(repaired).toMatch(/^infographic compare-quadrant-quarter-simple-card\n/);
    expect(repaired).toContain("data\n  compares");
    expect(repaired).toContain("- label 高价值高复杂度");
    expect(repaired).toContain("desc 核心突破");
    expect(repaired).not.toContain("compare-swot");
  });

  it("maps circular quadrant alias to the official quarter-circular template", () => {
    expect(repairAntvSyntax("infographic quadrant-circular\ndata\n  compares\n    - label A\n").split("\n")[0]).toBe(
      "infographic compare-quadrant-quarter-circular",
    );
  });

  it("leaves official SWOT, relation, and chart syntax unchanged", () => {
    const swot = `infographic compare-swot
data
  compares
    - label 优势
      children
        - label 品牌
    - label 劣势
      children
        - label 成本
`;
    const relation = `infographic relation-dagre-flow-tb-simple-circle-node
data
  nodes
    - label API
    - id db
      label DB
  relations
    API - 读写 -> db
`;
    const chart = `infographic chart-line-plain-text
data
  values
    - label W1
      value 86
    - label W2
      value 91
`;
    expect(repairAntvSyntax(swot).trim()).toBe(swot.trim());
    expect(repairAntvSyntax(relation).trim()).toBe(relation.trim());
    expect(repairAntvSyntax(chart).trim()).toBe(chart.trim());
  });

  it("leaves a well-formed official mindmap unchanged", () => {
    const official = `infographic hierarchy-mindmap-branch-gradient-capsule-item
data
  root
    label AI 学习路径
    children
      - label 基础准备
        children
          - label 数学
`;
    expect(repairAntvSyntax(official).trim()).toBe(official.trim());
  });

  it("rewrites JSON-ish data { desc/children } SWOT into official compares", () => {
    const repaired = repairAntvSyntax(`infographic compare-swot
data {
  desc: "SWOT 分析" children:
  [{ desc: "优势 (Strengths)" children: [ { desc: "核心竞争力" } { desc: "优质资源" } ] }
  { desc: "劣势 (Weaknesses)" children: [ { desc: "资源匮乏" } { desc: "管理效率低" } ] }
  { desc: "机遇 (Opportunities)" children: [ { desc: "市场增长" } { desc: "政策支持" } ] }
  { desc: "威胁 (Threats)" children: [ { desc: "竞争加剧" } ] }]
}
`);
    expect(repaired).toMatch(/^infographic compare-swot\n/);
    expect(repaired).toContain("compares");
    expect(repaired).not.toContain("data {");
    expect(repaired).toContain("- label 优势");
    expect(repaired).not.toContain("优势 (Strengths)");
    expect(repaired).toContain("- label 核心竞争力");
    expect(repaired).toContain("- label 优质资源");
    expect(repaired).toContain("- label 劣势");
    expect(repaired).toContain("- label 资源匮乏");
    expect(repaired).toContain("- label 机遇");
    expect(repaired).toContain("- label 威胁");
    expect(repaired).toContain("- label 竞争加剧");
  });

  it("completes truncated official template names and rewrites JSON-ish lists", () => {
    const repaired = repairAntvSyntax(`infographic list-column-simple-vertic
data {
  children: [
    { desc: "规划目标" }
    { desc: "拆解步骤" }
    { desc: "执行交付" }
  ]
}
`);
    expect(repaired).toMatch(/^infographic list-column-simple-vertical-arrow\n/);
    expect(repaired).toContain("data\n  lists");
    expect(repaired).toContain("- label 规划目标");
    expect(repaired).toContain("- label 拆解步骤");
    expect(repaired).toContain("- label 执行交付");
    expect(repaired).not.toContain("data {");
  });

  it("repairs truncated json body so the title stays clean and all steps remain", () => {
    const repaired = repairAntvSyntax(
      [
        "infographic list-column-simple-vertical-arrow",
        `{"title":"AI 学习成长路径图","items":[{"label":"数学基础","children":[{"label":"线性代数 & 微积分"}]},{"label":"编程与数据科学","children":[{"label":"Python"}]}],"template":"list-column-simple-vertical-arrow"}`,
      ].join("\n"),
    );
    expect(repaired).toContain("title AI 学习成长路径图");
    expect(repaired).not.toContain("template:");
    expect(repaired).not.toContain("}]");
    expect(repaired).toContain("- label 数学基础");
    expect(repaired).toContain("- label 编程与数据科学");
    expect(repaired).toContain("- label 线性代数 & 微积分");
  });
});
