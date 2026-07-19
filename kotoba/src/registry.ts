/**
 * resource-planner kotoba — kotoba-E2E registry.
 *
 * Plaintext path (resourceCategory): sdk.write / sdk.read — public reference
 * taxonomy. FK target for resource entries (exists()).
 * E2E paths (resourceEntry, allocationPlan): sdk.encryptedWrite /
 * sdk.encryptedRead — confidential per-org inventory + plan bodies sealed in
 * the kotoba envelope (ADR-2605181100), read-cap = owner DID. The substrate
 * never sees cost estimates or plan content in plaintext.
 *
 * STAYS etzhayyim (not modeled here): LLM allocation INFERENCE + Inngest workflow
 * ORCHESTRATION execution — consumed via consent-capability.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  CATEGORY_COLLECTION,
  ENTRY_INNER_TYPE,
  PLAN_INNER_TYPE,
  categoryDidFor,
  categoryRkey,
  entryRkey,
  planRkey,
  isDecimalString,
  isPct,
  isPriority,
  isUint,
  type AllocationPlanBody,
  type AllocationPlanView,
  type CoverageInput,
  type CoverageOutput,
  type CreatePlanInput,
  type CreatePlanOutput,
  type GetCategoryInput,
  type GetCategoryOutput,
  type GetPlanInput,
  type GetPlanOutput,
  type GetResourceInput,
  type GetResourceOutput,
  type IngestResourceInput,
  type IngestResourceOutput,
  type ListCategoriesInput,
  type ListCategoriesOutput,
  type ListPlansInput,
  type ListPlansOutput,
  type ListResourcesInput,
  type ListResourcesOutput,
  type RegisterCategoryInput,
  type RegisterCategoryOutput,
  type ResourceCategoryRecord,
  type ResourceCategoryView,
  type ResourceEntryBody,
  type ResourceEntryView,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

async function exists(e: Etzhayyim, collection: string, rkey: string): Promise<boolean> {
  const resp = await e.read({ collection, rkey }).catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

// ─── Resource category (PLAINTEXT, public reference taxonomy) ────────

export async function registerCategory(e: Etzhayyim, input: RegisterCategoryInput): Promise<RegisterCategoryOutput> {
  if (!input.category || !input.label || !input.description) return { status: "rejected", error: "missingRequiredFields" };
  const rkey = categoryRkey(input.category);
  const existing = await e
    .read<ResourceCategoryRecord>({ collection: CATEGORY_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", categoryUri: existing.records[0].uri, did: existing.records[0].value.did, category: input.category };
  }
  const now = new Date().toISOString();
  const did = categoryDidFor(input.category);
  const record: ResourceCategoryRecord = {
    did,
    category: input.category,
    label: input.label,
    description: input.description,
    createdAt: now,
  };
  const receipt = await e.write({ collection: CATEGORY_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", categoryUri: receipt.uri, did, category: input.category };
}

export async function getCategory(e: Etzhayyim, input: GetCategoryInput): Promise<GetCategoryOutput> {
  if (!input.category) return { error: "invalidCategory" };
  const resp = await e
    .read<ResourceCategoryRecord>({ collection: CATEGORY_COLLECTION, rkey: categoryRkey(input.category) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { category: { ...r.value, categoryUri: r.uri } };
}

export async function listCategories(e: Etzhayyim, input: ListCategoriesInput = {}): Promise<ListCategoriesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ResourceCategoryRecord>({ collection: CATEGORY_COLLECTION, cursor: input.cursor, limit });
  const items: ResourceCategoryView[] = resp.records.map((r) => ({ ...r.value, categoryUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Resource entry (E2E-ENCRYPTED, CUI per-org inventory) ───────────

export async function ingestResource(e: Etzhayyim, input: IngestResourceInput): Promise<IngestResourceOutput> {
  if (!input.entryId || !input.scopeId || !input.category || !input.name || !input.unit) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isUint(input.quantity)) return { status: "rejected", error: "invalidQuantity" };
  if (!isDecimalString(input.costEstimate)) return { status: "rejected", error: "invalidCostEstimate" };
  // FK: category must exist in the plaintext reference taxonomy.
  if (!(await exists(e, CATEGORY_COLLECTION, categoryRkey(input.category)))) {
    return { status: "rejected", error: "unknownCategory" };
  }
  const body: ResourceEntryBody = {
    entryId: input.entryId,
    scopeId: input.scopeId,
    category: input.category,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    costEstimate: input.costEstimate,
    currency: input.currency ?? "USD",
    ingestedAt: input.ingestedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: ENTRY_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: entryRkey(input.entryId),
  });
  return { status: "ingested", uri: receipt.uri, keyId: receipt.keyId, entryId: input.entryId };
}

async function scanEntries(e: Etzhayyim, maxScan: number): Promise<ResourceEntryView[]> {
  const out: ResourceEntryView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ResourceEntryBody>({ innerType: ENTRY_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listResources(e: Etzhayyim, input: ListResourcesInput = {}): Promise<ListResourcesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanEntries(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (r) => (!input.scopeId || r.scopeId === input.scopeId) && (!input.category || r.category === input.category),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getResource(e: Etzhayyim, input: GetResourceInput): Promise<GetResourceOutput> {
  if (!input.entryId) return { error: "invalidEntryId" };
  const all = await scanEntries(e, DEFAULT_MAX_SCAN);
  const found = all.find((r) => r.entryId === input.entryId);
  if (!found) return { error: "notFound" };
  return { entry: found };
}

// ─── Allocation plan (E2E-ENCRYPTED, CUI planning output) ───────────

export async function createPlan(e: Etzhayyim, input: CreatePlanInput): Promise<CreatePlanOutput> {
  if (!input.planId || !input.scopeId || !input.activity) return { status: "rejected", error: "missingRequiredFields" };
  if (!isPct(input.coveragePct)) return { status: "rejected", error: "invalidCoveragePct" };
  if (!isPriority(input.priority)) return { status: "rejected", error: "invalidPriority" };
  const lineItems = input.lineItems ?? [];
  for (const li of lineItems) {
    if (!li.category || !li.unit || !isUint(li.allocated)) return { status: "rejected", error: "invalidLineItem" };
  }
  const body: AllocationPlanBody = {
    planId: input.planId,
    scopeId: input.scopeId,
    activity: input.activity,
    coveragePct: input.coveragePct,
    priority: input.priority,
    status: input.status ?? "draft",
    lineItems,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: PLAN_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: planRkey(input.planId),
  });
  return { status: "created", uri: receipt.uri, keyId: receipt.keyId, planId: input.planId };
}

async function scanPlans(e: Etzhayyim, maxScan: number): Promise<AllocationPlanView[]> {
  const out: AllocationPlanView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<AllocationPlanBody>({ innerType: PLAN_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listPlans(e: Etzhayyim, input: ListPlansInput = {}): Promise<ListPlansOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanPlans(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((p) => !input.scopeId || p.scopeId === input.scopeId);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getPlan(e: Etzhayyim, input: GetPlanInput): Promise<GetPlanOutput> {
  if (!input.planId) return { error: "invalidPlanId" };
  const all = await scanPlans(e, DEFAULT_MAX_SCAN);
  const found = all.find((p) => p.planId === input.planId);
  if (!found) return { error: "notFound" };
  return { plan: found };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const entriesByCategory: Record<string, number> = {};
  let resourceCategoryCount = 0;
  let cursor: string | undefined;
  while (resourceCategoryCount < maxScan) {
    const page = await e.read<ResourceCategoryRecord>({ collection: CATEGORY_COLLECTION, cursor, limit: PAGE_LIMIT });
    resourceCategoryCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const entries = await scanEntries(e, maxScan);
  for (const r of entries) {
    entriesByCategory[r.category] = (entriesByCategory[r.category] ?? 0) + 1;
  }
  const plans = await scanPlans(e, maxScan);
  return {
    resourceCategoryCount,
    resourceEntryCount: entries.length,
    allocationPlanCount: plans.length,
    entriesByCategory,
    truncated: resourceCategoryCount >= maxScan || entries.length >= maxScan || plans.length >= maxScan,
  };
}
