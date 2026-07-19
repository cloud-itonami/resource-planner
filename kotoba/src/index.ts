/**
 * resource-planner kotoba — barrel. kotoba-E2E split (ADR-2605181100):
 * plaintext public resourceCategory taxonomy + E2E-sealed confidential
 * resourceEntry inventory and allocationPlan output. LLM allocation inference
 * + Inngest orchestration EXECUTION stay etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
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
} from "./registry.js";
