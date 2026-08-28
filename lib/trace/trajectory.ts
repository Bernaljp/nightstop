/**
 * Trajectory capture.
 *
 * The submission has to show, for every agent, what it was told, what it did, how its
 * tools answered, what feedback changed its next step, and where a human was asked.
 * That means the event vocabulary below is not decoration — `revise` and `checkpoint`
 * exist because those are the two moments that are invisible in a plain transcript and
 * are exactly what makes an agent loop worth having.
 *
 * One file per (arm, case). The whole pipeline for one roster reads as one story.
 */
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { SdkUsage } from "./usage";

export type EventKind =
  /** The system prompt and first user message an agent was given, verbatim. */
  | "instructions"
  /** One assistant turn, including any thinking summary and tool calls. */
  | "assistant_turn"
  /** What the tools answered. */
  | "tool_results"
  /** An agent was sent back with feedback. Carries the feedback that caused it. */
  | "revise"
  /** A human was asked to approve something consequential. */
  | "checkpoint"
  /** The run stopped and handed something back to a person. */
  | "escalation"
  /** An agent's final output. */
  | "final"
  /** A note about the run itself. */
  | "note";

export interface TrajectoryEvent {
  seq: number;
  ts: string;
  runId: string;
  arm: string;
  caseId: string;
  agent: string;
  kind: EventKind;
  [k: string]: unknown;
}

export class TrajectoryWriter {
  private seq = 0;
  constructor(
    private readonly path: string,
    private readonly runId: string,
    private readonly arm: string,
    private readonly caseId: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
  }

  private write(agent: string, kind: EventKind, fields: Record<string, unknown>): void {
    const ev: TrajectoryEvent = {
      seq: this.seq++,
      ts: new Date().toISOString(),
      runId: this.runId,
      arm: this.arm,
      caseId: this.caseId,
      agent,
      kind,
      ...fields,
    };
    appendFileSync(this.path, JSON.stringify(ev) + "\n");
  }

  instructions(agent: string, system: string, user: unknown, tools: string[]): void {
    this.write(agent, "instructions", { system, user, tools });
  }

  assistantTurn(
    agent: string,
    content: unknown,
    stopReason: string | null,
    usage: SdkUsage,
  ): void {
    this.write(agent, "assistant_turn", { stopReason, content, usage });
  }

  toolResults(agent: string, content: unknown): void {
    this.write(agent, "tool_results", { content });
  }

  /** An agent is being sent back. `feedback` is what it will act on. */
  revise(agent: string, attempt: number, why: string, feedback: unknown): void {
    this.write(agent, "revise", { attempt, why, feedback });
  }

  checkpoint(
    agent: string,
    action: string,
    subject: Buffer | string,
    decision: "approved" | "rejected",
    approver: string,
    note?: string,
  ): void {
    this.write(agent, "checkpoint", {
      action,
      subjectSha256: createHash("sha256").update(subject).digest("hex"),
      decision,
      approver,
      note,
    });
  }

  escalation(agent: string, reason: string, detail: unknown): void {
    this.write(agent, "escalation", { reason, detail });
  }

  final(agent: string, output: unknown): void {
    this.write(agent, "final", { output });
  }

  note(agent: string, message: string, fields: Record<string, unknown> = {}): void {
    this.write(agent, "note", { message, ...fields });
  }
}

/* ------------------------------------------------------------------------- */

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + `\n… [${s.length - n} more characters]`;
}

function renderContent(content: unknown): string {
  if (!Array.isArray(content)) return "```\n" + truncate(String(content), 1200) + "\n```";
  const parts: string[] = [];
  for (const b of content as Array<Record<string, unknown>>) {
    switch (b.type) {
      case "text":
        parts.push(truncate(String(b.text ?? ""), 1600));
        break;
      case "thinking":
        if (b.thinking) parts.push(`> *thinking:* ${truncate(String(b.thinking), 900)}`);
        break;
      case "tool_use":
        parts.push(
          `**calls \`${b.name}\`**\n\n\`\`\`json\n` +
            truncate(JSON.stringify(b.input, null, 2), 900) +
            "\n```",
        );
        break;
      case "tool_result":
        parts.push(
          `**tool answered**\n\n\`\`\`\n` +
            truncate(
              typeof b.content === "string" ? b.content : JSON.stringify(b.content, null, 2),
              900,
            ) +
            "\n```",
        );
        break;
      default:
        parts.push(`\`\`\`json\n${truncate(JSON.stringify(b, null, 2), 600)}\n\`\`\``);
    }
  }
  return parts.join("\n\n");
}

/**
 * Render a JSONL trajectory as something a person will actually read.
 *
 * JSONL is the evidence; this is the exhibit. A judge asked to follow an agent from its
 * instructions to its result is not going to parse newline-delimited JSON, and the
 * brief asks for trajectories that are easy to follow.
 */
export function renderTrajectoryMarkdown(jsonlPath: string): string {
  if (!existsSync(jsonlPath)) return `_no trajectory at ${jsonlPath}_\n`;
  const events = readFileSync(jsonlPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TrajectoryEvent);
  if (!events.length) return "_empty trajectory_\n";

  const head = events[0];
  const out: string[] = [
    `# Trajectory — ${head.caseId}, arm \`${head.arm}\``,
    "",
    `Run \`${head.runId}\`. ${events.length} events.`,
    "",
  ];

  let currentAgent = "";
  for (const e of events) {
    if (e.agent !== currentAgent) {
      currentAgent = e.agent;
      out.push(`\n## ${currentAgent}\n`);
    }
    switch (e.kind) {
      case "instructions":
        out.push(
          `### What it was told\n`,
          `<details><summary>system prompt</summary>\n\n\`\`\`\n${truncate(String(e.system), 3000)}\n\`\`\`\n\n</details>`,
          "",
          `**Tools available:** ${(e.tools as string[]).map((t) => `\`${t}\``).join(", ") || "none"}`,
          "",
          `**Task:**\n\n\`\`\`\n${truncate(typeof e.user === "string" ? e.user : JSON.stringify(e.user, null, 2), 1800)}\n\`\`\``,
          "",
        );
        break;
      case "assistant_turn":
        out.push(`### Turn ${e.seq} — stop reason \`${e.stopReason}\``, "", renderContent(e.content), "");
        break;
      case "tool_results":
        out.push(renderContent(e.content), "");
        break;
      case "revise":
        out.push(
          `> ### ↩︎ Sent back (attempt ${e.attempt})`,
          `> **Why:** ${e.why}`,
          ">",
          "> " + truncate(JSON.stringify(e.feedback, null, 2), 1200).split("\n").join("\n> "),
          "",
        );
        break;
      case "checkpoint":
        out.push(
          `> ### ▣ Human checkpoint — \`${e.action}\``,
          `> **${String(e.decision).toUpperCase()}** by ${e.approver}`,
          `> Subject sha256 \`${String(e.subjectSha256).slice(0, 16)}…\``,
          e.note ? `> ${e.note}` : ">",
          "",
        );
        break;
      case "escalation":
        out.push(`> ### ⚠︎ Escalated — ${e.reason}`, ">", "> " + truncate(JSON.stringify(e.detail, null, 2), 900).split("\n").join("\n> "), "");
        break;
      case "final":
        out.push(
          `### Result`,
          "",
          `\`\`\`json\n${truncate(JSON.stringify(e.output, null, 2), 2500)}\n\`\`\``,
          "",
        );
        break;
      case "note":
        out.push(`_${e.message}_`, "");
        break;
    }
  }
  return out.join("\n");
}
