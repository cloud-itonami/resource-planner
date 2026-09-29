# etzhayyim-project-resource-planner

Inngest event-driven resource planner. user_id/org_id スコープでリソースを ingestion し、活動に最適な resource allocation plan を生成する。

## Architecture: API-Only Component + Kotodama Static Delivery

- 静的アセット (`svelte/build/`) → App fileserver `rp.etzhayyim.com`
- App → API only (XRPC-Web)
- No `go:embed static` (static delivery 同梱配信)

## Components

### resource-planner-component (`etzhayyim-wasm-resource-planner-rp7n3st2`)

| 項目 | 値 |
|---|---|
| Port | 21072 |
| Domain | `rp.etzhayyim.com` (UI) / `1.etzhayyim.com/xrpc` (API) |
| Framework | performer (`etzhayyim.resourceplanner.v1.ResourcePlannerService`) |
| KV Bucket | `resource-planner-store` |
| nanoid | `rp7n3st2` |

## Resource Model

etzhayyim-project-resources の resourceModel に準拠:

| カテゴリ | 説明 | 例 |
|---|---|---|
| compute | CPU, GPU, memory, storage | vCPU 8 cores, A100 GPU 2台 |
| time | 時間リソース | 開発者 160h/月 |
| contracts | 契約・SLA | SaaS 契約、保守契約 |
| relationships | パートナー・ベンダー関係 | AWS パートナー、SI ベンダー |
| rights | ライセンス・権利 | ソフトウェアライセンス、特許 |
| equipment | 物理機器 | サーバー、ネットワーク機器 |
| social-capital | 社会資本 | ブランド価値、レピュテーション |

## Inngest Integration

### Event Types

| Event | Trigger | 処理 |
|---|---|---|
| `resource/ingested` | IngestResource RPC | KV 保存 + summary 更新 |
| `resource/updated` | UpdateResource RPC | KV 更新 + 関連 plan 再評価 |
| `resource/removed` | RemoveResource RPC | KV 削除 + 関連 plan 影響分析 |
| `plan/requested` | CreatePlan RPC | LLM による最適配分計算 |
| `plan/generated` | Inngest step function 完了 | 結果を KV 保存 + 通知 |
| `plan/approved` | ApprovePlan RPC | plan status → active |

### Inngest Functions (async step functions)

```
resource/ingested → fn: ingest-resource-handler
  step.run("validate") → バリデーション
  step.run("store") → KV 保存
  step.run("update-summary") → summary 再計算

plan/requested → fn: generate-plan-handler
  step.run("collect-inventory") → 現在のリソース一覧取得
  step.run("analyze-requirements") → activity requirements 分析
  step.run("optimize-allocation") → LLM で最適配分計算
  step.run("store-plan") → plan を KV 保存
  step.sendEvent("plan/generated") → 完了イベント
```

### HTTP Webhook (Inngest → Component)

Inngest は `/api/inngest` endpoint に webhook で function invocation を送信。
component は performer framework で受信し、step function を実行。

## KV Storage (NATS)

| Key Pattern | 内容 |
|---|---|
| `pf_rp7n3st2_u_{user_id}_res_{id}` | ユーザーリソース |
| `pf_rp7n3st2_o_{org_id}_res_{id}` | 組織リソース |
| `pf_rp7n3st2_u_{user_id}_summary` | ユーザーリソース summary |
| `pf_rp7n3st2_o_{org_id}_summary` | 組織リソース summary |
| `pf_rp7n3st2_u_{user_id}_plan_{id}` | ユーザー plan |
| `pf_rp7n3st2_o_{org_id}_plan_{id}` | 組織 plan |
| `pf_rp7n3st2_evt_{timestamp}_{id}` | Inngest event log |

Note: KV キーではコロン `:` は無効。`_` を使用。

## Performer Methods

```go
performer.NewAdapter("/etzhayyim.resourceplanner.v1.ResourcePlannerService")

// Ingestion
performer.Method{MCPName: "rp.ingest_resource", ConnectName: "IngestResource", Handler: handleIngestResource}
performer.Method{MCPName: "rp.bulk_ingest", ConnectName: "BulkIngest", Handler: handleBulkIngest}
performer.Method{MCPName: "rp.update_resource", ConnectName: "UpdateResource", Handler: handleUpdateResource}
performer.Method{MCPName: "rp.remove_resource", ConnectName: "RemoveResource", Handler: handleRemoveResource}

// Inventory
performer.Method{MCPName: "rp.list_resources", ConnectName: "ListResources", Handler: handleListResources}
performer.Method{MCPName: "rp.get_resource", ConnectName: "GetResource", Handler: handleGetResource}
performer.Method{MCPName: "rp.get_summary", ConnectName: "GetSummary", Handler: handleGetSummary}

// Planning
performer.Method{MCPName: "rp.create_plan", ConnectName: "CreatePlan", Handler: handleCreatePlan}
performer.Method{MCPName: "rp.get_plan", ConnectName: "GetPlan", Handler: handleGetPlan}
performer.Method{MCPName: "rp.list_plans", ConnectName: "ListPlans", Handler: handleListPlans}
performer.Method{MCPName: "rp.approve_plan", ConnectName: "ApprovePlan", Handler: handleApprovePlan}
performer.Method{MCPName: "rp.cancel_plan", ConnectName: "CancelPlan", Handler: handleCancelPlan}

// Events
performer.Method{MCPName: "rp.emit_event", ConnectName: "EmitEvent", Handler: handleEmitEvent}
performer.Method{MCPName: "rp.list_events", ConnectName: "ListEvents", Handler: handleListEvents}
```

## Proto Definition

`proto/etzhayyim/resourceplanner/v1/resourceplanner.proto`
- WIT が正 (source of truth)。Proto は XRPC client 生成用。
- `buf generate` → Connect-ES TypeScript client (Svelte UI 用)

## WIT Interface

- Source: `60-apps/etzhayyim-project-resource-planner/wit/resource-planner/package.wit`
- Package: `etzhayyim:resource-planner@0.1.0`
- Interface: `planner` (ingest/inventory/planning/events)
- Worlds: `etzhayyim-resource-planner-provider` / `etzhayyim-resource-planner-consumer`
