/**
 * The one place a tool runner is created.
 *
 * Everything that is easy to get wrong about running an agent loop is wrong in exactly
 * one file if it is wrong at all:
 *
 *   - The runner keeps its own copy of the conversation and does not hand it back, so
 *     the history is mirrored here. Without that there are no trajectories and no way
 *     to see what the agent was looking at when it went wrong.
 *   - Usage is accumulated on every yielded turn. The final message carries only its
 *     own turn, so reading usage once at the end understates the bill by however many
 *     turns the loop took.
 *   - `max_iterations` is the only thing standing between a confused agent and an
 *     unbounded spend.
 *   - No server-side tools anywhere. The runner does not auto-resume a `pause_turn`,
 *     and a paused turn ends the loop silently rather than raising, so the failure is
 *     removed by construction rather than handled.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta";
import { UsageMeter } from "../trace/usage";
import type { TrajectoryWriter } from "../trace/trajectory";

export const MODEL = "claude-opus-5";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Nightstop needs one to run any arm that calls " +
          "the model. The corpus, the grader and `npm run verify:grader` all work " +
          "without it.",
      );
    }
    client = new Anthropic();
  }
  return client;
}

export interface AgentRunOptions {
  /** Name used in trajectories and per-agent cost accounting. */
  agent: string;
  system: string;
  /** First user turn. A string, or content blocks for documents and images. */
  user: string | Anthropic.Beta.BetaContentBlockParam[];
  tools?: BetaRunnableTool<never>[];
  traj: TrajectoryWriter;
  meter: UsageMeter;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  maxIterations?: number;
}

export interface AgentRun {
  agent: string;
  /** Concatenated text of the final assistant turn. */
  text: string;
  /** The mirrored conversation, which the runner will not give us. */
  messages: BetaMessageParam[];
  stopReason: string | null;
  turns: number;
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRun> {
  const {
    agent, system, user, tools = [], traj, meter,
    effort = "high", maxTokens = 16_000, maxIterations = 24,
  } = opts;

  const messages: BetaMessageParam[] = [{ role: "user", content: user as never }];
  traj.instructions(agent, system, user, tools.map((t) => t.name));

  const runner = anthropic().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: maxTokens,
    // Adaptive is the only on-mode on this model, and the summary is what makes a
    // trajectory show the reasoning that shaped the next step rather than just its
    // conclusion. Omitted, `display` defaults to hiding it.
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
    // The system prompt carries the skill documents, which are stable across every
    // case in an arm. Marking it cacheable is where the cost of those documents stops
    // being paid once per roster.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools,
    messages,
    max_iterations: maxIterations,
  });

  let stopReason: string | null = null;
  let turns = 0;
  let lastText = "";

  for await (const message of runner) {
    turns++;
    stopReason = message.stop_reason;
    meter.add(agent, message.usage);
    traj.assistantTurn(agent, message.content, message.stop_reason, message.usage);
    messages.push({ role: "assistant", content: message.content });

    lastText = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Cached by the runner, so asking for it here does not run the tools twice.
    const toolResponse = await runner.generateToolResponse();
    if (toolResponse) {
      traj.toolResults(agent, toolResponse.content);
      messages.push(toolResponse);
    }
  }

  if (stopReason === "pause_turn") {
    // Should be unreachable without server tools, but a silent stall is the exact
    // failure this loop cannot afford to hide.
    traj.note(agent, "stopped on pause_turn, which this pipeline should never produce");
  }
  if (turns >= maxIterations) {
    traj.note(agent, `hit the ${maxIterations}-iteration ceiling`, { turns });
  }

  traj.final(agent, { text: lastText, stopReason, turns });
  return { agent, text: lastText, messages, stopReason, turns };
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
  return JSON.parse(candidate) as T;
}
