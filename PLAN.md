# PLAN — Agent Senate 下一階段改進計畫（給 Gemini 執行）

> **先讀 [HANDOFF.md](HANDOFF.md)**（歷史、架構、已修 bug、地雷、驗證狀態）。這份是「接下來要做什麼」。
> 執行者的 token 不設上限：**請用額外的驗證、重複實跑、多組測試換品質，不要為了省 token 偷工。**
> 規劃者：Claude。專案擁有者：Aben0515。日期：2026-10-04。

---

## 0. 目標與一句話現況

**目標**：讓這個 DSH 插件的辯論**穩定、可信、好看**——換任何類型的技術決策題都能跑完整流程，數字不出錯，報告不出現幻覺，結果頁面像一份可以直接分享的成品。

**現況**：純技能版已在真 DSH 跑通一次（Go vs Rust），流程完整、內容像樣。但從那次實戰讀逐字稿與報告發現：
- 流程完全靠「SKILL.md 的文字指令」讓 agent 自己記帳（論點編號、狀態、逐字稿、報告數字），**agent 一疏忽就出錯**（只跑 1 輪、transcript 缺主席指令、出現不存在的論點編號、quote 拼接、報告把兩種「人格視角」混用）。
- 稽核員太寬鬆（0 問題，但實際有問題）。
- Monte Carlo 勝率 100%/0%，過度篤定。
- 只有一次樣本，題型單一。

**核心策略**：**把 agent 容易出錯的「記帳與核對」工作，從提示詞搬到確定性的 Node 腳本**。LLM 只做判斷與寫作，腳本負責編號、狀態、組裝文件、查驗引用、核對數字。

---

## 1. 不可違反的限制（硬約束）

