<!-- rendered from results/distill-2026-08-29T15-18-25-548Z/./trajectory.jsonl -->

> **Why this trajectory.** The `distiller`, run once per rules document rather than per roster. A 200-page regulation becomes a compact rule pack, each rule carrying the clause it came from so nothing in the plan is traceable to a rule nobody can look up.

# Trajectory — docs/sources/far-117.txt, arm `distill`

Run `distill-2026-08-29T15-18-25-548Z`. 5 events.


## distiller

### What it was told

<details><summary>system prompt</summary>

```
You reduce a long document to the rules that bear on when a crew member should sleep.

Almost none of the document is about that. Uniform standards, expense claims, security
procedures, training syllabi — skip all of it without comment. You are looking for
statements about rest periods, duty length, report times, days off, standby, and
anything that constrains when someone can sleep.

For each rule you find:

1. **Quote where it came from.** A section number and enough of the wording that someone
   can go and check you. A rule without a source is not usable — a crew member shown a
   limit needs to be able to look it up.

2. **Classify how hard it is**, which is the judgement that matters most:
   - `hard-limit` — the document says it must not happen. Look for "shall not", "no
     crew member may", "the maximum is".
   - `recommendation` — the document advises it, or it is an operator standard exceeding
     a regulatory floor. "Should", "company policy is", "not planned beyond".
   - `preference` — only ever used for something a crew member said about themselves.
     A document cannot produce one of these.

   When a document sets a stricter standard than a regulation, that is the operator's
   own policy: a `recommendation`, not a `hard-limit`, unless the document says it is
   mandatory.

3. **Express it as a check the system can actually evaluate**, from this closed list:

- min_rest_between_duties   { minutes }  end of one duty to report of the next
- min_sleep_opportunity     { minutes }  sleep available after commuting both ways
- max_duty_minutes          { minutes }  report to off-duty, one duty
- min_sleep_per_24h         { minutes }  total sleep in any rolling 24 hours
- nap_ends_before_pickup    { minutes }  gap between waking and leaving
- max_nap_minutes           { minutes }  length of a pre-duty nap
- min_main_sleep_minutes    { minutes }  length of one main sleep
- no_sleep_during_duty      { }          sleep may not be scheduled inside a duty
- max_consecutive_early_starts { count, beforeLocalHour }

A rule you cannot express as one of these is a rule that would silently do nothing, so
leave it out and say so in `skipped` instead. Being honest about what you could not
encode is more useful than a pack that looks complete.

Two things to be careful about:

- **Do not invent a number.** If the document sets limits by a table keyed on report time
  and sector count, you cannot collapse that into one figure — say so in `skipped`.
  A limit attributed to a regulator that the regulator did not set is worse than a
  missing rule.
- **Do not restate the same rule twice** in different words.
```

</details>

**Tools available:** none

**Task:**

```
Reduce this document to the rules that bear on sleep.

--- BEGIN DOCUMENT (docs/sources/far-117.txt) ---
PART 117—FLIGHT AND DUTY LIMITATIONS AND REST REQUIREMENTS: FLIGHTCREW MEMBERS
Authority:
49 U.S.C. 106(g), 40113, 40119, 44101, 44701-44702, 44705, 44709-44711, 44713, 44716-44717, 44722, 46901, 44903-44904, 44912, 46105.
Source:
Docket FAA-2009-1093, 77 FR 398, Jan. 4, 2012, unless otherwise noted.
§ 117.1 Applicability.
(a) This part prescribes flight and duty limitations and rest requirements for all flightcrew members and certificate holders conducting passenger operations under part 121 of this chapter.
(b) This part applies to all operations directed by part 121 certificate holders under part 91, other than subpart K, of this chapter if any segment is conducted as a domestic passenger, flag passenger, or supplemental passenger operation.
(c) This part applies to all flightcrew members when participating in an operation under part 91, other than subpart K of this chapter, on behalf of the part 121 certificate holder if any flight segment is conducted as a domestic passenger, flag passenger, or supplemental passenger operation
(d) Notwithstanding paragraphs (a), (b) and (c) of this section, a certificate holder may conduct under part 117 its part 121 operations pursuant to 121.470, 121.480, or 121.500.
§ 117.3 Definitions.
In addition to the definitions in §§ 1.1 and 110.2 of this chapter, the following definitions apply to this part. In the event there is a conflict in definitions, the definitions in this part control for purposes of the flight and duty limitations and rest requirements of this part.
Acclimated
means a condition in which a flightcrew member has been in a theater for 72 hours or has been given at least 36 consecutive hours free from duty.
Airpor
… [26884 more characters]
```

