/**
 * Transport-neutral agent definitions.
 *
 * An agent here is a prompt, a set of deterministic tools, and a schema for what comes
 * back. Nothing about how it reaches a model. That matters because two harnesses are
 * in play for good reasons: the evaluation runs under the Claude Agent SDK, which
 * authenticates with the developer's existing Claude Code credentials and needs no API
 * key; the deployed web app cannot, because the Agent SDK drives the Claude Code CLI as
 * a subprocess and there is no subprocess in a serverless function.
 *
 * Keeping the agents themselves free of that distinction means the thing being measured
 * and the thing being shipped are the same agent, not two that drifted apart.
 */
import type { z } from "zod";
import type { UsageMeter } from "../trace/usage";
import type { TrajectoryWriter } from "../trace/trajectory";

export const MODEL = "claude-opus-5";

/** A deterministic tool. Every one of these is arithmetic or file reading, never judgement. */
export interface NightstopTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface AgentRunOptions {
  /** Name used in trajectories and per-agent cost accounting. */
  agent: string;
  system: string;
  user: string;
  tools?: NightstopTool[];
  /** Absolute paths the agent may read. Anything else is out of reach. */
  readableFiles?: string[];
  traj: TrajectoryWriter;
  meter: UsageMeter;
  maxTurns?: number;
}

export interface AgentRun {
  agent: string;
  /** Concatenated text of the assistant's replies. */
  text: string;
  stopReason: string | null;
  turns: number;
  toolCalls: number;
  error?: string;
}

/**
 * Pull the last fenced JSON object out of an agent's reply.
 *
 * Assistant prefill is rejected on this model, so the shape of the answer is asked for
 * in the prompt and read back here rather than forced.
 */
export function extractJson<T>(text: string): T {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const candidate = fenced.length
    ? fenced[fenced.length - 1][1]
    : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) throw new Error("no JSON found in the agent's reply");
  return JSON.parse(candidate) as T;
}