1. **不得重新引入 API Key、Python、常駐伺服器。** 只用 DSH 的 subagent + Markdown + Node 腳本。
2. **不得動 `C:\Users\yuana\Desktop\DSH\cognitive-zoom\` 與 `plugin\data\`**——那是別的專案（使用者說過「它是別的」）。
3. **不要在 `plugin/` 根目錄 commit**，只在 `agent-senate-dsh/` 這個獨立 repo 裡 commit。
4. **推送（`git push`）前必須先問使用者。** 這個 repo 是公開發佈管道，使用者透過 DSH 市集從 GitHub 取得更新。
5. 套件名稱 `agent-senate-dsh` 不可改（`cordis.patch.yml` 寫死）。
6. **絕不寫入 UTF-8 BOM**（會弄壞 SKILL.md frontmatter）。含跳脫序列（`\u2028`、`\\u003c`）的程式碼用檔案編輯工具寫，不要用 shell heredoc，寫完 `grep` 確認。
7. 所有 LLM 產生的文字放進 HTML 一律用 `textContent`／DOM 建構，**禁止 `innerHTML`**（XSS）。
8. 腳本只用 Node 內建模組（`node:*`），**不新增 npm 依賴**（使用者環境不一定能 `npm install`）。Node ≥ 20。
9. 每個工作包結束都要：`npm test` 全過 → 更新 `HANDOFF.md` → 在 `DEV_LOG.md` 記錄（做了什麼、證據、遇到的問題）→ commit（中文訊息）。
10. 不要為了讓測試過而放寬測試。測試失敗要找真因（本專案已經因此抓到過兩個真 bug）。

---

## 2. 工作包總覽與順序

| # | 工作包 | 解決什麼 | 依賴 |
|---|---|---|---|
| WP0 | 環境與基線 | 確認一切可跑、取得 subagent 真實介面 | — |
| WP1 | 驗證腳本 `validate.mjs` | 評分 JSON 缺格/亂 id，agent 肉眼檢查不可靠 | WP0 |
| WP2 | 論點與逐字稿記帳 `ledger.mjs` | 編號錯、狀態亂、transcript 缺主席指令 | WP0 |
| WP3 | 報告組裝 `report.mjs` | 報告數字抄錯、兩種人格視角混用 | WP2 |
| WP4 | 程式稽核 `audit.mjs` | LLM 稽核太寬鬆 | WP2、WP3 |
| WP5 | 統計校準 | 勝率 100% 過度篤定 | WP0 |
| WP6 | 辯論品質工程 | 人格崩壞、客套、一面倒 | WP2 |
| WP7 | 題型覆蓋 | 只測過二選一 | WP6 |
| WP8 | 結果頁升級（含辯論重播） | 讓頁面成為完整可分享成品 | WP2、WP3 |
| WP9 | 評測：辯論 vs 單一模型 | 證明這東西比直接問強 | WP7 |
| WP10 | 發佈與收尾 | 版本、README、市集安裝實測 | 全部 |

**建議順序**：WP0 → WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP7 → WP8 → WP9 → WP10。WP1–WP5 是「讓它不出錯」，優先於「讓它更炫」。

---

## WP0 — 環境與基線

**做什麼**
1. 讀完 `HANDOFF.md`、`SKILL.md`、`references/prompts.md`、`scripts/analyze.mjs`、`scripts/matrix.template.html`。
2. `npm test` 確認 11/11 通過。
3. **找出 subagent 工具的真實介面**：你自己的工具清單裡就有 subagent 工具，直接看它的名稱、參數、是否能平行、回傳格式、有無輸出長度上限、能否指定模型/推理強度。**把結果寫進新檔 `skills/agent-senate/references/subagent-interface.md`**（SKILL.md 目前刻意用通用說法，因為作者當初沒看到這個介面）。
4. 看第一次實戰的輸出作為基線（不要修改，另存副本到 `evals/baseline-go-vs-rust/`）：
   `C:\Users\yuana\Documents\deepseek-harness\default-workspace\senate-runs\2026-10-04-b2b-backend-go-vs-rust\`
5. 在 `DEV_LOG.md` 建立檔案，開頭寫基線觀察。

**驗收**：`subagent-interface.md` 存在且內容出自實際工具定義；基線副本已存；`DEV_LOG.md` 已建立。

**接著**：依 `subagent-interface.md` 修改 SKILL.md 中所有「派 subagent」的敘述，改成明確的呼叫方式（工具名、參數、如何一次平行派多個）。

---

## WP1 — 驗證腳本 `scripts/validate.mjs`

**問題**：SKILL.md 叫 agent「逐格檢查缺格/亂 id」，但它是肉眼做的。`analyze.mjs` 雖會丟棄不完整樣本，卻是在**全部評審都回來之後**才發現，沒機會叫原 subagent 重做。

**規格**
```
node validate.mjs judge     <brief.json> <judge-output.json>     # 驗中立評審
node validate.mjs persona   <brief.json> <persona-output.json>   # 驗辯手評分
node validate.mjs turn      <ledger.json> <speaker> <turn.md>    # 驗辯手發言（見 WP2）
```
- `brief.json` 含鎖定的 `options[]`、`criteria[]`。
- 輸出 JSON：`{ "ok": true|false, "errors": [人類可讀、可直接貼回給 subagent 的修正指示], "warnings": [] }`，exit code 0/1。
- `judge`/`persona` 檢查：JSON 可解析（容忍外層 markdown 圍欄與前後雜訊，抽出第一個平衡的 `{…}`）；每個「方案×準則」恰好一格；沒有未知 id；分數是 1–10 的數字；`weights` 涵蓋所有準則且為非負；`evidence_claim_ids` 存在於 ledger（若提供 `--ledger`）；引用已 `conceded` 或 `likely_false` 的論點當證據要報錯；`speaker_id` 正確。
- 錯誤訊息要具體到「缺 `go|ops_simplicity`」「`c9` 不是準則 id」。
- 同時輸出「乾淨版 JSON」（`--write-clean <path>`），方便直接餵給 `analyze.mjs`。

**測試**（`validate.test.mjs`）：缺格、重複格、亂 id、分數 0/11/字串、權重缺失、被圍欄包住的 JSON、尾逗號/前後廢話、引用已讓步論點。每種至少一個測試。

**SKILL.md 修改**：Phase 7 改為「每份評分都用 `validate.mjs` 驗，失敗就把 `errors` 原文貼回同一個 subagent 要求重做，最多 2 次」。

**驗收**：測試全過；用基線的 `input.json` 跑 `validate`，回報結果；刻意弄壞一份再驗，錯誤訊息清楚。

---

## WP2 — 論點與逐字稿記帳 `scripts/ledger.mjs`

**問題**：實戰中出現 `#vex-1`、`#cto-1` 等不存在的編號、索引裡有無效 `kind: concession`、把辯手的「翻盤條件」當成論點、transcript 缺主席指令。這些全是 agent 手動記帳出的錯。

