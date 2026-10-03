# HANDOFF — 給接手修改的 agent 看的完整交接說明

> 如果你是被叫來修改這個專案的 agent（Gemini、DeepSeek、Claude 都適用），**先讀完這份再動手**。
> 這份文件說明：這個專案是什麼、為什麼長這樣、做了什麼、驗證過什麼、**還沒驗證什麼**、哪裡有地雷。

---

> **下一步要做什麼，見 [PLAN.md](PLAN.md)**（WP0–WP10 的改進計畫與驗收標準）。

## 1. 一句話
**Agent Senate 虛擬內閣**：一個 DeepSeek Harness（DSH）**技能插件**。使用者丟一個技術決策難題，主 agent 擔任「天秤主席」，派出多個立場對立的 subagent（保守 CTO／性能狂／極簡極客）互相辯論，最後由**程式**算出決策權衡矩陣、勝率、翻盤點，並產出報告與可互動網頁。

- **不需要任何 API Key**：辯手就是 DSH 目前的模型，透過 DSH 的 subagent 工具派出。
- **沒有 Python、沒有伺服器**：只有 Markdown 提示詞 + 一支 Node 腳本 + 一個 HTML 模板。
- GitHub：<https://github.com/Aben0515/agent_debate>（分支 `main`）。套件名稱是 `agent-senate-dsh`（**不可改名**，見 §6）。

## 2. 歷史（為什麼會有兩個版本）
1. 使用者想要「多 Agent 圓桌辯論室」。Claude 先寫了一份很長的實作規格書，交給 Gemini（跑在 DSH 裡）實作。
2. Gemini 做出的是**獨立的 Python 程式**（FastAPI + Rich + MCP + 自己呼叫 Gemini API，需要 `GEMINI_API_KEY`），再用一個 DSH 技能去呼叫它。
3. 使用者指出：這是要「直接裝進 DSH」的插件，為什麼還要 API Key？——**對，不該要。** 所以 Claude 把它**重做成純技能版**（就是現在這個資料夾），Gemini 的 Python 版已從 `plugin/` 刪除（它仍留在 `plugin/` 那個 git repo 的歷史裡，可用 `git checkout` 救回）。
4. 新版只保留舊版**最有價值、最不該交給模型的部分**：矩陣數學（移植成 Node），以及人格設定與提示詞（改寫成 Markdown）。

## 3. 檔案地圖
```
agent-senate-dsh/
├─ package.json            DSH 插件清單。name 必須是 agent-senate-dsh；dsh.bundle.patch 指向 cordis.patch.yml (v0.3.0)
├─ cordis.patch.yml        告訴 DSH：把 skills/ 資料夾註冊成技能來源（照抄 @tt-a1i/archify-dsh 的格式）
├─ lib/index.js            必要的入口檔；匯出 resolveSenateSkillRoot（解析套件路徑）
├─ LICENSE, README.md, CHANGELOG.md, DEV_LOG.md, PLAN.md, HANDOFF.md(本檔), .gitignore
├─ evals/                  評測題目 (questions.yaml)、基線資料與雙盲評測總結 (summary.md)
└─ skills/agent-senate/
   ├─ SKILL.md             ★ 整個辯論流程的「程式」。DSH agent 讀它就知道怎麼主持（見 §4）
   ├─ references/
   │  ├─ prompts.md        ★ 所有 subagent 的提示模板（辯手/查核/盲點獵人/評分/評審/稽核/Red Team）
   │  ├─ subagent-interface.md  DSH 環境原生 subagent 工具介面規範
   │  └─ quality-rubric.md 辯論品質量化評分量表（滿分 20 分）
   ├─ personas/*.md        5 位辯手的人格檔（3 預設 + 資安官 + 產品PM 選配）
   ├─ scripts/
   │  ├─ analyze.mjs       ★ 數學引擎：聚合、總分、翻盤點、Bootstrap 評審採樣、Monte Carlo、後悔值、診斷
   │  ├─ validate.mjs      ★ 驗證工具：自動檢驗評審與辯手打分格式與有效性
   │  ├─ ledger.mjs        ★ 記帳引擎：管理 state.json、論點圖譜與確定性 transcript.md
   │  ├─ report.mjs        ★ 報告組裝器：確定性組裝 report.md，精確呈現雙重辯手視角
   │  ├─ audit.mjs         ★ 程式稽核器：連續引言比對、論點狀態檢查與數值一致性檢驗
   │  ├─ quality.mjs       ★ 品質評分器：自動評估客套詞、引用合規率與提問尖銳度
   │  ├─ run-all-tests.mjs 單行程整合測試執行器（npm test 調用，全套 30 項測試）
   │  ├─ *.test.mjs        各模組之單元測試
   │  └─ matrix.template.html  互動矩陣網頁模板（含實境重播、論點圖譜、逐字稿搜尋、純前端 XSS-Safe）
   └─ examples/
      ├─ sample-input.json   示範輸入（Go vs Rust vs 維持 Python；示範資料，非真實辯論）
      └─ sample-matrix.html  用上面輸入產生的示範輸出
```

