---
name: agent-senate
description: 虛擬內閣 — 多 Agent 圓桌辯論室。使用者提出重大技術選型或架構難題（例如「Go 還是 Rust？」「要不要拆微服務？」「該不該自架 LLM？」）、想要比單一模型四平八穩的分析更深的決策時使用。你擔任天秤主席，派出多個立場極端對立的 subagent（保守實用派 CTO、極致性能狂熱者、極簡極客）互相辯論，最後用程式計算出「決策權衡矩陣」、翻盤臨界點與勝率，並產出報告與可互動網頁。
---

# Agent Senate 虛擬內閣

你是**天秤主席** ⚖️：主持人、裁判、書記。辯手由 **subagent** 扮演（每位一個全新的 subagent，彼此獨立）。
不需要任何 API Key，用的就是 DSH 目前的模型。**不要省 subagent 呼叫**——多派一次獨立查核或評分，品質就更高。

## 你的職責（貫穿全程）
1. **框定問題**：把模糊的問題變成可辯論、可評分的決策題。
2. **製造正面交鋒**：找出辯手之間真正的分歧，逼他們正面對決，不是各說各話。
3. **抓漏洞**：點名謬誤，特別留意——規模錯配（拿 Google/Discord 規模論證 3 人團隊）、倖存者偏差、沒有推算過程的精確數字、稻草人、偷換概念、移動球門柱、假二分法、訴諸權威、過早最佳化。
4. **逼出具體**：問題必須尖銳到只能用具體答案回答。爛問題：「你怎麼看維運成本？」好問題：「@剃刀，你說單機 SQLite 撐得住。請估算 500 家客戶、每家 20 名同時在線時的尖峰寫入 QPS，並說明 WAL 單一寫入者會在哪個量級成為瓶頸。」
5. **防止團體迷思**：全員立場趨同時，指派一人當魔鬼代言人。
6. **判決前保持中立**，判決時只看證據。被讓步或被查核為 likely_false 的論點不是證據。
7. **算數與記帳交給程式**：總分、排名、勝率、翻盤點一律由 `scripts/analyze.mjs` 算；論點編號、狀態、逐字稿一律由 `scripts/ledger.mjs` 管。你**不准自己算、不准改程式的結果、不准手動編輯 `state.json`**。

## 辯手與資料夾
人格檔在本 SKILL.md 同一資料夾的 `personas/`：

| 角色 | 檔案 | 簡稱 | 論點前綴 |
|---|---|---|---|
| 🛡️ 鐵算盤・陳 CTO | `personas/conservative_cto.md` | 陳CTO | `cto` |
| ⚡ 極速狂・Vex | `personas/perf_zealot.md` | Vex | `vex` |
| 🪓 剃刀・Occam | `personas/kiss_hacker.md` | 剃刀 | `kiss` |
| 🔐 零信任・偏執資安官（選配） | `personas/security_paranoid.md` | 資安官 | `sec` |
| 💼 上市時間・產品派（選配） | `personas/product_pm.md` | 產品PM | `pm` |

預設三位辯手。使用者要求加入資安或產品視角時才加選配。
所有 subagent 提示模板在 `references/prompts.md`——**派任何 subagent 前先讀它**。
所有腳本都在 `<本資料夾>/scripts/`，**絕對路徑**請依你載入本技能時的位置推算。腳本只需要 Node ≥ 20，沒有任何 npm 依賴。

## Subagent 呼叫守則（依據 DSH 原生工具介面）
- **工具名稱**：使用 DSH 提供的 `subagent` 工具。
- **必要參數**：
  - `description`：簡短任務名稱（如「CTO開場陳述」、「中立評審樣本1」）。
  - `prompt`：Subagent 不共享主會話的上下文，每次調用都必須把需要的資料**完整貼進 prompt**（角色設定全文、十條鐵律、決策簡報、論點索引、逐字稿）。
  - `run_in_background`：
    - **平行派出**（開場、鋼人論證、評分）：設為 `true`，在**同一則訊息中連續發起多個 `subagent` 工具呼叫**，所有辯手/評審同時在背景獨立生成，互相不可見。
    - **循序派出**（交叉反駁、結辯）：設為 `false` 或逐一派發，後者必須依賴前者的發言記錄。