**設計**：每場辯論一個 `state.json`（放在 `senate-runs/<run>/`），**所有發言與主席指令都存進去**，由腳本負責：
- 解析辯手發言末尾的 ```` ```claims ```` 區塊 → 驗證 → 寫入論點。
- 指派/驗證編號、維護狀態（`open`→`attacked`→`conceded`/`disputed_fact`/`plausible`）。
- 產生「論點索引」文字（給下一位辯手 prompt 用）與完整 `transcript.md`。
- 計分板（命中攻擊、讓步、謬誤、查核旗標）與 MVP 候選排序。

**CLI**
```
node ledger.mjs init   <state.json> --question "…" --brief <brief.json>
node ledger.mjs turn   <state.json> --speaker cto --kind opening|rebuttal|steelman|closing --round N --file <turn.md>
node ledger.mjs chair  <state.json> --kind opening|directive|pre_steelman|pre_closing|verdict --round N --file <chair.md>
node ledger.mjs facts  <state.json> --file <checks.json>        # 查核員輸出
node ledger.mjs fallacies <state.json> --file <fallacies.json>   # 主席點名的謬誤
node ledger.mjs index  <state.json>                              # 印出論點索引（含狀態徽章）給 prompt 用
node ledger.mjs scoreboard <state.json>
node ledger.mjs transcript <state.json> --out <transcript.md>
```
**規則（必須實作並測試）**
- 編號 `前綴.序號`，序號由腳本依序指派，**辯手回傳的 id 以腳本為準**；重新編號時同步改寫該發言中的引用 `【對手 #cto.3】`（若 id 對不上則報錯，列出所有有效 id）。
- `kind` 僅限 fact/estimate/value/prediction/proposal；不合法 → 報錯並指出哪個論點。
- `attacks`/`concedes` 指向不存在的編號 → 報錯。
- 偵測發言內文中的 `【讓步 #id】`，與 claims 區塊的 `concedes` 取聯集。
- 發言內文引用的 `#id` 不存在 → 警告（結辯/評分階段的自創編號要抓出來）。
- 逐字稿必須保留：決策簡報、主席開場白、**每輪主席指令全文**、每則發言（依序）、每輪查核結果、論點索引表。
- 狀態推導：被攻擊→`attacked`；原作者讓步→`conceded`（最高優先）；查核 `likely_false`→`disputed_fact`；`questionable` 只加徽章。
- MVP 候選分數：命中攻擊×3 + 讓步×1 − 謬誤×2 − 查核旗標×2（「命中攻擊」= 其攻擊的目標後來被讓步或被判 likely_false）。
- 輸出的 `transcript.md` 與 `index` 文字是確定性的（同一 state 永遠同樣輸出）。

**測試**（`ledger.test.mjs`）：完整模擬一場假辯論（3 辯手、2 輪），斷言編號、狀態遷移、transcript 含主席指令、計分板；各種錯誤輸入的錯誤訊息；重複執行同一指令的冪等性（或明確拒絕重複）。