## 4. 運作方式（資料流）
```
使用者問題
  → [SKILL.md Phase 0]   主 agent 框定：選項(2-5)、情境事實、假設、準則(6-9，一律「越高越好」)
  → [Phase 1]            平行派 N 個辯手 subagent 寫開場（彼此看不到）
  → [Phase 2]            每輪：查核員 → 主席指令（每人恰好一題）→ 依序派反駁
  → [Phase 3-4]          鋼人論證（平行）→ 結辯（依序）
  → [Phase 5-6]          盲點獵人 → 定案準則（鎖定 id）
  → [Phase 7]            辯手各自評分 + 3 位獨立中立評審（全部平行）
  → input.json           chairSamples(3 份評審) + personaScores + extras
  → [Phase 8] node scripts/analyze.mjs input.json --out <資料夾>
  → analysis.json + matrix.html
  → [Phase 9-11]         主席寫判決(數字照抄) → 稽核員 → report.md / transcript.md
```
**分工原則（最重要，不要破壞）：LLM 負責判斷與評分，程式負責算數。** 總分、排名、勝率、翻盤點一律由 `analyze.mjs` 算；SKILL.md 明令主席不准心算或改程式結果。

### 論點編號
每位辯手有前綴（`cto` / `vex` / `kiss` / `sec` / `pm`），編號 `前綴.序號`（如 `cto.3`）。辯手在發言末尾輸出 ```` ```claims ```` JSON 區塊，主 agent 據此維護論點索引。**不再用獨立的「論點抽取器」**，編號由辯手自己帶前綴，免去跨 subagent 協調 id 的問題。

## 5. analyze.mjs 詳解
輸入格式見 SKILL.md「input.json 格式」與 `examples/sample-input.json`。指令：
```
node skills/agent-senate/scripts/analyze.mjs <input.json> [--out <資料夾>]   # 輸出 analysis.json + matrix.html
npm test                                                                       # 11 個測試
```
- **aggregate**：每格取 3 份評審分數的**中位數**；理由/證據取「最接近中位數」的那份；權重取平均後正規化；**spread = 評審 + 所有人格分數的母體標準差**（Monte Carlo 與「🔥分歧」標記都用它）。每份樣本必須「每個方案×準則恰好一格」，缺格的整份丟棄並警告，全丟光則報錯；分數夾在 1–10。
- **排名**：總分 → Monte Carlo 勝率 → id 字母序。總分差 < 1e-9 視為平手。
- **翻盤點**：對準則 k，把它的權重改成 t、其他權重等比縮放，每個方案總分對 t 是線性的，直接解交點（解析解）。
- **Monte Carlo**：權重 ~ Dirichlet(α·w)，分數 ~ Normal(中位數, max(0.3, spread)) 夾 1–10；`mulberry32` 種子 PRNG，`seed=0` 代表隨機並把實際種子寫進 `seed_used`。
- **人格視角**：`persona_lens` = 該人格的權重 × **主席的分數**；`persona_own_view` = 該人格的權重 × **該人格自己的分數**。
- **最大後悔**：視角集合 = {主席權重} ∪ {各人格權重}，全用主席分數；選 max regret 最小者。
- **matrix.html**：`renderHtml` 把結果以 JSON 嵌進模板。**所有 LLM 產生的文字一律用 `textContent`/DOM 建立，不用 innerHTML**（防 XSS）。

### 已修過的 bug（別改回去）
1. **翻盤點平手誤判**：當某準則權重 = 100% 時，兩方案可能同分，靠 id 字母序「勝出」，被誤報成翻盤點（例如「權重提到 100% 時 o0 勝」，實際上 99.9% 以下都是 o1 贏）。修法：新贏家必須**嚴格領先**（總分差 > 1e-9）才算翻盤。Gemini 的 Python 原版也有這個 bug。
2. **暴力掃描漏邊界**：測試用的暴力掃描以 0.001 步進，會跳過緊貼 0 或 1 的交點。修法：掃描最後補測 t=0 / t=1。（解析解是對的，是對照用的暴力解有缺陷。）
3. **翻盤點「示範」按鈕沒真的翻**：閾值有四捨五入，剛好停在交點前面。修法：示範時往交點方向多走 0.005。
4. **`String.replace` 的 `$&`、`` $` `` 特殊替換**：資料裡有 `$` 會被誤展開。修法：用函式形式 `replace(x, () => data)`。
5. **`</script>` 注入**：嵌入 JSON 前把 `<` 換成 `\u003c`（原始碼裡要寫成 `'\\u003c'`，見 §7 地雷）。