### Turn 1 — stop reason `null`



### Turn 2 — stop reason `null`

```json
{
  "rules": [
    {
      "id": "min-rest-10h-before-duty",
      "statement": "You must have at least 10 consecutive hours of rest immediately before you report for any reserve or flight duty period, measured from the moment you were released from your previous duty.",
      "source": "§ 117.25(e) — \"unless the flightcrew member is given a rest period of at least 10 consecutive hours immediately before beginning the reserve or flight duty period measured from the time the flightcrew member is released from duty\"",
      "hardness": "hard-limit",
      "check": { "kind": "min_rest_between_duties", "minutes": 600 }
    },
    {
      "id": "min-8h-sleep-opportunity",
      "statement": "Within that 10-hour rest period you must actually have 8 uninterrupted hours available for sleep, and if you judge that you will not, you must tell the operator and cannot report until you get a compliant rest period.",
      "source": "§ 117.25(e) — \"The 10 hour rest period must provide the flightcrew member with a minimum of 8 uninterrupted hours of sleep opportunity\"; § 117.25(f)",
      "hardness": "hard-limit",
      "check": { "kind": "min_sleep_opportunity", "minutes": 480 }
    },
    {
      "id": "split-duty-combined-14h",
      "statement": "If your duty includes a scheduled split-duty rest in a suitable accommodation, the flight duty period and that rest opportunity together may not exceed 14 hours.",
      "source": "§ 117.15(f) — \"The combined time of the flight duty period and the rest opportunity provided in this section does not exceed 14 hours.\"",
      "hardn
… [4494 more characters]

_finished: success_

### Result

```json
{
  "text": "```json\n{\n  \"rules\": [\n    {\n      \"id\": \"min-rest-10h-before-duty\",\n      \"statement\": \"You must have at least 10 consecutive hours of rest immediately before you report for any reserve or flight duty period, measured from the moment you were released from your previous duty.\",\n      \"source\": \"§ 117.25(e) — \\\"unless the flightcrew member is given a rest period of at least 10 consecutive hours immediately before beginning the reserve or flight duty period measured from the time the flightcrew member is released from duty\\\"\",\n      \"hardness\": \"hard-limit\",\n      \"check\": { \"kind\": \"min_rest_between_duties\", \"minutes\": 600 }\n    },\n    {\n      \"id\": \"min-8h-sleep-opportunity\",\n      \"statement\": \"Within that 10-hour rest period you must actually have 8 uninterrupted hours available for sleep, and if you judge that you will not, you must tell the operator and cannot report until you get a compliant rest period.\",\n      \"source\": \"§ 117.25(e) — \\\"The 10 hour rest period must provide the flightcrew member with a minimum of 8 uninterrupted hours of sleep opportunity\\\"; § 117.25(f)\",\n      \"hardness\": \"hard-limit\",\n      \"check\": { \"kind\": \"min_sleep_opportunity\", \"minutes\": 480 }\n    },\n    {\n      \"id\": \"split-duty-combined-14h\",\n      \"statement\": \"If your duty includes a scheduled split-duty rest in a suitable accommodation, the flight duty period and that rest opportunity together may not exceed 14 hours.\",\n      \"source\": \"§ 117.15(f) — \\\"The combined time of the flight duty period and the rest opportunity provided in this section does not exceed 14 hours.\\\"\",\n      \"hardness\": \"hard-limit\",\n      \"check\": { \"kind\": \"max_duty_minutes\", \"minutes\": 840 }\n    },\n    {\n      \"id\": \"reserve-availability-period-14h\",\n      \"statement\": \"A short-call reserve availability period may not last more than 14 hours.\",\n      \"source\": \"§ 117.21(c)(1) — \\\"The reserve availability period may not exceed 14 hours.\\\"\",\n      \"hardness\": \"hard-limit\",\n      \"check\": { \"kind\": \"max_duty_minutes\", \"minutes\": 840 }\n    },\n    {\n      \"id\": \"short-call-fdp-plus-rap-16h\",\n      \"statement\": \"On short-call reserve in an unaugmented operation, your reserve availability period plus your flight duty period may never total more than 16 hours measured from the start of the reserve availability period.\",\n      \"source\"
… [3897 more characters]
```
