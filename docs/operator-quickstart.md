# Operator quickstart

**The test suite runs, and it does not run the way `package.json` says.** Six tests
pass without installing the dependency the package declares — because no runtime
code path in this repository uses it.

That matters more than it sounds, because one of those six tests is the one
asserting that confidential inventory stays confidential, and **that test cannot
fail**. §3 shows it passing while every encrypted write silently grants a third
party read access.

This repository is a migration seed: 11 tracked files extracted verbatim from
`etzhayyim/root` at `60-apps/etzhayyim-project-resource-planner`, plus
`README.edn` and `migration.edn`. What is here is the `kotoba/` TypeScript
implementation — a category taxonomy, an inventory registry, an allocation-plan
registry, and their validators. Everything else `CLAUDE.md` describes is
elsewhere or nowhere (§4).

Steps marked ✅ were run against this tree on 2026-08-15, Node v26.3.0, npm 11.16.0.
The ⚠ items were measured. The section marked NOT WALKED says why.

---

## 1. Running the six tests ✅

`npm install` does not get you there. It fails before it starts:

```bash
cd kotoba && npm install
#   npm error code EALLOWSCRIPTS
#   npm error --allow-scripts is not allowed in project-scoped installs.
#   npm error git dep preparation failed
```

The reason is structural rather than local. `package.json` depends on
`@etzhayyim/sdk` as a **git** dependency, git dependencies are built by their own
`prepare` script, and that package's `prepare` is `tsc` — so installing it means
building it, which means resolving its own tree: `@atproto/api`, `viem`,
`@noble/*`, `multiformats`, and **six further git dependencies**. (npm's exact
refusal is version-dependent; that this build is required is not.)

None of it is needed. `src/registry.ts` line 15 imports the SDK as a **type**:

```ts
import type { Etzhayyim } from "@etzhayyim/sdk";
```

Type-only imports are erased before the code runs. And the mock has no imports at
all — `@etzhayyim/sdk-mock` is a single self-contained 309-line file whose own
declared dependency on the SDK is likewise unused. So the tests need exactly two
things: that one mock file, and a test runner.

```bash
# the mock, at the commit package.json pins
git clone -q https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git /tmp/sdk-mock
git -C /tmp/sdk-mock checkout -q c857ff9be5310bf433bfe1e8d3c0f677e213d667

# vitest, installed anywhere except this package
mkdir -p /tmp/vitest-host && (cd /tmp/vitest-host && npm init -y >/dev/null \
  && npm install --no-audit --no-fund vitest@4.1.0)

# link both into place
cd kotoba
mkdir -p node_modules/@etzhayyim
ln -sfn /tmp/sdk-mock node_modules/@etzhayyim/sdk-mock
for d in /tmp/vitest-host/node_modules/*; do
  b=$(basename "$d"); [ "$b" = ".bin" ] && continue; [ "$b" = "@etzhayyim" ] && continue
  ln -sfn "$d" "node_modules/$b"
done
ln -sfn /tmp/vitest-host/node_modules/.bin node_modules/.bin

./node_modules/.bin/vitest run
```

Actual output:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  6.03s
```

That duration was the first run; repeat runs measured 416ms and 1.27s. Read the
counts, not the clock.

**`node_modules/` is untracked and this repository has no `.gitignore`.** Remove it
when you are done, or you will commit it.

## 2. `typecheck` needs the SDK; `test` does not ✅

The two scripts in `package.json` have different dependency requirements, which is
worth knowing before you conclude the tree is broken:

```bash
./node_modules/.bin/vitest run     # 6 passed  — SDK absent
tsc --noEmit                       # 2 errors  — SDK absent
```

Both errors are the same missing type, once directly and once as a consequence:

```
src/registry.ts(15,32): error TS2307: Cannot find module '@etzhayyim/sdk' or its
                                      corresponding type declarations.
src/registry.ts(101,59): error TS7006: Parameter 'r' implicitly has an 'any' type.
```

So a green `vitest run` here does **not** mean the package typechecks. To typecheck
you need the full SDK build described in §1.

## 3. ⚠ One of the six tests cannot fail

The test named *"enforces read-cap: a non-recipient DID cannot decrypt the
inventory"* is the only test covering the confidentiality claim that `types.ts`
makes in its header — *"The substrate never sees inventory cost / plan content in
plaintext"*.

Measured: change `src/registry.ts` so that **every** encrypted write grants read
access to an outsider —

```ts
-    recipients: input.recipients ?? [],
+    recipients: input.recipients ?? ["did:web:outsider.example"],
```

— at both call sites (line 131, `ingestResource`; line 191, `createPlan`), and:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Every confidential inventory row and every allocation plan is now readable by a
third party, and the suite is still green.

**The mock is not at fault.** `MockEtzhayyim.encryptedRead` filters correctly
(`src/index.ts:183` — `r.recipients.includes(this.did)`). The problem is that
`encStore` is a **private per-instance field** (`src/index.ts:103`), so a second
`MockEtzhayyim` is a second empty store. The test's outsider sees 0 records because
it has no records, not because it was denied any.

The distinguishing check, which passes:

```ts
const owner   = new MockEtzhayyim({ did: "did:web:rp.etzhayyim.com" });
await ingestResource(owner, { /* … */ recipients: ["did:web:partner.example"] });