**SKILL.md 修改**：每個 Phase 改成「把 subagent 回傳**原文**存成檔 → 呼叫 `ledger.mjs turn`（失敗就把錯誤貼回去要求重寫）→ 用 `ledger.mjs index` 取得索引再派下一位」。主 agent 不再手寫論點索引與 transcript。

**驗收**：測試全過；用基線 transcript 反向轉成 state（可手寫轉換腳本，放 `evals/`），確認腳本能抓出基線中的 `#vex-1` 類錯誤。

---

## WP3 — 報告組裝 `scripts/report.mjs`

**問題**：報告中的矩陣表、勝率、翻盤點、人格視角是 agent 手抄的，容易抄錯；且混用了 `persona_own_view` 與 `persona_lens`。

**設計**：`report.mjs` 讀 `analysis.json` + `state.json` + `extras`（判決、權衡、盲點…）產出 `report.md`，**所有數字與表格由程式生成**；agent 只提供文字欄位（一句話結論、建議、權衡描述等），腳本把它們嵌進固定骨架。
- 矩陣表：準則/權重/各方案分數/加權總分。
- 穩健度：勝率、翻盤點（改寫成自然語句）、最大後悔。
- **人格視角分兩張表並標題清楚**：「用他的權重看主席的分數」與「他自己的分數」，各自說明意義。
- 辯論精華：各辯手最終立場（取自結辯）、讓步紀錄、謬誤、查核旗標（取自 ledger）、高光、MVP。
- 稽核紀錄。
- 每個「判決文字中的數字」要與 `analysis.json` 一致（交給 WP4 查）。

**測試**：快照測試（固定輸入 → 固定輸出）；缺欄位時的優雅降級；包含特殊字元（`|`、反引號、換行）的文字不破壞 Markdown 表格。

**SKILL.md 修改**：Phase 11 改為「補齊 extras → 呼叫 `report.mjs`」，agent 不再手寫整份報告。

**驗收**：用基線資料產生的報告與手寫版對照，數字完全一致；兩張人格視角表結論正確。

---

## WP4 — 程式稽核 `scripts/audit.mjs`

**問題**：LLM 稽核員回報 0 問題，但實際存在 quote 拼接、不存在的編號。

**規格**：`node audit.mjs <run-dir>` 做**確定性**檢查，輸出 `{passed, issues:[{severity, location, problem, fix}]}`：
1. 高光 quote 必須是 transcript 內的**連續子字串**（先做空白與全形/半形標點正規化再比，但不容許省略/拼接）。
2. 所有 `evidence_claim_ids`、判決文字、報告引用的編號都存在於 ledger。
3. 評審/辯手的 cell 引用已 `conceded` 或 `likely_false` 論點當證據 → 報錯。
4. 判決與報告文字中出現的百分比、總分、閾值，必須與 `analysis.json` 一致（抽取數字比對，容許四捨五入差）。
5. `recommended_option_id === analysis.winner`。
6. 信心標籤與勝率對應（≥75% 高、50–75% 中、<50% 低）。
7. 勝率非最高的贏家、或 `margin < 0.1` 時，報告必須含「過於接近」字樣。
8. transcript 含主席開場與每輪指令；交叉質詢輪數 ≥ 2。
9. 每位辯手的結辯有明確最終立場。

**流程**：先跑 `audit.mjs`，再派 LLM 稽核員處理**程式查不到的**語意問題（rationale 是否真的被證據支持、未解爭議是否真的未解）。**LLM 稽核員的 prompt 要改成「已知程式稽核結果如下，你只負責語意層面」**。

**測試**：每條規則一個通過案例與一個失敗案例；用基線資料驗證能抓到 quote 拼接（若基線 quote 確實是拼接的）。

**驗收**：測試全過；對基線跑 audit，列出它抓到的問題。

---

## WP5 — 統計校準