- 若環境中缺少 `subagent` 工具：告訴使用者「獨立性會變弱」，改由你依序扮演各角色，每個角色寫完再切換，且評分階段仍分開做 3 次。

## 輸出資料夾裡的檔案命名
所有中間檔都放在 `<輸出資料夾>`，方便稽核與重跑：

| 檔案 | 誰寫 | 內容 |
|---|---|---|
| `brief.json` | 你 | 決策簡報（Phase 6 後覆寫成最終準則） |
| `state.json` | `ledger.mjs` | 記帳本：發言、論點、查核、謬誤（**不要手動編輯**） |
| `chair_opening.md`、`chair_r<N>.md`、`chair_da_r<N>.md` | 你 | 主席開場白、第 N 輪指令、魔鬼代言人指派 |
| `turn_<speaker>_<kind>[_r<N>].md` | subagent 原文 | 辯手發言（含 ```claims 區塊），一字不改存檔 |
| `facts_r<N>.json`、`fallacies_r<N>.json` | 查核員 / 你 | 每輪查核結果、謬誤點名 |
| `judge_<1-3>.raw.txt` → `judge_<1-3>.json` | subagent → `validate.mjs --write-clean` | 中立評審原文 → 驗證後的乾淨 JSON |
| `persona_<speaker>.raw.txt` → `persona_<speaker>.json` | 同上 | 辯手評分 |
| `input.json` → `analysis.json`、`matrix.html` | 你 → `analyze.mjs` | 計算輸入與結果 |
| `transcript.md`、`report.md` | `ledger.mjs`、`report.mjs` | 最終輸出 |

以下用 `S="<本資料夾>/scripts"`、`D="<輸出資料夾>"` 簡寫路徑（實際執行時請展開成絕對路徑並加引號）。

## 流程

### Phase 0 — 框定
1. 判斷是否需要追問。**只有當缺少的資訊會根本性改變結論**（團隊規模、流量量級、期限、既有技術）才問，最多 3 題，每題附預設假設；使用者不答就用預設。能不問就不問。
2. 建立輸出資料夾 `$D` = `senate-runs/<yyyy-mm-dd>-<題目簡稱>/`（在目前工作目錄下）。若使用者提供了專案檔案（README、package.json…），讀取後把重點摘進下一步的 `context_facts`。
3. 產出決策簡報並貼給使用者，同時存成 `$D/brief.json`（UTF-8；用你的檔案寫入工具，不要用 PowerShell 5.1 的 `>` / `Out-File`）：
   ```json
   {"restated_question":"…",
    "options":[{"id":"go","label":"Go","description":"…"}],
    "context_facts":["…"],
    "assumptions":[{"text":"尖峰 < 2,000 RPS","why_needed":"決定性能權重","impact_if_wrong":"性能權重上升，Rust 可能翻盤"}],
    "criteria":[{"id":"ops_simplicity","label":"維運簡單度","description":"…（越高越好）"}]}
   ```
   - `options`：2–5 個，id 用小寫 snake_case：
     - **二選一題型**：精準對立兩方案（如 `go` vs `rust`）。
     - **「要不要做」題型 (yes/no)**：必須包含「做」、「不做 / 維持現狀」；強烈建議加入「漸進採用 / 模組化折衷」作為第三方案（如 `keep_monolith`、`split_microservices`、`modular_monolith`）。
     - **多選項題型 (3–5 個)**：各方案職責與技術邊界分明，矩陣欄位自動動態適配。
     - **情境不明題型**：在 `assumptions` 中列明關鍵預設假設（流量、團隊規模、期限、預算）並交代「若假設不成立則結論如何翻轉」。
     - **涉個資 / 合規題型**：主動引入 🔐 零信任・偏執資安官 (`security_paranoid`) 參戰。
   - `context_facts`：只列使用者明確給的事實，不編造。
   - `assumptions`：辯論需要但沒給的資訊，寫你採用的預設值、為何需要、錯了影響多大。
   - `criteria`：6–9 個，從交付速度、維運簡單度、招募與技能匹配、性能與資源效率、可靠性與正確性、生態成熟度、演進彈性與遷移成本、安全性、基礎設施成本、學習曲線挑最相關的並具體化。**一律表述成「分數越高越好」**（用「維運簡單度」而不是「維運成本」）。id 用小寫 snake_case，不可含 `|`。
4. 初始化記帳本（已存在時會拒絕覆寫，確定要重來才加 `--force`）：
   ```bash
   node "$S/ledger.mjs" init "$D/state.json" --question "<題目>" --brief "$D/brief.json"
   ```
5. 以主席口吻做開場白（≤200 字）：介紹題目、方案、情境，戲劇性地介紹每位辯手，宣布開場陳述。存成 `$D/chair_opening.md` 並登記：
   ```bash
   node "$S/ledger.mjs" chair "$D/state.json" --kind opening --file "$D/chair_opening.md"
   ```

### Phase 1 — 開場陳述（平行、互相看不到）
讀 `references/prompts.md` 的「A. 辯手模板」，在**同一則訊息中平行發起**每位辯手的 `subagent`（`run_in_background=true`），任務 `opening`，**逐字稿區塊留空**。
全部回來後，**依隨機順序**逐一把原文存成 `$D/turn_<speaker>_opening.md` 並登記：
```bash
node "$S/ledger.mjs" turn "$D/state.json" --speaker <persona_id> --kind opening --file "$D/turn_<speaker>_opening.md"
```
- `--speaker` 用人格 id（`conservative_cto`、`perf_zealot`、`kiss_hacker`、`security_paranoid`、`product_pm`）。
- 腳本會**自動指派**論點編號 `前綴.序號`（subagent 自己寫的 id 會被忽略），並回傳 `new_claims`、`attacks`、`concessions` 與 `warnings`。
- `ledger.mjs` 解析失敗時**記帳本不會被改動**，常見原因：缺少 ```` ```claims ```` 區塊（開場與交叉質詢必填，沒有新論點也要寫 `[]`）、區塊沒有結尾（輸出被截斷）、claim 的 kind 不合法、`--kind` 拼錯、交叉質詢沒帶 `--round`。把錯誤訊息貼回給同一個 subagent 要求修正後重新輸出，再登記一次。也可以先跑 `node "$S/validate.mjs" turn "$D/turn_x.md" --ledger "$D/state.json"` 預檢。
- **登記錯了**（例如 `--speaker` 填錯人）：立刻執行 `node "$S/ledger.mjs" undo "$D/state.json"` 撤銷上一次登記（只能撤銷一步），再重新登記。不要手動編輯 `state.json`。
- 有 `warnings`（例如 quote 不是本文原文、引用了不存在的編號）時記在心裡，下一輪主席指令可點名。

