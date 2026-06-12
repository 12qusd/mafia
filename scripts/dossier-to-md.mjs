// One-shot converter: research workflow JSON dossier -> markdown docs.
// Usage: node scripts/dossier-to-md.mjs <dossier.output.json> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , inFile, outDir] = process.argv;
const raw = JSON.parse(readFileSync(inFile, 'utf8'));
const { findings, critique } = raw.result;
mkdirSync(join(outDir, 'raw'), { recursive: true });

const w = (name, body) => writeFileSync(join(outDir, name), body.trim() + '\n');
const list = (items) => items.map((i) => `- ${i}`).join('\n');
const numbered = (items) => items.map((i, n) => `${n + 1}. ${i}`).join('\n');

// ---- 01 game design ----
{
  const g = findings.game;
  const roles = g.roleCatalog
    .map(
      (a) =>
        `### ${a.alignment} (~${a.approxCount} roles)\n\n` +
        a.notableRoles.map((r) => `- **${r.name}** — ${r.mechanic}`).join('\n')
    )
    .join('\n\n');
  w(
    '01-game-design.md',
    `# SC2Mafia — Game Design Dossier

How the original game works, as researched from the SC2Mafia wiki and community sources.
All descriptions are paraphrased mechanics; see BUILD_SPEC.md §2.1 for the rule that all
player-facing text in our implementation must be original.

## Core loop

${g.coreLoop}

## Host setup system

${g.setupSystem}

## Role catalog

${roles}

## Chat mechanics

${list(g.chatMechanics)}

## Win conditions

${list(g.winConditions)}

## Technically tricky mechanics

${list(g.trickyMechanics)}

## Recommended MVP role set

${list(g.mvpRoleSet)}

## Full scope notes

${g.fullScopeNotes}`
  );
}

// ---- 02 stack ----
{
  const s = findings.stack;
  const opts = s.options
    .map(
      (o) =>
        `### ${o.name} — fit ${o.fitScore}/10\n\n**Steam integration:** ${o.steamIntegration}\n\n**Pros:**\n${list(o.pros)}\n\n**Cons:**\n${list(o.cons)}`
    )
    .join('\n\n');
  w(
    '02-engine-stack.md',
    `# Engine / Stack Evaluation

## Recommendation

${s.recommendation}

## Reasoning

${s.reasoning}

## Options evaluated

${opts}`
  );
}

// ---- 03 networking ----
{
  const n = findings.net;
  const t = n.transportOptions.map((x) => `### ${x.name}\n\n${x.verdict}`).join('\n\n');
  const o = n.offTheShelf.map((x) => `### ${x.name}\n\n${x.verdict}`).join('\n\n');
  w(
    '03-networking.md',
    `# Networking & Backend Architecture Research

## Why the server must be authoritative

${n.whyServerAuthoritative}

## Recommended architecture

${n.architecture}

## Transport options

${t}

## Off-the-shelf frameworks

${o}

## Persistence

${n.persistence}

## Hosting costs

${n.hostingCosts}

## Reconnection

${n.reconnection}

## Moderation

${n.moderation}

## Bottom line

${n.recommendation}`
  );
}

// ---- 04 steam + legal ----
{
  const s = findings.steam;
  const feats = s.steamworksFeatures.map((f) => `### ${f.feature}\n\n${f.relevance}`).join('\n\n');
  w(
    '04-steam-shipping-legal.md',
    `# Steam Shipping & Legal Analysis

## Shipping on Steam — steps

${numbered(s.shippingSteps)}

## Relevant Steamworks features

${feats}

## macOS notes

${s.macNotes}

## Legal analysis

> Practical risk assessment, not legal advice.

${s.legalAnalysis}

## MUST change (be original)

${list(s.mustChange)}

## Safe to keep (mechanics)

${list(s.safeToKeep)}`
  );
}

// ---- 05 comparables ----
{
  const c = findings.comps;
  const games = c.games
    .map(
      (g) =>
        `### ${g.name}\n\n**Stack:** ${g.stack}\n\n**Outcome:** ${g.outcome}\n\n**Lessons:**\n${list(g.lessons)}`
    )
    .join('\n\n');
  w(
    '05-comparable-games.md',
    `# Comparable Games — Post-mortems & Lessons

${games}

## Monetization patterns

${c.monetization}

## Pitfalls (cross-cutting)

${list(c.pitfalls)}

## Success factors (cross-cutting)

${list(c.successFactors)}`
  );
}

// ---- 06 critique ----
{
  const k = critique;
  const risks = k.topRisks
    .map((r) => `### Risk\n\n${r.risk}\n\n**Mitigation:** ${r.mitigation}`)
    .join('\n\n');
  w(
    '06-critique.md',
    `# Adversarial Critique — Risks, Gaps, Pushback

An experienced-indie-multiplayer-dev review of the whole dossier. Read this before trusting
any individual recommendation above.

## Top risks

${risks}

## Missing considerations

${list(k.missingConsiderations)}

## Pushback on the dossier's own recommendations

${list(k.pushback)}`
  );
}

writeFileSync(join(outDir, 'raw', 'dossier.json'), JSON.stringify(raw.result, null, 2));
console.log('done');