**問題**：基線勝率 100%/0%。三位評審分數幾乎一致時 cell spread≈0，被下限 0.3 撐住，Monte Carlo 因此極端；而「100%」會誤導使用者。

**做法（逐項評估，每項寫入 DEV_LOG 決策與理由）**
1. **評審數量由 3 提高到 5**（token 不設限）。`analyze.mjs` 對 N 不設死，但文件與 SKILL.md 要改。
2. **Bootstrap 評審**：Monte Carlo 每次迭代從評審樣本中**有放回抽樣**一組再取中位數，反映「換一批評審會怎樣」的不確定性。
3. 調整 spread 下限（建議 0.5，並用模擬資料比較 0.3/0.5/0.8 的行為，記錄選擇理由）。
4. 勝率文字改成誠實措辭：「在評審意見與權重不確定的前提下，Go 勝出的比例」，並在報告與網頁註明**這不是現實世界的成功機率**。
5. 當評審間 inter-judge 一致性極高（平均 spread 很小）時，報告自動加註「評審高度一致，勝率可能低估不確定性」。
6. 新增 `analysis.diagnostics`：`judge_agreement`（Krippendorff α 或簡單的平均標準差）、`effective_samples`。

**測試**：評審一致 vs 分歧兩組資料，斷言勝率行為（分歧大時勝率更分散）；seed 可重現；bootstrap 不改變中位數聚合結果。

**驗收**：用基線輸入重算，勝率不再是 100%/0%（除非資料確實極端，要在 DEV_LOG 說明）；所有舊測試仍過；新增測試通過。

---

## WP6 — 辯論品質工程

**目標**：辯手不崩人格、不客套、不一面倒投降、主席問題尖銳。

**做法**
1. 先建立**品質量表**（`references/quality-rubric.md`）：每項 0–2 分——開場是否選邊且有數字、反駁是否正確引用、讓步是否具體、結辯是否有明確立場、主席問題是否可用數字回答、人格是否一致、是否出現客套話、新論點比例、查核旗標比例。
2. 寫一個**程式化的量表計算**（`scripts/quality.mjs <state.json>`）：能自動算的盡量自動算（引用格式合規率、重複論點偵測用簡易 n-gram 相似度、立場變化次數、讓步數、客套詞命中如「您說得有道理」「我同意」、主席問題是否含數字/具名技術）。
3. **跑至少 6 場真實辯論**（見 WP7 題庫），每場跑完用量表評分，記錄在 `evals/quality-<日期>.md`。
4. 針對低分項調 `references/prompts.md` 與 `personas/*.md`，改完**重跑同一題**驗證分數是否上升。至少迭代 3 輪，每輪記錄「改了什麼、分數變化」。
5. 特別處理**情境一面倒**時辯手投降的問題：基線中 Vex 連讓兩步後把「現有情境」當翻盤條件。可考慮：
   - 主席指令加入「立場鎖定」欄位：辯手改變立場必須引用具體論點編號；
   - 辯手模板加入「你的讓步不得多於 N 個，除非有新證據」的軟性規則；
   - 在盲點獵人之外，加一位**「反方總結員」**（Red Team）：辯論結束後，專門為「落敗方案」寫最強的一頁辯護，放進報告，避免使用者只看到贏家敘事。
6. 評估**加入第 4 位預設辯手**（例如「資安官」或「產品PM」）對品質的影響，用量表比較 3 人 vs 4 人。

**驗收**：量表有程式化版本且有測試；至少 6 場實跑記錄；至少 3 輪調校紀錄顯示分數改善；最終平均分與各項分數寫進 `HANDOFF.md`。

---

## WP7 — 題型覆蓋

用以下題庫實跑（也存成 `evals/questions.yaml`，每題含 `question`、`context`、`type`、`expected_traits`）。**至少涵蓋這 3 種題型**，每種跑 2 題以上：