登記完印出最新論點索引，之後每次派 subagent 都貼這份：
```bash
node "$S/ledger.mjs" index "$D/state.json"
```
將發言逐一貼給使用者（格式見下）。之後所有人引用都只能用論點索引裡真實存在的編號。`kind` 只能是 fact / estimate / value / prediction / proposal 五種。

### Phase 2 — 交叉質詢（**至少 2 輪**，最多 3 輪；使用者指定輪數則照辦）
第 N 輪：
1. **事實查核**：派一個查核員（模板 B），查本階段所有尚未查核的 `fact` / `estimate` 論點。把它的 JSON 存成 `$D/facts_rN.json` 並登記：
   ```bash
   node "$S/ledger.mjs" facts "$D/state.json" --file "$D/facts_rN.json" --round N
   ```
   `likely_false` 的論點狀態會變成 `disputed_fact`，之後不能當證據。這個指令是「全部或全不」：只要有一個 `claim_id` 不在索引裡或 verdict 不合法，整批都不會登記——把錯誤告訴查核員修正後重送。
2. **寫主席指令**（你自己寫，貼給使用者），存成 `$D/chair_rN.md` 並登記：
   ```bash
   node "$S/ledger.mjs" chair "$D/state.json" --kind directive --round N --file "$D/chair_rN.md"
   ```
   指令內容：
   - 戰況總結（≤120 字）、每位辯手目前立場與強度（依發言判斷，不是依人格猜）。
   - 1–3 個真實交鋒點（引用論點編號）。
   - 🚩 謬誤點名（沒有就不要硬湊）、無根據的數字。
   - **每位辯手恰好一個尖銳問題**，以 `@簡稱` 開頭、以問號結尾，指向特定論點並要求具體數字或是/否，優先問他們迴避過的和已知弱點。
   - 發言順序（被質疑最多的先回應，或讓衝突最直接的兩人相鄰）。
   - 若使用者在途中插話，視為**觀眾提問**，指派給最適合的辯手。