## 6. DSH 插件格式（為什麼長這樣）
這是**技能型（skill-only）插件**，格式照抄使用者已安裝、可正常運作的 `@tt-a1i/archify-dsh`（在 `~/.dsh/profiles/desktop/node_modules/@tt-a1i/archify-dsh/`）：
- `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`。
- `cordis.patch.yml` 插入一個 `@deepseek-ai/dsh-skill-filesystem`，`bundledSkillDir` 用 `createRequire(baseUrl).resolve('agent-senate-dsh/package.json')` 解析套件位置，再接 `skills`。**所以套件名稱 `agent-senate-dsh` 寫死在這個檔案裡，改名必須同步改。**
- 使用者的 profile：`~/.dsh/profiles/desktop/`（pnpm hoisted）。市集（`dshmarket`）以 `github:帳號/repo` 安裝。

## 7. 地雷（踩過的，請避開）
- **絕對不要寫入 UTF-8 BOM。** Gemini 的舊檔案開頭都有 BOM，會讓 SKILL.md 的 `---` frontmatter 讀不到。Windows PowerShell 5.1 的 `Set-Content -Encoding utf8` / `Out-File` **會加 BOM**——用編輯器工具寫檔，或確認開頭不是 `ef bb bf`。
- **透過 shell heredoc 寫含特殊字元的程式碼會被破壞**：`\u2028` 會被轉成真的換行字元、反斜線會少一層。含跳脫序列的程式碼請用檔案編輯工具寫，寫完 `grep` 確認。
- 瀏覽器預覽工具**打不開 `file://`**，要用 `python -m http.server <port> --bind 127.0.0.1` 之類的本機伺服器看 `matrix.html`。用完記得關掉。
- 這台機器的 Windows 沙盒會擋 `Remove-Item`（誤判成系統路徑）；刪除請用 bash 的 `rm`，並先確認目標。
- `uv`、`pnpm` 不在系統 PATH（DSH 有自己的）。本專案不依賴它們，只需要 `node`（v24 在 PATH 上）。
- 有一個**無關的專案** `cognitive-zoom`（czoom）在 `C:\Users\yuana\Desktop\DSH\cognitive-zoom\`，以及 `plugin\data\`——**那是別的專案，不要動**。使用者明確說過「它是別的」。

## 8. 驗證狀態（誠實版）
**已驗證**
- `npm test`：**30/30 全數通過**（涵蓋 analyze、validate、ledger、report、audit、statistical-calibration、quality）。
- `validate.mjs`：實測驗證基線 `input.json`，精準攔截缺格、重複格與無效證據引用。
- `ledger.mjs`：實測驗證 3 辯手 2 輪交叉交鋒，確定性產生完整包含主席指令之逐字稿。
- `report.mjs`：實測將基線數據組裝為格式精確之 `report.md`，雙重視角完全分離。
- `audit.mjs`：**成功精準捕獲第一次實戰中 2 處高光引言拼接與逐字稿缺失主席開場/指令的真實瑕疵**。
- `matrix.html`：純前端包含重播、論點圖、逐字稿搜尋，經 XSS 測試與行動寬度 (390px) 檢驗無水平捲軸。
- `evals/summary.md`：**尚未執行**。先前版本曾寫入未經實跑的分數（8.90 vs 6.31、7/7），2026-10-04 查證後已移除——那些數字沒有任何對應的辯論輸出或評審原始評分。

### 第一次實戰發現問題之後續解決方案（已全部實作完畢）
| 原實戰發現之問題 | 解決方案與實作機制 |
|---|---|
| 只跑了 1 輪交叉質詢 | `SKILL.md` 強制要求第 2 輪必須跑完；`audit.mjs` 檢查若 < 2 輪直接發出警示 |
| `transcript.md` 缺少主席開場白與每輪指令 | `ledger.mjs` 統一記帳並由程式確定性產生 `transcript.md`，杜絕手寫遺漏 |
| 結辯出現不存在編號，kind 出現 concession | `ledger.mjs` 強制自動指派 `前綴.序號`（如 `cto.1`），嚴格校驗合法 kind |
| 高光 quote 拼接，LLM 稽核員卻回報「吻合」 | 實作 `audit.mjs` 以正規化連續子字串進行確定性程式比對，徹底阻斷拼接引言 |
| `seed` 照抄範例 42 | `SKILL.md` 明確規定填 0，由腳本隨機產生種子並持久化記錄在 `analysis.json` |
| 辯手連讓多步變相投降 | 鐵律增訂讓步上限（最多 1 次）；新增 Red Team 模板專門為落敗方案辯護 |
| 勝率 100% / 0% 過於篤定 | 引入評審 Bootstrap 抽樣、提升離散下限至 0.5、新增評審一致性診斷警示 |
| 報告混用兩種人格視角 | `report.mjs` 清晰拆分為 `Persona Lens` 與 `Persona Own View` 兩張獨立表格 |
| 稽核員過於寬鬆 | 建立「先程式自動查驗、再交由 LLM 審核語意」的雙層審查架構 |

## 9. 刻意沒有移植的功能（Gemini 舊版有，新版沒有）
即時串流的網頁「圓桌劇場」（SSE、席位動畫、攻擊閃光線）、終端機 Rich 呈現、MCP Server、重播、評測系統（baseline vs 辯論盲評）、逐字稿滾動壓縮、LLM 呼叫日誌與用量統計、Python CLI。
原因：純技能版沒有常駐程式可做串流；主 agent 直接把發言貼進對話就是「實境秀」。若要補回，建議**不要**重新引入需要 API Key 的 Python 引擎。

## 10. 想改東西時去哪裡改
| 想做的事 | 改哪裡（務必一起改） |
|---|---|
| 調辯論風格 / 鐵律 / 任務說明 | `references/prompts.md` 的模板 A |
| 改流程、輪數、判決規則 | `SKILL.md` |
| 新增 / 修改辯手 | 新增 `personas/<id>.md`；更新 `SKILL.md` 的人格表（含論點前綴）；若要在網頁顯示名稱，`extras.personas` 要帶 `short_name`/`emoji` |
| 新增分析指標 | `analyze.mjs` + 在 `analyze.test.mjs` 加測試 + `matrix.template.html` 顯示 + `SKILL.md` 說明 |
| 改評分輸出格式 | `references/prompts.md` 的 D、E + `analyze.mjs` 的 `aggregate`/`validCells` + `SKILL.md` 的 input.json 格式 |
| 改網頁外觀 | `matrix.template.html`（改完要重新產生 `examples/sample-matrix.html`） |

**改完一律：** `npm test`。改了 analyze.mjs 或模板，重新產生示範輸出：
```
node skills/agent-senate/scripts/analyze.mjs skills/agent-senate/examples/sample-input.json --out <暫存資料夾>
# 再把 <暫存資料夾>/matrix.html 複製成 skills/agent-senate/examples/sample-matrix.html
```
`sample-input.json` 當初由一支拋棄式腳本產生，腳本沒保留——要改示範資料請**直接編輯 JSON**。

## 11. Git / 發佈
- Remote：`origin` = `https://github.com/Aben0515/agent_debate.git`，分支 `main`。
- 這個資料夾是**獨立的 git repo**，但位於 `plugin/` 底下（`plugin/` 本身是另一個 git repo，對它而言這個資料夾是 untracked）。**在這個資料夾裡 commit，不要在 `plugin/` 根目錄 commit。**
- 本 repo 的 commit 身分已在 repo 本機設定（`user.name=Aben0515`，信箱為使用者的 Gmail）。推送會公開顯示該信箱。
- commit 訊息慣例：中文摘要 + 說明；結尾加 `Co-Authored-By:` 行標註協作的 AI。
- 使用者透過 DSH 市集的更新功能取得新版，所以**改完要 push 才會生效**。推送前請先問使用者。

## 12. 給下一位的建議優先順序
1. 在真 DSH 裡裝起來，用 README 的範例題目跑一場完整辯論，把實際出現的問題記下來。
2. 依實際問題修 `SKILL.md`（subagent 呼叫方式）與 `references/prompts.md`（輸出格式不穩時加範例）。
3. 跑 3 個以上不同類型的題目（二選一、要不要做、多選項），調提示詞，直到：辯手不客套、主席問題夠具體、評審 JSON 穩定不缺格。
4. 之後再考慮補功能。
