import { and, desc, gte, sql, sum } from 'drizzle-orm';
import { db, schema } from './db';

/**
 * Approximate Anthropic pricing (USD per 1M tokens), matched by model family.
 * Kept deliberately simple; the Settings UI labels these figures "estimated".
 */
const PRICING: { match: RegExp; input: number; output: number }[] = [
  { match: /opus/i, input: 15, output: 75 },
  { match: /haiku/i, input: 1, output: 5 },
  { match: /sonnet/i, input: 3, output: 15 },
];

function priceFor(model: string): { input: number; output: number } {
  for (const p of PRICING) if (p.match.test(model)) return p;
  return { input: 3, output: 15 };
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Record one Anthropic API call. Never throws — tracking must not break features. */
export async function recordUsage(
  userId: string,
  feature: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  try {
    await db.insert(schema.apiUsage).values({
      userId,
      feature,
      model,
      inputTokens,
      outputTokens,
      costUsd: estimateCost(model, inputTokens, outputTokens),
    });
  } catch (e) {
    console.error('[usage] failed to record:', e);
  }
}

export type UsageSummary = {
  totalCost: number;
  totalCalls: number;
  last30dCost: number;
  byFeature: { feature: string; cost: number; calls: number }[];
};

/** Aggregate spend for the Settings UI. `forUser` scopes to one user; omit for all users. */
export async function getUsageSummary(forUser?: string): Promise<UsageSummary> {
  const where = forUser ? sql`${schema.apiUsage.userId} = ${forUser}` : sql`TRUE`;
  const [totals] = await db
    .select({
      cost: sum(schema.apiUsage.costUsd),
      calls: sql<number>`count(*)`,
    })
    .from(schema.apiUsage)
    .where(where);
  const [recent] = await db
    .select({ cost: sum(schema.apiUsage.costUsd) })
    .from(schema.apiUsage)
    .where(and(where, gte(schema.apiUsage.createdAt, new Date(Date.now() - 30 * 24 * 3600 * 1000))));
  const byFeature = await db
    .select({
      feature: schema.apiUsage.feature,
      cost: sum(schema.apiUsage.costUsd),
      calls: sql<number>`count(*)`,
    })
    .from(schema.apiUsage)
    .where(where)
    .groupBy(schema.apiUsage.feature)
    .orderBy(desc(sum(schema.apiUsage.costUsd)));
  return {
    totalCost: Number(totals?.cost ?? 0),
    totalCalls: Number(totals?.calls ?? 0),
    last30dCost: Number(recent?.cost ?? 0),
    byFeature: byFeature.map((r) => ({
      feature: r.feature,
      cost: Number(r.cost ?? 0),
      calls: Number(r.calls ?? 0),
    })),
  };
}
