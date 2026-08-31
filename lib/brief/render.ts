/**
 * The crew briefing.
 *
 * This is the only part of Nightstop a pilot actually looks at, so it is written to be
 * read at a glance on a phone in a hotel corridor, and to print onto one or two sheets.
 *
 * The order is deliberate. What needs a decision comes FIRST — a collision they have to
 * settle is worth more than a chart — then the month at a glance, then the detail. A
 * briefing that opens with a visualisation and buries the decision has the priorities of
 * its author, not its reader.
 *
 * Colours are the validated three-slot categorical set from the data-viz reference
 * palette (sleep / duty / nap), checked in both light and dark with the bundled
 * validator. Aqua sits under 3:1 on the light surface, so every nap carries a visible
 * time label — the relief the validator requires.
 */
import type { BriefData, Span } from "./data";
import type { Conflict } from "../plan/schema";
import { formatDuration } from "../tools/time";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
:root {
  color-scheme: light;
  --surface: #fcfcfb;
  --raised: #ffffff;
  --line: #e3e2dd;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --ink-3: #86847d;
  --sleep: #2a78d6;
  --duty: #eb6834;
  --nap: #1baf7a;
  --wocl: #1a1a1914;
  --wocl-line: #1a1a1930;
  --hard: #e34948;
  --rec: #eda100;
  --pref: #4a3aa7;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --raised: #232322; --line: #34342f;
    --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #8d8c83;
    --sleep: #3987e5; --duty: #d95926; --nap: #199e70;
    --wocl: #ffffff1a; --wocl-line: #ffffff33;
    --hard: #e66767; --rec: #c98500; --pref: #9085e9;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --raised: #232322; --line: #34342f;
  --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #8d8c83;
  --sleep: #3987e5; --duty: #d95926; --nap: #199e70;
  --wocl: #ffffff1a; --wocl-line: #ffffff33;
  --hard: #e66767; --rec: #c98500; --pref: #9085e9;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--surface); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 940px; margin: 0 auto; padding: 32px 20px 64px; }
header { border-bottom: 2px solid var(--ink); padding-bottom: 14px; margin-bottom: 22px; }
h1 { font-size: 25px; letter-spacing: -0.02em; margin: 0 0 3px; }
.sub { color: var(--ink-2); font-size: 14px; }
h2 { font-size: 12px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-3);
     margin: 34px 0 12px; font-weight: 600; }
.stats { display: flex; flex-wrap: wrap; gap: 26px; margin: 18px 0 4px; }
.stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.stat span { font-size: 12px; color: var(--ink-2); }

.decide { border: 1px solid var(--line); border-radius: 10px; background: var(--raised); overflow: hidden; }
.c { display: grid; grid-template-columns: 78px 1fr; gap: 14px; padding: 13px 15px; border-top: 1px solid var(--line); }
.c:first-child { border-top: 0; }
.c .when { font-variant-numeric: tabular-nums; color: var(--ink-2); font-size: 13px; }
.c .times { font-size: 11px; color: var(--ink-3); }
.c .tag { display: inline-block; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
          padding: 1px 6px; border-radius: 4px; font-weight: 600; margin-top: 3px; }