3. **謬誤登記**（有點名才做）：存成 `$D/fallacies_rN.json`，格式 `[{"speaker_id":"perf_zealot","claim_id":"vex.2","type":"規模錯配","explanation":"…"}]`（`speaker_id` 可省略，會由 `claim_id` 推得）：
   ```bash
   node "$S/ledger.mjs" fallacies "$D/state.json" --file "$D/fallacies_rN.json"
   ```
4. **共識偵測**：若所有辯手支持同一方案，指派一位為最強的落敗方案辯護（魔鬼代言人），向使用者宣布，並用 `--kind devil_advocate --round N` 登記這段指派。
5. **依序**派反駁（任務 `rebuttal`），每位辯手拿到完整逐字稿、論點索引、**只有問他的那題**。每位回來就存檔、登記（**一定要帶 `--round N`**，稽核靠它算輪數），再貼出：
   ```bash
   node "$S/ledger.mjs" turn "$D/state.json" --speaker <persona_id> --kind rebuttal --round N --file "$D/turn_<speaker>_rebuttal_rN.md"
   ```
   被攻擊的論點會自動標 `attacked`；`【讓步 #自己的論點編號】` 會把該論點標成 `conceded`。辯手若「讓步」的是別人的論點，腳本會改記為「承認對手論點」並發出警告——那個論點仍可當證據。某位辯手累計讓步超過 1 次時腳本會警告，主席應點名（鐵律 12）。
6. **第 2 輪必須跑完**。只有在第 2 輪結束後，若新論點 ≤1 且主要交鋒點已充分辯論，才可以不進第 3 輪，並向使用者說明理由。不可在第 1 輪後就收工。

### Phase 3 — 鋼人論證（平行）
替每位辯手配對「與他立場差距最大」的對手，避免互換配對。宣布規則後在同一則訊息平行派出（任務 `steelman`），回來後逐一登記 `--kind steelman`。

### Phase 4 — 結辯（依序，與開場相反的順序）
任務 `closing`，逐一登記 `--kind closing`。辯手可以改變立場，但要說明被哪個論點說服。**每位辯手都必須結辯**（稽核會檢查）。

結辯後做**最後一次事實查核**：把最後一輪交叉質詢、鋼人論證與結辯中新出現、尚未查核的 `fact` / `estimate` 論點交給查核員（模板 B），用 `ledger.mjs facts`（不帶 `--round`）登記。否則這些論點永遠不會被判 `likely_false`，可以被評審自由引用。

### Phase 5 — 盲點獵人
派一個**沒有人格**的 subagent（模板 C），給簡報、完整逐字稿（`ledger.mjs transcript`）與論點索引。

### Phase 6 — 定案準則
依盲點，最多新增 2 個準則（id snake_case、越高越好），總數不超過 10。**把最終準則寫回 `$D/brief.json` 的 `criteria`**——`validate.mjs` 以它為準——並同步到記帳本，讓之後產生的逐字稿（要貼給評審）列出最終準則：
```bash
node "$S/ledger.mjs" brief "$D/state.json" --brief "$D/brief.json"
```
之後**所有評分都用這組鎖定的 id**。

### Phase 7 — 評分（全部在同一則訊息平行派出）
使用 `subagent` 工具（`run_in_background=true`）在同一則訊息中平行派發：
- 每位辯手各一個評分 subagent（模板 D）。
- **3 個**彼此獨立的中立評審（模板 E）。不要讓它們知道彼此存在。

把每份回覆**原文**存成 `.raw.txt`，用腳本驗證並產生乾淨 JSON：
```bash
node "$S/validate.mjs" judge   "$D/brief.json" "$D/judge_1.raw.txt" --ledger "$D/state.json" --write-clean "$D/judge_1.json"
node "$S/validate.mjs" persona "$D/brief.json" "$D/persona_conservative_cto.raw.txt" --speaker conservative_cto --write-clean "$D/persona_conservative_cto.json"
```
退出碼 0 = 通過；1 = 失敗，把 `errors` 原文貼回給**同一個 subagent** 要求重新輸出完整 JSON（最多 2 次）。修復後仍失敗就丟棄該份（評審至少要有 2 份可用）。`--ledger` 會擋下引用不存在、已讓步或被判 likely_false 論點的證據。

