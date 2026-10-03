# DSH Subagent 工具真實介面說明

本文檔依據 DeepSeek Harness (DSH) 執行環境中實際提供的工具定義編寫，供主 Agent 於執行 Agent Senate 辯論時查閱與調用。

---

## 1. 核心調用工具：`subagent`

### 工具簽名與參數
- **工具名稱**：`subagent`
- **職責**：將獨立、自包含的任務委派給一個在自身獨立上下文中運行的 Subagent。Subagent 完成後僅返回其最終文本結果，不佔用主對話之上下文視窗。

| 參數名稱 | 類型 | 必填 | 說明 |
|---|---|:---:|---|
| `description` | `string` | 是 | 任務簡短描述（3–5 個詞），用於 UI 顯示（例如：「CTO 開場陳述」、「事實查核」）。 |
| `prompt` | `string` | 是 | 完整的自包含提示詞。**Subagent 不共享主會話的上下文**，因此必須將角色設定、決策簡報、論點索引、逐字稿等所需資訊完整放入 prompt。 |
| `run_in_background` | `boolean` | 否 | 預設為 `true`。若為 `true`，立即返回 subagent ID，主 Agent 可在同一則回覆中一次派發多個平行任務；當需要循序執行並直接取用結果時可設為 `false`。 |
| `provider` | `string` | 否 | 模型供應商路由（若省略則繼承父級或預設路由）。 |
| `model` | `string` | 否 | 指定 Subagent 運行的模型 ID（若省略則繼承）。 |
| `reasoning_effort` | `string` | 否 | 推理模型之思考深度（例如：`low` / `medium` / `high`）。 |

---

## 2. 平行派出模式（Parallel Dispatch）

在 DSH 中，當需要多位辯手或評審同時生成時（如 **Phase 1 開場陳述**、**Phase 3 鋼人論證**、**Phase 7 評分階段**）：
- 在**同一則 Assistant 訊息中連續發起多個 `subagent` 調用**。
- `run_in_background: true`（預設值），所有 Subagent 在背景並發執行，互不可見、互相獨立。
- 系統會在各 Subagent 結束時通知主 Agent。

## 3. 循序派出模式（Sequential Dispatch）

在需要後者看見前者發言的階段（如 **Phase 2 交叉反駁**、**Phase 4 結辯**）：
- 依序派發：每次派發一個 `subagent`，待其結果返回並由 `ledger.mjs` 記錄更新索引後，再派發下一位辯手。

---

## 4. 輔助相關工具

- `subagent_fork`：若需要繼承主會話當前已有紀錄的子任務時可用（但辯論原則要求「獨立性先於互動」，故開場與中立評審**必須使用標準 `subagent`**，避免錨定）。
- `list_subagent_models`：可用於查詢當前環境可用的模型路由。