.tag.hard { background: var(--hard); color: #fff; }
.tag.rec  { background: var(--rec); color: #241a00; }
.tag.pref { background: var(--pref); color: #fff; }
.c p { margin: 0 0 7px; }
.c ul { margin: 0; padding-left: 17px; color: var(--ink-2); font-size: 14px; }
.c li { margin: 2px 0; }
.none { color: var(--ink-2); font-style: italic; padding: 14px 15px; }

.ribbon { border: 1px solid var(--line); border-radius: 10px; background: var(--raised); padding: 10px 12px; }
.hours { display: grid; grid-template-columns: 92px 1fr; font-size: 10px; color: var(--ink-3); margin-bottom: 3px; }
.hours div:last-child { display: grid; grid-template-columns: repeat(8, 1fr); }
.hours span { border-left: 1px solid var(--line); padding-left: 3px; }
.day { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 0; height: 19px; }
.day .g { font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums;
          white-space: nowrap; padding-right: 10px; overflow: hidden; text-overflow: ellipsis; }
.track { position: relative; height: 14px; background: linear-gradient(90deg, var(--line) 1px, transparent 1px);
         background-size: 12.5% 100%; border-radius: 3px; }
.track i { position: absolute; top: 0; height: 14px; border-radius: 3px; display: block; }
.track i.wocl { background: var(--wocl); border-left: 1px solid var(--wocl-line);
                border-right: 1px solid var(--wocl-line); border-radius: 0; height: 14px; }
.track i.duty { background: var(--duty); top: 0; height: 6px; }
.track i.main { background: var(--sleep); top: 7px; height: 7px; }
.track i.pre-duty-nap, .track i.recovery-nap { background: var(--nap); top: 7px; height: 7px;
  outline: 2px solid var(--raised); }
.key { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 12px; font-size: 12px; color: var(--ink-2); }
.key b { display: inline-block; width: 22px; height: 8px; border-radius: 3px; vertical-align: middle;
         margin-right: 6px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
     color: var(--ink-3); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top;
     font-variant-numeric: tabular-nums; }
td.note { font-variant-numeric: normal; color: var(--ink-2); }
.cal { border: 1px solid var(--line); border-radius: 10px; padding: 15px 18px;
       background: var(--raised); }
.cal p { margin: 0 0 9px; }
.cal ol { margin: 0 0 9px; padding-left: 19px; color: var(--ink-2); font-size: 14.5px; }
.cal li { margin: 4px 0; }
.cal .sub { font-size: 13.5px; color: var(--ink-3); margin: 0; }
.confirm { border: 1px dashed var(--rec); border-radius: 10px; padding: 13px 15px; background: var(--raised); }
.confirm p { margin: 0 0 8px; }
footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line);
         color: var(--ink-3); font-size: 12px; }
@media print {
  :root { --surface: #fff; --raised: #fff; }
  .wrap { max-width: none; padding: 0; }
  h2 { margin-top: 20px; }
  .ribbon, .decide, .confirm { break-inside: avoid; }
}
`;

function spanHtml(s: Span): string {
  const left = (s.from * 100).toFixed(3);
  const width = Math.max(0.4, (s.to - s.from) * 100).toFixed(3);
  return `<i class="${s.kind}" style="left:${left}%;width:${width}%" title="${esc(s.title)}"></i>`;
}

interface Grouped {
  ruleId: string;
  hardness: string;
  dates: string[];
  statement: string;
  options: string[];
}

/**
 * Collapse repeats of the same rule into one item.
 *
 * The same collision recurring on four nights is one thing to decide, not four. Listed
 * separately it filled the top of the page with near-identical paragraphs and pushed
 * the month off the first screen — which is how a page with nothing wrong with it still
 * ends up unread.
 */
function groupConflicts(cs: Conflict[]): Grouped[] {
  const out = new Map<string, Grouped>();
  for (const c of cs) {
    const g = out.get(c.ruleId);
    if (g) {
      g.dates.push(c.date);
      // Keep the worst instance's wording, so the number quoted is the one that bites.
      if (c.statement.length > g.statement.length) g.statement = c.statement;
    } else {
      out.set(c.ruleId, {
        ruleId: c.ruleId, hardness: c.hardness, dates: [c.date],
        statement: c.statement, options: c.options,
      });
    }
  }
  return [...out.values()];
}

function datesLabel(dates: string[]): string {
  const short = dates.map((d) => d.slice(5).replace("-", "/"));
  if (short.length === 1) return short[0];
  if (short.length <= 3) return short.join(", ");
  return `${short.slice(0, 2).join(", ")} +${short.length - 2} more`;
}

function conflictHtml(g: Grouped): string {
  const tag = g.hardness === "hard-limit" ? "hard" : g.hardness === "recommendation" ? "rec" : "pref";
  const word = g.hardness === "hard-limit" ? "Limit" : g.hardness === "recommendation" ? "Advice" : "Yours";
  const times = g.dates.length > 1 ? `<div class="times">${g.dates.length} nights</div>` : "";
  return `<div class="c">
  <div><div class="when">${esc(datesLabel(g.dates))}</div>${times}<span class="tag ${tag}">${word}</span></div>
  <div><p>${esc(g.statement)}</p><ul>${g.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></div>
</div>`;
}

export function renderBrief(d: BriefData, prose?: string, icsName?: string): string {
  const all = groupConflicts([
    ...d.conflicts.hard, ...d.conflicts.recommended, ...d.conflicts.preference,
  ]);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span>${String(h).padStart(2, "0")}</span>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rest plan — ${esc(d.from)} to ${esc(d.to)}</title>
<style>${CSS}</style></head>
<body><div class="wrap">

<header>
  <h1>Your rest plan</h1>
  <div class="sub">${esc(d.operator)} · ${esc(d.from)} to ${esc(d.to)} · based ${esc(d.base)}</div>
</header>

${prose ? `<p style="font-size:16px;max-width:62ch">${esc(prose)}</p>` : ""}

<div class="stats">
  <div class="stat"><b>${d.stats.nights}</b><span>nights planned</span></div>
  <div class="stat"><b>${d.stats.dutyDays}</b><span>duty days</span></div>
  <div class="stat"><b>${d.stats.daysOff}</b><span>days off</span></div>
  <div class="stat"><b>${formatDuration(d.stats.shortestSleepMinutes)}</b><span>shortest night</span></div>
  <div class="stat"><b>${all.length}</b><span>things to decide</span></div>
</div>

<h2>What needs your decision</h2>
<div class="decide">
${all.length ? all.map(conflictHtml).join("\n") : '<div class="none">Nothing collides this month. The plan below fits inside every rule you gave me.</div>'}
</div>

${d.derivations.length || d.uncertainties.length ? `
<h2>Worth confirming</h2>
<div class="confirm">
<p>These were <strong>worked out, not read</strong> off your roster — nothing in the document
states them, so nothing in the document can check them either.</p>
<table><thead><tr><th>Date</th><th>What</th><th>How it was worked out</th><th>Confidence</th></tr></thead><tbody>
${d.derivations.map((x) => `<tr><td>${esc(x.date.slice(5))}</td><td>${esc(x.field)}</td><td class="note">${esc(x.method)}</td><td>${esc(x.confidence)}</td></tr>`).join("")}
${d.uncertainties.map((u) => `<tr><td>—</td><td>unclear</td><td class="note" colspan="2">${esc(u)}</td></tr>`).join("")}
</tbody></table>
</div>` : ""}

<h2>Put it in your calendar</h2>
<div class="cal">
  <p><strong>${icsName ? esc(icsName) : "The .ics file next to this page"}</strong> holds
  every block below, plus your duties for context. Import it and the plan is on your phone
  in whatever timezone your phone is in — which is the one you will be sleeping in.</p>
  <ol>
    <li><strong>Google Calendar</strong> — Settings → Import &amp; export → Import. Put it
    in its own calendar so you can switch the whole plan off in one tap.</li>
    <li><strong>iPhone / Mac</strong> — open the file; Calendar offers to add the events.</li>
    <li><strong>Outlook</strong> — File → Open &amp; Export → Import an iCalendar file.</li>
  </ol>
  <p class="sub">Duties are marked <em>free</em> rather than busy, so this never blocks out
  your own diary. Nothing is sent anywhere: importing is you deciding, on your device.</p>
</div>

<h2>The month</h2>
<div class="ribbon">
  <div class="hours"><div></div><div>${hours}</div></div>
  ${d.days.map((r) => `<div class="day"><div class="g">${r.dow} ${esc(r.date.slice(8))} ${esc(r.station)}</div><div class="track">${r.spans.map(spanHtml).join("")}</div></div>`).join("\n  ")}
  <div class="key">
    <span><b style="background:var(--sleep)"></b>main sleep</span>
    <span><b style="background:var(--nap)"></b>nap</span>
    <span><b style="background:var(--duty)"></b>on duty</span>
    <span><b style="background:var(--wocl);outline:1px solid var(--wocl-line)"></b>your circadian low</span>
  </div>
</div>
<p class="sub" style="margin-top:9px">Drawn on ${esc(d.gridStation)} time, so nothing overlaps that did not overlap. Blocks away from ${esc(d.gridStation)} carry the local time and the station. Hover any block for the reason it sits there.</p>

<h2>Day by day</h2>
<table><thead><tr><th>Date</th><th>At</th><th>Duty</th><th>Sleep</th></tr></thead><tbody>
${d.days.map((r) => `<tr><td>${esc(r.dow)} ${esc(r.date)}</td><td>${esc(r.station)}</td><td class="note">${esc(r.dutyText || "—")}</td><td class="note">${esc(r.sleepText || "—")}</td></tr>`).join("\n")}
</tbody></table>

<footer>
  <strong>Advisory only.</strong> This is not a flight time limitations tool and it makes no
  ruling on whether any duty is legal — your operator owns that. Where a rule collides with
  your roster it is stated above with what you could do about it; the decision is yours.
  Under 14 CFR 117.25(f) that judgement is yours by law.
</footer>

</div></body></html>`;
}
