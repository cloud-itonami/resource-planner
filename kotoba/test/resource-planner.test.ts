import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerCategory,
  getCategory,
  listCategories,
  ingestResource,
  listResources,
  getResource,
  createPlan,
  listPlans,
  getPlan,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:rp.etzhayyim.com";

async function seedCategories(e: any) {
  await registerCategory(e, { category: "compute", label: "Compute", description: "CPU/GPU/memory/storage" });
  await registerCategory(e, { category: "time", label: "Time", description: "developer hours" });
}

describe("resource-planner kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("resourceCategory (PLAINTEXT public taxonomy)", () => {
    it("registers, dedups, validates, gets, lists", async () => {
      expect((await registerCategory(e, { category: "compute", label: "Compute", description: "cpu/gpu" })).status).toBe("registered");
      expect((await registerCategory(e, { category: "compute", label: "Compute", description: "cpu/gpu" })).status).toBe("alreadyExists");
      expect((await registerCategory(e, { category: "", label: "x", description: "y" })).status).toBe("rejected");
      await registerCategory(e, { category: "time", label: "Time", description: "hours" });
      expect((await listCategories(e)).total).toBe(2);
      const got = await getCategory(e, { category: "compute" });
      expect(got.category?.label).toBe("Compute");
      expect((await getCategory(e, { category: "nope" })).error).toBe("notFound");
    });
  });

  describe("resourceEntry (E2E-ENCRYPTED CUI inventory)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates, FK-checks category", async () => {
      await seedCategories(e);
      const ok = await ingestResource(e, {
        entryId: "r1", scopeId: "org-1", category: "compute", name: "A100 pool",
        quantity: 2, unit: "GPU", costEstimate: "12000.50", currency: "USD",
      });
      expect(ok.status).toBe("ingested");
      expect(ok.keyId).toBeTruthy();
      // FK: unknown category rejected
      expect((await ingestResource(e, { entryId: "rX", scopeId: "o", category: "ghost", name: "n", quantity: 1, unit: "u", costEstimate: "1" })).status).toBe("rejected");
      // float quantity rejected (must be integer)
      expect((await ingestResource(e, { entryId: "rF", scopeId: "o", category: "compute", name: "n", quantity: 1.5 as any, unit: "u", costEstimate: "1" })).status).toBe("rejected");
      // cost must be decimal string, not float
      expect((await ingestResource(e, { entryId: "rC", scopeId: "o", category: "compute", name: "n", quantity: 1, unit: "u", costEstimate: 1200 as any })).status).toBe("rejected");

      const got = await getResource(e, { entryId: "r1" });
      expect(got.entry?.scopeId).toBe("org-1");
      expect(got.entry?.costEstimate).toBe("12000.50");
      expect(got.entry?.quantity).toBe(2);

      await ingestResource(e, { entryId: "r2", scopeId: "org-2", category: "time", name: "dev hours", quantity: 160, unit: "hours", costEstimate: "8000" });
      expect((await listResources(e)).total).toBe(2);
      expect((await listResources(e, { scopeId: "org-1" })).total).toBe(1);
      expect((await listResources(e, { category: "time" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the inventory", async () => {
      await seedCategories(e);
      await ingestResource(e, { entryId: "r1", scopeId: "org-1", category: "compute", name: "n", quantity: 1, unit: "GPU", costEstimate: "100" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listResources(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      await seedCategories(e);
      const r = await ingestResource(e, {
        entryId: "r1", scopeId: "org-1", category: "compute", name: "n", quantity: 1, unit: "GPU", costEstimate: "100",
        recipients: ["did:web:partner.example"],
      });
      expect(r.status).toBe("ingested");
      expect((await listResources(e)).total).toBe(1);
    });
  });

  describe("allocationPlan (E2E-ENCRYPTED CUI planning output)", () => {
    it("seals, round-trips, validates pct/priority/lineItems, isolates from entries", async () => {
      await seedCategories(e);
      const ok = await createPlan(e, {
        planId: "p1", scopeId: "org-1", activity: "ship release", coveragePct: 85, priority: 2,
        lineItems: [{ category: "compute", allocated: 2, unit: "GPU" }],
      });
      expect(ok.status).toBe("created");
      expect(ok.keyId).toBeTruthy();
      // coverage>100 rejected
      expect((await createPlan(e, { planId: "pX", scopeId: "o", activity: "a", coveragePct: 200, priority: 1 })).status).toBe("rejected");
      // priority out of 1-9 rejected
      expect((await createPlan(e, { planId: "pY", scopeId: "o", activity: "a", coveragePct: 50, priority: 0 })).status).toBe("rejected");
      // bad line item (float allocated) rejected
      expect((await createPlan(e, { planId: "pZ", scopeId: "o", activity: "a", coveragePct: 50, priority: 1, lineItems: [{ category: "compute", allocated: 1.5 as any, unit: "GPU" }] })).status).toBe("rejected");

      const got = await getPlan(e, { planId: "p1" });
      expect(got.plan?.coveragePct).toBe(85);
      expect(got.plan?.lineItems[0]?.allocated).toBe(2);

      await createPlan(e, { planId: "p2", scopeId: "org-2", activity: "other", coveragePct: 40, priority: 5 });
      expect((await listPlans(e)).total).toBe(2);
      expect((await listPlans(e, { scopeId: "org-1" })).total).toBe(1);

      // innerType isolation: an entry never leaks into the plan list and vice versa.
      await ingestResource(e, { entryId: "r1", scopeId: "org-1", category: "compute", name: "n", quantity: 1, unit: "GPU", costEstimate: "100" });
      expect((await listPlans(e)).total).toBe(2);
      expect((await listResources(e)).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext categories + E2E entries + E2E plans", async () => {
      await seedCategories(e);
      await ingestResource(e, { entryId: "r1", scopeId: "org-1", category: "compute", name: "n", quantity: 1, unit: "GPU", costEstimate: "100" });
      await ingestResource(e, { entryId: "r2", scopeId: "org-1", category: "compute", name: "n2", quantity: 1, unit: "GPU", costEstimate: "200" });
      await createPlan(e, { planId: "p1", scopeId: "org-1", activity: "a", coveragePct: 50, priority: 1 });
      const cov = await coverage(e);
      expect(cov.resourceCategoryCount).toBe(2);
      expect(cov.resourceEntryCount).toBe(2);
      expect(cov.allocationPlanCount).toBe(1);
      expect(cov.entriesByCategory?.compute).toBe(2);
    });
  });
});
