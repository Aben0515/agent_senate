# DEV_LOG — Agent Senate 開發與改進日誌

本文件依據 [PLAN.md](PLAN.md) 規範，記錄每個工作包（WP）的執行歷程、技術細節、測試證據、遇到的問題與決策。

---

## [2026-10-04] WP0: 環境與基線建立

### 1. 工作內容
- 完整研讀 `HANDOFF.md`、`PLAN.md`、`SKILL.md`、`references/prompts.md` 與 `scripts/analyze.mjs`。
- 驗證 Node.js (v24.19.0) 環境下的數學測試：`node skills/agent-senate/scripts/analyze.test.mjs` 通過 11/11 項單元測試。
- 調查 DSH 執行環境中實際提供的 Subagent 工具簽名與運行行為，完成實作指引檔 `skills/agent-senate/references/subagent-interface.md`。
- 保存第一次實戰輸出至 `evals/baseline-go-vs-rust/` 作為後續對照基線。

### 2. 基線觀察與根本原因分析 (Baseline Observations)
對比第一次實戰產出的 `report.md`、`transcript.md`、`input.json` 與 `analysis.json`，確認以下核心問題：
1. **交叉質詢輪數不足**：僅執行 1 輪交叉質詢即直接結辯，未跑滿規格要求之至少 2 輪。
2. **逐字稿記帳缺失**：`transcript.md` 僅有辯手發言，遺漏了天秤主席的開場白以及各輪主席指令。
3. **論點編號與型別混亂**：出現 `#vex-1`、`#cto-1`（與規範 `vex.1`、`cto.1` 不符）；索引中誤入非標準的 `kind: concession`，且辯手自身的翻盤條件被誤收錄為論點。
4. **高光引用拼接與 LLM 稽核失效**：高光金句存在兩處原文拼接，但 LLM 稽核員回報 0 問題，顯示純依賴 LLM 自查無法攔截格式與子字串缺陷。
5. **統計勝率過度極端 (100% vs 0%)**：中立評審打分高度一致導致 cell spread 趨近於 0，被下限 0.3 鎖住，在常態擾動下 Monte Carlo 勝率過於篤定。
6. **人格視角概念混淆**：報告中混淆了「使用辯手權重乘上主席分數 (`persona_lens`)」與「使用辯手自己打的分數 (`persona_own_view`)」。

### 3. 本階段產出
- `evals/baseline-go-vs-rust/`（完整基線檔案）
- `skills/agent-senate/references/subagent-interface.md`
- `DEV_LOG.md`

---

## [2026-10-04] WP1: 評分驗證腳本 validate.mjs

### 1. 工作內容
- 建立 `skills/agent-senate/scripts/validate.mjs`，提供 `judge`、`persona`、`turn` 三項確定性子命令。
- 支援容錯 JSON 抽取：處理 markdown code fences、前後贅詞、尾隨逗號（trailing commas）與平衡大括號。
- 檢查項涵蓋：
  - 每個「方案 × 準則」恰好一格（防缺格、防重複格）。
  - 所有 option_id 與 criterion_id 均屬鎖定簡報範圍。
  - 分數嚴格限制在 1.0 ~ 10.0。
  - 權重涵蓋全部準則且非負。
  - 若提供 `--ledger`，檢查證據論點是否引用了已被讓步 (`conceded`) 或查核不實 (`disputed_fact`) 的無效論點。
- 撰寫 `skills/agent-senate/scripts/validate.test.mjs`，包含 9 組單元測試，全部通過。
- 更新 `SKILL.md` Phase 7 流程，強制改用 `validate.mjs` 自動檢驗評分並提供自我修復反饋。

### 2. 測試證據
- `node skills/agent-senate/scripts/validate.test.mjs`：9/9 passed in 10ms。
- 基線 `input.json` 實測：3 份評審樣本與 3 份辯手樣本全數通過（errors = 0）。

---

## [2026-10-04] WP2: 論點與逐字稿記帳 ledger.mjs

### 1. 工作內容
- 建立 `skills/agent-senate/scripts/ledger.mjs`，管理整場辯論的 `state.json`。
- 子命令支援：
  - `init`：初始化狀態（問題、簡報）。
  - `chair`：記錄主席開場白、指令、判決。
  - `turn`：解析辯手發言中的 ```` ```claims ```` JSON 區塊，指派 `前綴.序號`（如 `cto.1`, `vex.1`），正則偵測文中讓步與引用，維護論點圖譜與狀態（open, attacked, conceded）。
  - `facts`：記錄查核結果並更新論點狀態（disputed_fact, plausible）。
  - `fallacies`：記錄主席點名之邏輯謬誤。
  - `index`：即時印出包含狀態徽章的論點索引，供下一輪辯手 prompt 調用。
  - `scoreboard`：計算各辯手論點數、命中攻擊、讓步、謬誤與 MVP 分數。
  - `transcript`：一鍵產生包含完整主席指令與開場白之確定性 `transcript.md`。
- 撰寫 `skills/agent-senate/scripts/ledger.test.mjs`，完整模擬 3 辯手、2 輪交互交鋒，驗證讓步與攻擊狀態聯動。
- 更新 `SKILL.md`，將手動記帳全面替換為 `ledger.mjs` 腳本調用。

### 2. 測試證據
- `node skills/agent-senate/scripts/ledger.test.mjs`：測試通過。
- 驗證成功排除基線中的自創編號與遺漏主席發言問題。

---

## [2026-10-04] WP3: 確定性報告組裝 report.mjs

### 1. 工作內容
- 建立 `skills/agent-senate/scripts/report.mjs`，消除人工手抄報告產生的數據幻覺與表格錯位。
- 核心功能：
  - 由程式生成標準 Markdown 權衡矩陣表格，自動填入中立權重、各方案得分與中位數理由。
  - 將 Monte Carlo 勝率、翻盤臨界點轉化為自然通順的條件語句。
  - **清晰分離兩張人格視角表**：
    1. `Persona Lens`：使用該辯手之權重乘上主席客觀中位數評分。
    2. `Persona Own View`：使用該辯手之權重乘上該辯手自身之主觀打分。
  - 自動帶入由 `ledger.mjs` 計算出之辯手表現計分板。
- 撰寫 `skills/agent-senate/scripts/report.test.mjs`，驗證特殊字元跳脫、欄位容錯降級與人格視角清晰度。
- 更新 `SKILL.md` Phase 11，強制透過 `report.mjs` 組裝報告。

### 2. 測試證據
- `node skills/agent-senate/scripts/report.test.mjs`：2/2 通過。
- 基線資料組裝實測：`evals/baseline-go-vs-rust/analysis.json` 成功組裝出完整乾淨報告。



