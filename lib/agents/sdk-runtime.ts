/**
 * Running an agent under the Claude Agent SDK.
 *
 * This is the harness the evaluation uses, because it authenticates with the
 * developer's existing Claude Code credentials — no API key, and no separate API
 * billing. Usage and list-price-equivalent cost still come back in full, so the cost
 * table is real even though the run was charged to a subscription.
 *
 * Two settings here are load-bearing rather than cosmetic:
 *
 *   settingSources: []   Without it the agent inherits whatever CLAUDE.md and settings
 *                        happen to be on the developer's machine. That is an
 *                        unreproducible, invisible extra system prompt, and on this
 *                        machine it would be a personal knowledge vault's house rules.
 *
 *   tools                THE WHITELIST. `allowedTools` only means "do not prompt me
 *                        about these" - it does not restrict anything. Setting it and
 *                        assuming otherwise gave the first baseline run a Bash tool it
 *                        used to write Python verification scripts, which is not
 *                        remotely what "a pilot pastes their roster into a chatbot"
 *                        means. `tools` is the option that actually restricts.
 */
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { MODEL, type AgentRun, type AgentRunOptions } from "./types";

const MCP_NAME = "nightstop";

export async function runAgentSdk(opts: AgentRunOptions): Promise<AgentRun> {
  const { agent, system, user, tools = [], traj, meter, maxTurns = 16 } = opts;

  const mcpServers = tools.length
    ? {
        [MCP_NAME]: createSdkMcpServer({
          name: MCP_NAME,
          version: "1.0.0",
          tools: tools.map((t) =>
            tool(t.name, t.description, t.schema, async (args) => ({
              content: [{ type: "text" as const, text: await t.run(args as Record<string, unknown>) }],
            })),
          ),
        }),
      }
    : undefined;

  const toolNames = tools.map((t) => `mcp__${MCP_NAME}__${t.name}`);
  // Reading a roster or a regulation is done with the built-in reader.
  if (opts.readableFiles?.length) toolNames.push("Read");

  traj.instructions(agent, system, user, toolNames);

  const q = query({
    prompt: user,
    options: {
      model: MODEL,
      systemPrompt: system,
      settingSources: [],
      permissionMode: "bypassPermissions",
      // `tools` restricts; `allowedTools` only suppresses the prompt. Both, so the
      // agent has exactly these and runs unattended.
      tools: toolNames,
      allowedTools: toolNames,
      disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "WebSearch", "WebFetch", "Task"],
      maxTurns,
      ...(mcpServers ? { mcpServers } : {}),
    },
  });

  let text = "";
  let turns = 0;
  let toolCalls = 0;
  let stopReason: string | null = null;
  let error: string | undefined;

  try {
  for await (const m of q) {
    if (m.type === "assistant") {
      turns++;
      if (m.error) error = m.error;
      const content = m.message.content as unknown as Array<Record<string, unknown>>;
      for (const b of content) {
        if (b.type === "text") text += (text ? "\n" : "") + String(b.text);
        if (b.type === "tool_use") toolCalls++;
      }
      stopReason = (m.message.stop_reason as string | null) ?? stopReason;
      traj.assistantTurn(agent, content, stopReason, m.message.usage ?? {});
    } else if (m.type === "user") {
      // Tool results come back as a user turn.
      const content = (m.message as { content?: unknown }).content;
      if (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === "tool_result")) {
        traj.toolResults(agent, content);
      }
    } else if (m.type === "result") {
      // The result carries usage for the whole session, so it is the authoritative
      // total. Per-turn usage is recorded in the trajectory but deliberately NOT
      // summed here — doing both double-counts every turn.
      const r = m as unknown as {
        usage?: Record<string, number>;
        total_cost_usd?: number;
        subtype?: string;
        is_error?: boolean;
      };
      if (r.usage) meter.add(agent, r.usage);
      if (r.is_error) error = error ?? `run ended as ${r.subtype}`;
      traj.note(agent, `finished: ${r.subtype}`, {
        listPriceUsd: r.total_cost_usd,
        turns,
        toolCalls,
      });
    }
  }

  } catch (e) {
    // A run that ran out of turns still threw away whatever it had said. Keep the
    // partial answer: an incomplete plan that can be graded is more informative than
    // an exception, and "it ran out of room" is itself a result worth recording.
    error = (e as Error).message;
    traj.note(agent, `run ended early: ${error}`, { turns, toolCalls });
  }

  if (turns >= maxTurns) {
    traj.note(agent, `hit the ${maxTurns}-turn ceiling`, { turns });
  }
  traj.final(agent, { text, stopReason, turns, toolCalls, error });
  return { agent, text, stopReason, turns, toolCalls, error };
}