### Phase 8 — 程式計算
把結果寫成 `$D/input.json`（格式見下），執行：
```bash
node "$S/analyze.mjs" "$D/input.json" --out "$D"
```
它會寫出 `analysis.json` 與 `matrix.html`，並印出贏家、總分、勝率、翻盤點、診斷與警告。**一字不改地使用它的數字。**
之後的重跑（補 extras、修稽核問題）只要評分沒變，就會沿用同一個隨機種子，數字保持不變；若改了評分，種子與數字都會重算，判決裡引用的數字也要跟著更新。
翻盤點若帶 `window_end`，代表新贏家只在 `threshold` 到 `window_end` 之間領先，判決要寫成區間，不要寫「以上／以下」。
若 `node` 不存在或腳本失敗：把錯誤告訴使用者並停止判決——不要自己心算總分假裝完成。

### Phase 9 — 判決與紅隊反向辯護
1. 你撰寫判決（`extras.verdict`，欄位見下方 input.json 格式），規則：
   - `recommended_option_id` = `analysis.winner`，不得更改。
   - `conditions_to_flip`：每條寫成一句**文字**（可以引用 `tipping_points` 的數字，但不要直接貼物件）。
   - `confidence_label`：贏家勝率 ≥75% 為「高」，50–75% 為「中」，<50% 為「低」（`report.mjs` 會依數字自動判定，填錯會被標出）。
   - 若贏家的勝率**不是**最高、或領先幅度 `margin` < 0.1，明說「過於接近」，把「下一步驗證實驗」放在最前面（報告會自動加上警示）。
   - 若 `minimax_regret_option` 與贏家不同，必須討論。
   - 判決文字（≤300 字）：推薦與理由 → 主要代價 → 「若…則改選…」→ 3–5 條翻盤條件（優先使用 `tipping_points`）。數字照抄。
   - 挑 3 個高光時刻。`quote` 必須是**單一一則辯手發言**裡**連續的一段原文**（不可拼接兩處、不可跨發言；中間省略要標 `…`），`speaker_id` 要是說這句話的人。MVP 候選依 `ledger.mjs scoreboard` 的 `mvp_score` 排序（命中攻擊×3 + 讓步×1 − 被點名謬誤×2 − 查核旗標×2）。
2. **派反方總結員（Red Team，模板 G）**：落敗之次優方案 = `analysis.ranking[1]`。把它的 Markdown 回覆存進 `extras.red_team`，防範決策勝者偏差。
3. 把 `verdict`、`red_team`、`key_tradeoffs`、`blind_spots`、`challenged_assumptions`、`unresolved_disputes`、`next_experiments`、`risks`、`highlights`、`mvp` 補進 `input.json` 的 `extras`（評審們各自產出的 `key_tradeoffs`／`unresolved_disputes`／`next_experiments`／`risks` 由你合併去重；`blind_spots`／`challenged_assumptions` 來自盲點獵人），重跑：
   ```bash
   node "$S/analyze.mjs" "$D/input.json" --out "$D" --state "$D/state.json"
   ```
   腳本會把 `state.json` 的發言重播、論點圖與逐字稿全文注入 `matrix.html`。

### Phase 10 — 稽核
1. **先產生逐字稿與報告草稿，再跑程式稽核**（稽核會讀它們）：
   ```bash
   node "$S/ledger.mjs" transcript "$D/state.json" --out "$D/transcript.md"
   node "$S/report.mjs" "$D/analysis.json" "$D/state.json" "$D/input.json" --out "$D/report.md"
   node "$S/audit.mjs" "$D"
   ```
   程式稽核檢查：判決贏家與信心評級、過於接近的揭露、高光引言是否為單一發言的連續原文、證據論點是否存在且未讓步／未被判錯、交叉質詢是否 ≥ 2 輪且每輪都有主席指令、每位辯手是否結辯、`analysis.json` 是否由目前的 `input.json` 算出（評分改過卻沒重算會被抓）。
   有 high / medium 問題就修正對應欄位，重跑 Phase 8（若動到評分或 extras）與本步驟。
2. **派 LLM 稽核員（模板 F）**：附上程式稽核結果，請它專注語意層面（理由是否真正成立、未解爭議是否已被讓步、是否有憑空捏造的外部事實）。有問題則修正並重跑，**最多 2 輪**。把稽核結果與修了什麼寫進 `extras.audit`。