const granted = new MockEtzhayyim({ did: "did:web:partner.example" });   // GRANTED
const denied  = new MockEtzhayyim({ did: "did:web:outsider.example" });  // denied

expect((await listResources(owner)).total).toBe(1);
expect((await listResources(granted)).total).toBe(0);   // ← grant has no effect
expect((await listResources(denied)).total).toBe(0);
```

The explicitly granted recipient and the denied outsider are indistinguishable.
Any assertion built on the difference between them is measuring nothing.

**This shape is not local to this repository.** Measured across `cloud-itonami` and
`etzhayyim`:

| | count |
|---|---|
| repositories with a `MockEtzhayyim` test file | 164 |
| such test files | 381 |
| files that build a second `MockEtzhayyim` **and** assert `toBe(0)` | **109** |
| repositories containing at least one | **53** |
| distinct `sdk-mock` commits pinned across 311 `package.json` files | **1** (`c857ff9be531`) |

Every one of those files runs against the same mock, so the per-instance store
holds for all of them. Whether each of the 109 is vacuous depends on what it
asserts — the shape was matched mechanically, and only this repository's instance
was walked.

**The suite is not worthless — it discriminates elsewhere.** Widening the
percentage bound in `src/types.ts` —

```ts
-  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;
+  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1000;
```

— turns exactly one test red, with the assertion that names the cause:

```
AssertionError: expected 'created' to be 'rejected'
 Tests  1 failed | 5 passed (6)
```

So read the six as: **validation is tested, confidentiality is not.** Whether to
fix the test or the mock is a decision for the app's owner; this document names the
gap and does not resolve it.

## 4. ⚠ `CLAUDE.md` describes a different system ✅

`CLAUDE.md` documents a Go `performer` component with fourteen RPC methods, Inngest
step functions, NATS KV key patterns, a `.proto` definition, and a WIT interface.
Measured in this tree:

```bash
git ls-files | grep -cE '\.go$'          # 0   (grep exits 1 on no match — that is the answer)
git ls-files | grep -cE '\.proto$'       # 0
git ls-files | grep -cE '\.wit$'         # 0
git ls-files | grep -cE 'svelte'         # 0
```

Neither domain it names resolves:

```bash
dig +short rp.etzhayyim.com   # (nothing)
dig +short 1.etzhayyim.com    # (nothing)
```

`MIGRATION-TODO.md` is the accurate document: *"🔄 TRANSFORM — seed copied
2026-05-21, codemod pending"*, with seven unticked substrate-boundary checkboxes.
Read it before `CLAUDE.md`, not after.

**The provenance record is trustworthy**, and is the one thing here that verifies
exactly:

```bash
R=orgs/etzhayyim/root   # from the superproject
git -C $R rev-parse 1fb8430a66cbb4680f053fa5185a08a2904cae0d:60-apps/etzhayyim-project-resource-planner
#   c2444869c09a9ff3859be70528fef57bc78719af   ← equals migration.edn :git-tree

git -C $R ls-tree -r --name-only 1fb8430a66cbb4680f053fa5185a08a2904cae0d \
  -- 60-apps/etzhayyim-project-resource-planner | wc -l
#   11                                          ← equals migration.edn :tracked-files
```

Across all 27 `cloud-itonami` seeds naming `etzhayyim/root` as their source, 27/27
revisions resolve and 23/23 declared tree hashes match. When these files disagree
with the prose, trust these.

## 5. NOT WALKED — whether any of this matches something deployed

Not attempted, and not concluded either way. The seven `MIGRATION-TODO.md`
checkboxes (Stripe→USDC, Kysely removal, DID-bound identity, Charter Rider v2.0
audit) describe remediation against a running system, and no endpoint reachable
from here serves this actor: both declared hosts are NXDOMAIN, and the LLM
allocation inference and Inngest orchestration that `types.ts` says "stay
etzhayyim" are by construction not in this repository. Nothing in this tree can
tell you whether the deployed component, if one exists, resembles this code. Do not
read the green test run in §1 as evidence about production.
