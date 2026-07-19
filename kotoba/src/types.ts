/**
 * resource-planner kotoba — kotoba-E2E split.
 *
 * Per ADR-2606011400 (Consensys product-front / infra-back) + ADR-2605172400
 * (3-axis Liability/Custody/Settlement) + ADR-2605181100 (kotoba E2E
 * encrypted-record envelope). Founder directive 2026-06-03: PII / CUI /
 * confidential per-org data may migrate to etzhayyim when made E2E-safe.
 *
 * SPLIT (derived from the actual data surface — CLAUDE.md / PROJECT.jsonld):
 *
 *   PUBLIC (plaintext AT records) — resourceCategory catalog: the open
 *   reference taxonomy (compute / time / contracts / relationships / rights /
 *   equipment / social-capital) with descriptions. Non-sensitive,
 *   frontable reference data. sdk.write / sdk.read; FK target for entries.
 *
 *   SENSITIVE / CUI (kotoba E2E, com.etzhayyim.encrypted.record):
 *     - resourceEntry — per-user/per-org inventory rows incl. quantity + cost
 *       estimate (confidential business data, owner-scoped). Sealed via
 *       sdk.encryptedWrite; read-cap = owner DID + explicit recipients.
 *     - allocationPlan — generated optimal resource-allocation plan
 *       (coverage %, priority, line items). Confidential planning output.
 *   The substrate never sees inventory cost / plan content in plaintext.
 *
 *   STAYS etzhayyim (NOT a collection — consumed via consent-capability) — the
 *   LLM INFERENCE execution that computes the optimal allocation
 *   (plan/requested → "LLM による最適配分計算") and the Inngest durable
 *   workflow ORCHESTRATION execution (step functions). These are the
 *   regulated *acts*; the resulting plan DATA migrates as E2E above.
 *
 * AT-Lexicon constraints: no float. quantities/cores/hours/counts = integer;
 * cost/money = decimal STRING ("1200.50"); coverage/priority percent =
 * integer 0-100.
 */

// Plaintext public collection.
export const CATEGORY_COLLECTION = "com.etzhayyim.apps.resourcePlanner.resourceCategory";
// E2E inner-type NSIDs (body shapes inside the encrypted envelope).
export const ENTRY_INNER_TYPE = "com.etzhayyim.apps.resourcePlanner.resourceEntry";
export const PLAN_INNER_TYPE = "com.etzhayyim.apps.resourcePlanner.allocationPlan";

export const RP_DID_PREFIX = "did:web:rp.etzhayyim.com:" as const;

/** Canonical resource categories (PROJECT.jsonld resource model). */
export const RESOURCE_CATEGORIES = [
  "compute",
  "time",
  "contracts",
  "relationships",
  "rights",
  "equipment",
  "social-capital",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

// ─── Resource category (PLAINTEXT, public reference taxonomy) ────────

export interface ResourceCategoryRecord {
  did: string;
  category: string;
  label: string;
  description: string;
  createdAt: string;
}
export interface ResourceCategoryView extends ResourceCategoryRecord {
  categoryUri: string;
}
export interface RegisterCategoryInput {
  category: string;
  label: string;
  description: string;
}
export interface RegisterCategoryOutput {
  status: "registered" | "alreadyExists" | "rejected";
  categoryUri?: string;
  did?: string;
  category?: string;
  error?: string;
}
export interface GetCategoryInput {
  category: string;
}
export interface GetCategoryOutput {
  category?: ResourceCategoryView;
  error?: string;
}
export interface ListCategoriesInput {
  limit?: number;
  cursor?: string;
}
export interface ListCategoriesOutput {
  items: ResourceCategoryView[];
  cursor?: string;
  total: number;
}

// ─── Resource entry (E2E-ENCRYPTED, CUI per-org inventory) ───────────

export interface ResourceEntryBody {
  entryId: string;
  /** Owning scope — user or org. */
  scopeId: string;
  /** Must reference a registered resourceCategory (FK via exists()). */
  category: string;
  name: string;
  /** Integer count of units (cores / hours / seats / devices …). */
  quantity: number;
  /** Unit of quantity, e.g. "vCPU", "hours", "seat". */
  unit: string;
  /** Cost estimate as a decimal STRING (no float in lexicon), e.g. "1200.50". */
  costEstimate: string;
  /** Currency code, e.g. "USD". */
  currency: string;
  ingestedAt: string;
}
export interface ResourceEntryView extends ResourceEntryBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface IngestResourceInput {
  entryId: string;
  scopeId: string;
  category: string;
  name: string;
  quantity: number;
  unit: string;
  costEstimate: string;
  currency?: string;
  ingestedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface IngestResourceOutput {
  status: "ingested" | "rejected";
  uri?: string;
  keyId?: string;
  entryId?: string;
  error?: string;
}
export interface ListResourcesInput {
  scopeId?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}
export interface ListResourcesOutput {
  items: ResourceEntryView[];
  cursor?: string;
  total: number;
}
export interface GetResourceInput {
  entryId: string;
}
export interface GetResourceOutput {
  entry?: ResourceEntryView;
  error?: string;
}

// ─── Allocation plan (E2E-ENCRYPTED, CUI planning output) ───────────

export interface PlanLineItem {
  category: string;
  /** Allocated integer quantity. */
  allocated: number;
  unit: string;
}
export interface AllocationPlanBody {
  planId: string;
  scopeId: string;
  activity: string;
  /** integer 0-100 — fraction of requirements covered. */
  coveragePct: number;
  /** integer 1-9 priority rank. */
  priority: number;
  status: "draft" | "active" | "cancelled";
  lineItems: PlanLineItem[];
  generatedAt: string;
}
export interface AllocationPlanView extends AllocationPlanBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface CreatePlanInput {
  planId: string;
  scopeId: string;
  activity: string;
  coveragePct: number;
  priority: number;
  lineItems?: PlanLineItem[];
  status?: "draft" | "active" | "cancelled";
  generatedAt?: string;
  recipients?: string[];
}
export interface CreatePlanOutput {
  status: "created" | "rejected";
  uri?: string;
  keyId?: string;
  planId?: string;
  error?: string;
}
export interface ListPlansInput {
  scopeId?: string;
  limit?: number;
  cursor?: string;
}
export interface ListPlansOutput {
  items: AllocationPlanView[];
  cursor?: string;
  total: number;
}
export interface GetPlanInput {
  planId: string;
}
export interface GetPlanOutput {
  plan?: AllocationPlanView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  resourceCategoryCount?: number;
  resourceEntryCount?: number;
  allocationPlanCount?: number;
  entriesByCategory?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isPct(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;
}
/** Priority rank 1-9 (integer). */
export function isPriority(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 9;
}
/** Decimal money STRING — digits with optional single fractional part, no float. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function categoryDidFor(id: string): string {
  return `${RP_DID_PREFIX}cat:${id.toLowerCase()}`;
}
export function categoryRkey(id: string): string {
  return `cat-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function entryRkey(id: string): string {
  return `entry-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function planRkey(id: string): string {
  return `plan-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
