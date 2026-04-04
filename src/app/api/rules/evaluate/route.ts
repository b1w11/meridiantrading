import { type NextRequest, NextResponse } from "next/server";

import { evaluateRule } from "@/lib/rule-engine";
import type { Rule, RulePriceData } from "@/types/rules";

export const dynamic = "force-dynamic";

type Body = {
  rules?: unknown;
  prices?: unknown;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.rules)) {
    return NextResponse.json(
      { error: "Body must include rules: Rule[]" },
      { status: 400 },
    );
  }
  if (!body.prices || typeof body.prices !== "object" || Array.isArray(body.prices)) {
    return NextResponse.json(
      { error: "Body must include prices: Record<string, { price, closes }>" },
      { status: 400 },
    );
  }

  const rules = body.rules as Rule[];
  const prices = body.prices as RulePriceData;

  const triggered: Rule[] = [];
  let evaluated = 0;

  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    if (!rule.enabled) continue;
    evaluated += 1;
    try {
      if (evaluateRule(rule, prices)) {
        triggered.push(rule);
      }
    } catch {
      /* skip malformed rule entries */
    }
  }

  return NextResponse.json({ triggered, evaluated });
}
