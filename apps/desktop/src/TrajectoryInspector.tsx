import { useEffect, useState } from "react";
import { MessageFileCards } from "./MessageFileCards.tsx";
import { formatToolArgs } from "./toolDisplay.ts";
import type { TrajectoryRecord, TrajectoryTiming } from "./trajectoryRecords.ts";
import { formatDuration, formatTokens } from "./turnStats.ts";

export type InspectorTab = "summary" | "thinking" | "output" | "payload" | "result" | "timing";

export type TrajectoryInspectorProps = {
  record: TrajectoryRecord;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
};

function timingHasValue(timing: TrajectoryTiming | undefined): boolean {
  if (!timing) return false;
  return (
    timing.llmMs !== undefined ||
    timing.ttftMs !== undefined ||
    timing.decodeMs !== undefined ||
    timing.inputTokens !== undefined ||
    timing.outputTokens !== undefined ||
    timing.cacheReadTokens !== undefined ||
    timing.durationMs !== undefined
  );
}

export function defaultInspectorTab(record: TrajectoryRecord): InspectorTab {
  if (record.kind === "assistant") {
    if (typeof record.thinking === "string" && record.thinking.length > 0) return "thinking";
    if (typeof record.output === "string" && record.output.length > 0) return "output";
    return "summary";
  }
  if (record.kind === "tool") {
    if (typeof record.result === "string" && record.result.length > 0) return "result";
    return "payload";
  }
  return "summary";
}

function availableTabs(record: TrajectoryRecord): InspectorTab[] {
  const tabs: InspectorTab[] = ["summary"];
  if (record.kind === "assistant") {
    if (typeof record.thinking === "string" && record.thinking.length > 0) {
      tabs.push("thinking");
    }
    if (typeof record.output === "string" && record.output.length > 0) {
      tabs.push("output");
    }
    if (timingHasValue(record.timing)) tabs.push("timing");
  } else if (record.kind === "tool") {
    if (record.args !== undefined) tabs.push("payload");
    if (typeof record.result === "string" && record.result.length > 0) {
      tabs.push("result");
    }
    if (timingHasValue(record.timing)) tabs.push("timing");
  }
  return tabs;
}

const KIND_LABEL: Record<TrajectoryRecord["kind"], string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  error: "错误",
  guard: "护栏",
  a2ui: "界面",
};

const TAB_LABELS: Record<InspectorTab, string> = {
  summary: "摘要",
  thinking: "思考",
  output: "输出",
  payload: "入参",
  result: "结果",
  timing: "耗时",
};

const STATE_LABEL: Record<string, string> = {
  running: "进行中",
  done: "完成",
  error: "失败",
};

function SummaryPanel({ record }: { record: TrajectoryRecord }) {
  return (
    <div className="trajectory-summary">
      <p className="trajectory-summary-body">
        {record.kind === "user" ? (record.output ?? record.preview) : record.preview}
      </p>
      {record.toolName ? (
        <p className="trajectory-summary-kv">
          <span>工具</span>
          <span>{record.toolName}</span>
        </p>
      ) : null}
      {record.toolState ? (
        <p className="trajectory-summary-kv">
          <span>状态</span>
          <span>{STATE_LABEL[record.toolState] ?? record.toolState}</span>
        </p>
      ) : null}
      {record.errorKind ? (
        <p className="trajectory-summary-kv">
          <span>类型</span>
          <span>{record.errorKind}</span>
        </p>
      ) : null}
      {record.errorMessage ? <pre>{record.errorMessage}</pre> : null}
      {record.guardTool ? (
        <p className="trajectory-summary-kv">
          <span>护栏</span>
          <span>{record.guardTool}</span>
        </p>
      ) : null}
      {record.guardLabel ? (
        <p className="trajectory-summary-kv">
          <span>判定</span>
          <span>{record.guardLabel}</span>
        </p>
      ) : null}
      {record.surfaceId ? (
        <p className="trajectory-summary-kv">
          <span>界面</span>
          <span>{record.surfaceId}</span>
        </p>
      ) : null}
    </div>
  );
}

function TimingPanel({ timing }: { timing: TrajectoryTiming }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (timing.llmMs !== undefined) rows.push({ label: "LLM", value: formatDuration(timing.llmMs) });
  if (timing.ttftMs !== undefined) rows.push({ label: "TTFT", value: formatDuration(timing.ttftMs) });
  if (timing.decodeMs !== undefined) {
    rows.push({ label: "Decode", value: formatDuration(timing.decodeMs) });
  }
  if (timing.durationMs !== undefined) {
    rows.push({ label: "Duration", value: formatDuration(timing.durationMs) });
  }
  if (timing.inputTokens !== undefined) {
    rows.push({ label: "Input tokens", value: formatTokens(timing.inputTokens) });
  }
  if (timing.outputTokens !== undefined) {
    rows.push({ label: "Output tokens", value: formatTokens(timing.outputTokens) });
  }
  if (timing.cacheReadTokens !== undefined) {
    rows.push({ label: "Cache read", value: formatTokens(timing.cacheReadTokens) });
  }
  return (
    <dl className="trajectory-timing">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TrajectoryInspector({ record, onClose, onOpenFile }: TrajectoryInspectorProps) {
  const tabs = availableTabs(record);
  const [tab, setTab] = useState<InspectorTab>(() => {
    const preferred = defaultInspectorTab(record);
    return tabs.includes(preferred) ? preferred : (tabs[0] ?? "summary");
  });

  useEffect(() => {
    const preferred = defaultInspectorTab(record);
    const nextTabs = availableTabs(record);
    setTab(nextTabs.includes(preferred) ? preferred : (nextTabs[0] ?? "summary"));
  }, [record.id]);

  const meta = [
    `Turn ${record.turn}`,
    record.step !== undefined ? `Step ${record.step}` : undefined,
    record.running ? "进行中" : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return (
    <aside className="trajectory-inspector" aria-label="事件详情">
      <div className="trajectory-inspector-header">
        <div className="trajectory-inspector-heading">
          <span className="trajectory-kind-tag" data-role-kind={record.kind}>
            {KIND_LABEL[record.kind]}
          </span>
          <span className="trajectory-inspector-meta">{meta}</span>
        </div>
        <button
          type="button"
          className="trajectory-inspector-close"
          aria-label="关闭详情"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="trajectory-inspector-tabs" role="tablist">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-inspector-tab={id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="trajectory-inspector-body" data-inspector-panel="" role="tabpanel">
        {tab === "summary" ? <SummaryPanel record={record} /> : null}
        {tab === "thinking" ? <pre>{record.thinking}</pre> : null}
        {tab === "output" ? <pre>{record.output}</pre> : null}
        {tab === "payload" ? <pre>{formatToolArgs(record.args)}</pre> : null}
        {tab === "result" && typeof record.result === "string" ? (
          <>
            <pre>{record.result}</pre>
            <MessageFileCards text={record.result} onOpenFile={onOpenFile ?? (() => {})} />
          </>
        ) : null}
        {tab === "timing" && record.timing ? <TimingPanel timing={record.timing} /> : null}
      </div>
    </aside>
  );
}