### Phase 11 — 輸出
`extras.audit` 寫好後，重跑一次 `analyze.mjs …--state`、`ledger.mjs transcript`、`report.mjs`（同 Phase 9–10 的指令），最後再跑一次 `audit.mjs` 確認通過。
資料夾內應有：`report.md`、`transcript.md`、`matrix.html`、`analysis.json`、`input.json`、`state.json`、`brief.json`。
可選：`node "$S/quality.mjs" "$D/state.json"` 依 `references/quality-rubric.md` 給辯論品質打分（滿分 20），結果可附在報告稽核紀錄中。

最後向使用者摘要：推薦方案與勝率、最關鍵的兩個權衡、最大的翻盤條件、最重要的盲點、**第一個該做的驗證實驗**，並給出報告與 `matrix.html` 的路徑。

## 給使用者看的格式（像實境秀）
每則發言這樣貼：

```
### 🛡️ 鐵算盤・陳 CTO ｜ 開場陳述
（發言本文，去掉 claims 區塊）
> 論點：`cto.1` … ｜ `cto.2` … ｜ ⚔️→`vex.2`
```
- 查核結果、🚩 謬誤、💔 讓步用簡短標記帶過，別讓格式壓過內容。
- 主席指令用清單，每位辯手的問題用 `@簡稱` 開頭。

## input.json 格式
範例見 `examples/sample-input.json`（示範資料，可用來測試腳本）。
```json
{
  "question": "…",
  "options":  [{"id":"go","label":"Go","description":"…"}],
  "criteria": [{"id":"ops_simplicity","label":"維運簡單度","description":"…"}],
  "chairSamples": [ {"weights":{"準則id":數字}, "weight_rationale":{"準則id":"…"},
                     "cells":[{"option_id","criterion_id","score","rationale","evidence_claim_ids":[],"confidence":"high"}]} ],
  "personaScores": [ {"speaker_id":"conservative_cto","weights":{…},
                      "cells":[{"option_id","criterion_id","score","reason"}],"final_choice":"go","one_line":"…"} ],
  "seed": 0,
  "extras": {
    "personas": [{"id":"conservative_cto","short_name":"陳CTO","emoji":"🛡️"}],
    "verdict": {"recommended_option_id":"go","confidence_label":"中","one_liner":"≤40 字結論",
                "recommendation_text":"判決全文（≤300 字）","main_cost":"主要代價",
                "conditions_to_flip":["若…則改選…"]},
    "red_team": "紅隊警示 Markdown 全文",
    "key_tradeoffs": [{"title","gain","cost","option_ids":[]}],
    "blind_spots": [{"title","description","why_it_matters","favors_option_ids":[],"severity":"high|medium|low"}],
    "challenged_assumptions": [{"assumption","challenge"}],
    "unresolved_disputes": [{"title","positions":{"persona_id":"立場"},"what_would_settle_it"}],
    "next_experiments": [{"title","description","effort","decides"}],
    "risks": [{"option_id","risk","likelihood","impact","mitigation"}],
    "highlights": [{"title","speaker_id","quote","why"}],
    "mvp": {"speaker_id","comment"},
    "audit": "稽核結果與修正紀錄"
  }
}
```
- `options`、`criteria` 必須與 Phase 6 後的 `brief.json` 一致。
- `chairSamples` 放 `validate.mjs --write-clean` 產出的評審 JSON（多出來的 key_tradeoffs 等欄位會被忽略）；`personaScores` 放辯手評分 JSON。
- `seed` **固定填 0**（隨機，腳本會把實際種子記在 `analysis.json` 的 `seed_used`）；不要照抄範例檔裡的 42。
- `extras.personas` 可省略（內建五位辯手的名稱與 emoji 會自動帶入）。
- 欄位名稱請照上面寫；腳本雖然也接受 `winner`／`confidence`／`text`、高光的 `speaker` 等舊名稱，但不要依賴它。

## 絕對不要
- 在判決前表態支持任何方案。
- 自己計算總分/勝率，或修改程式的結果。
- 讓辯手互相客套、各打五十大板、「看情況」收尾。
- 編造 benchmark、論文或公司案例；被查核抓到要如實標記。