| 題型 | 題目 |
|---|---|
| 二選一 | 3 人新創 B2B SaaS 後端：Go 還是 Rust？（基線，已有）；消費型 App 4 人團隊：Flutter 還是 React Native？ |
| 要不要做（yes/no） | 既有 Django 單體（20 萬行、8 人、部署 40 分鐘）要不要拆微服務？ |
| 多選項（3–5） | 內部報表系統（每日 200 萬筆事件、延遲容忍 1 小時）：Kafka+Flink、cron+PostgreSQL、還是 ClickHouse？；IoT 閘道器（ARM、256MB RAM、OTA）：Rust、Go 還是 C？ |
| 情境不明/需追問 | 「我們該不該用 AI 做客服？」（資訊極少，測試 Phase 0 追問與預設假設） |
| 含個資/合規 | 客服摘要（日 5 萬次、含個資）：自架開源 LLM 還是雲端 API？（測試資安官與合規盲點） |

**每種題型要檢查**
- 「要不要做」型：選項是否包含「不做/維持現狀/漸進」。
- 多選項：辯手立場分佈是否合理、矩陣欄數 3–5 時網頁是否正常。
- 情境不明：主席是否只在**真的必要**時追問、預設假設是否寫明、結論是否隨假設標註條件。
- 全部：流程是否跑滿（≥2 輪）、`validate`/`ledger`/`audit` 是否全綠。

**驗收**：`evals/` 內每場有完整輸出資料夾；`DEV_LOG.md` 彙整每場的問題與修正；SKILL.md 針對各題型的框定規則補強。

---

## WP8 — 結果頁升級（`matrix.template.html`）

目標：`matrix.html` 變成**單檔、離線、可直接分享的完整成品**。

1. **辯論重播分頁**：把每一則發言（含主席指令）嵌進頁面，提供「▶ 播放」逐字打字動畫、速度調整、暫停、跳到下一發言；引用的 `【對手 #id】` 渲染成可點擊的引用卡，點了高亮該論點。讓使用者在 HTML 裡就能重溫「實境秀」。
2. **論點圖分頁**：依辯手分組列出論點、狀態徽章（被攻擊 ×n、已讓步、⚠️存疑、❌可能錯誤、✅合理），點論點高亮其攻擊/被攻擊關係；選配：SVG 有向圖。
3. **計分板與立場時間線**：各辯手的立場隨輪次變化（色塊序列），讓步次數、命中攻擊。
4. **逐字稿分頁**：可搜尋。
5. 匯出：把「目前滑桿權重」與結果下載成 JSON / Markdown；列印友善樣式。
6. **反方總結員（WP6.5）的「落敗方案最強辯護」卡片**。
7. 勝率區塊加上 WP5 的誠實說明與 diagnostics。
8. 行動裝置（390px）無水平捲軸；明暗主題；鍵盤可操作；`prefers-reduced-motion` 時關閉動畫。
9. 資料量大時（20+ 則發言）載入仍流暢。

**嚴守**：所有文字用 `textContent`；`</script>` 與 `<` 跳脫保持（見 HANDOFF §5）；不引入外部 CDN 或函式庫（要用 markdown 渲染就自己寫極簡版或不渲染）。

**驗證方式**：用本機 `python -m http.server` 開頁（瀏覽器預覽工具打不開 `file://`），實際點過每個分頁；寫一個 Node 腳本（不依賴瀏覽器）驗證嵌入的 JSON 可解析、無 `</script>` 洩漏、XSS 字串（`<img onerror>`）不會執行；在 `DEV_LOG` 附上手動檢查清單與結果。

**驗收**：用 WP7 的真實輸出重新產生頁面，所有分頁可用，390px 與 1100px 都無版面破壞。

---

## WP9 — 評測：辯論 vs 單一模型

**目的**：用證據回答「這個插件到底有沒有比直接問一次強？」

1. 對 WP7 題庫的每一題：
   - **Baseline**：同一個模型單次回答「請分析這個技術決策並給建議」（提示詞固定寫在 `evals/baseline-prompt.md`）。
   - **Senate**：完整辯論產出的 `report.md`。
2. **盲評**：派一個全新的評審 subagent，兩份報告**隨機標 A/B**，各給 1–10 分：具體性（數字/量級/具名技術）、考量廣度、盲點揭露、可行動性（有無可執行的驗證實驗）、誠實度（承認不確定/給翻盤條件）、情境貼合度。每題**盲評 3 次、位置互換各一次**以抵銷位置偏差。
3. 彙整到 `evals/summary.md`：每題雙方分數、平均、勝負、評審理由摘要。
4. 如果 Senate **沒有**平均勝出，這是重要發現：回頭分析原因並在 `DEV_LOG` 記錄，不要美化。

**驗收**：`evals/summary.md` 存在，含全部題目與位置互換的盲評；結論誠實。

---

## WP10 — 發佈與收尾

1. `package.json` 版本升為 `0.3.0`（若改動夠大可 `0.4.0`），新增 `CHANGELOG.md`。
2. README 更新：新功能、新腳本、結果截圖（用瀏覽器預覽工具截圖放 `docs/`，注意檔案大小）、已知限制。
3. 更新 `HANDOFF.md`：新增腳本說明、驗證狀態、品質量表結果、評測結論；刪除已解決的「待觀察」項目。
4. 全面回歸：`npm test` 全過；用最新版跑 2 場全新題目的完整辯論，確認 `validate`/`ledger`/`audit` 全綠。
5. **向使用者回報並詢問是否推送**。推送後，指引使用者在 DSH 市集更新（或重裝 `github:Aben0515/agent_debate`）並實測。

---

## 3. 通用工作規範

- **一個工作包一個（或數個）commit**，訊息中文，格式「類型: 摘要」+ 條列說明，結尾 `Co-Authored-By:` 行標註協作 AI。
- **`DEV_LOG.md`**：每個工作包一節，包含：日期、做了什麼、**證據**（指令輸出、測試結果、產出檔案路徑）、遇到的問題與決策。誠實記錄失敗與放棄的做法。
- **測試**：新腳本都要有 `*.test.mjs`；`package.json` 的 `test` 指令改成 `node --test skills/agent-senate/scripts/*.test.mjs`。
- **向後相容**：`analyze.mjs` 的 input.json 格式若有變動，要同時更新 `examples/sample-input.json`、SKILL.md 的格式說明，並保留舊格式的讀取（或明確報錯）。
- **示範資料**：`examples/sample-input.json` 沒有產生腳本，要改請直接編輯 JSON；改完重新產生 `sample-matrix.html`（指令見 HANDOFF §10）。
- **預覽用的本機伺服器用完要關**。
- 遇到規格模糊處：選保守做法，在 `DEV_LOG.md` 記錄決定；與使用者利益衝突或會動到公開發佈（push）的事，**停下來問使用者**。

## 4. 完成定義（Definition of Done）

- [ ] WP0–WP10 全部完成，`npm test` 全過（新增測試數量遠多於現在的 11 個）。
- [ ] 至少 6 場真實辯論（含 3 種以上題型）完整跑通，輸出保存於 `evals/`。
- [ ] `validate` / `ledger` / `audit` 對所有實跑輸出皆為綠燈；基線中出現過的錯誤（不存在編號、transcript 缺主席指令、quote 拼接、只跑 1 輪、人格視角混用）全部被腳本抓到或根本不會再發生。
- [ ] 勝率不再無條件 100%/0%，且文字措辭誠實。
- [ ] `evals/summary.md` 的盲評結論已誠實記錄。
- [ ] `matrix.html` 含辯論重播、論點圖、計分板、逐字稿，行動裝置可用。
- [ ] `HANDOFF.md`、`README.md`、`CHANGELOG.md`、`DEV_LOG.md` 都已更新。
- [ ] 已向使用者回報，**並由使用者決定是否推送**。
