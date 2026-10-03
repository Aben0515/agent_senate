# 🏛️ Agent Senate 虛擬內閣 — DSH 技能插件

重大技術選型（「Go 還是 Rust？」「要不要拆微服務？」）不要只問單一模型。
這個技能讓 DeepSeek Harness（DSH）的 agent 擔任**天秤主席**，派出多個立場對立的 **subagent** 互相辯論，
最後用程式算出一份**決策權衡矩陣**：加權總分、勝率、翻盤臨界點，並產出報告與可互動網頁。

- **不需要任何 API Key**：辯手就是 DSH 目前使用的模型，透過 DSH 的 subagent 工具派出。
- **不用安裝 Python 或其他環境**：只需要 Node（DSH 本身就有）。
- **數學不由模型負責**：模型只負責評分與判斷；總分、排名、Monte Carlo 勝率、翻盤點全由 `analyze.mjs` 計算。

## 角色
| 角色 | 立場 |
|---|---|
| ⚖️ 天秤主席（主 agent） | 框定問題、點名謬誤、逼出具體數字、防止團體迷思、判決 |
| 🛡️ 鐵算盤・陳 CTO | 保守實用派：維運成本、招募難易、拒絕追風 |
| ⚡ 極速狂・Vex | 極致性能：p99、記憶體、吞吐、雲端帳單 |
| 🪓 剃刀・Occam | 極簡極客：能用 3 行 bash 或 SQLite 解決就不加框架 |
| 🔐 偏執資安官、💼 產品派 | 選配：要求加入資安或產品視角時才上場 |
| 幕後 | 事實查核員、盲點獵人、3 位獨立評審、紅隊總結員、稽核員 |

## 流程
框定問題 → 開場陳述（平行、互相看不到）→ 至少 2 輪交叉質詢（主席每輪逼問、查核、抓謬誤）→ 鋼人論證 →
結辯 → 盲點獵人 → 定案準則 → 辯手評分 + 3 位獨立評審 → **程式計算** → 紅隊反向警示 → 判決 → 稽核修復 → 報告。

一場完整辯論會派出約 25–35 個 subagent，需要幾分鐘。

## 安裝

> **請先完全關閉 DSH，再安裝、更新或移除插件。** 在 Windows 上，DSH 開著時會鎖住插件資料夾，
> 安裝或更新可能中途失敗，留下殘缺的安裝（開機時出現「profile 聲明了這些插件，但它們沒有安裝」）。

**從 GitHub（建議指定版本 tag）**：在 DSH 市集搜尋欄輸入

```
github:Aben0515/agent_senate#v0.3.0
```

指定 `#版本` 後，升級時市集走的是桌面版支援的「安裝」路徑。若不帶版本（`github:Aben0515/agent_senate`），
桌面版按「更新」會被拒絕並提示改到「設置 → 插件」操作（見 `dshmarket` 的 `official-desktop.ts`）。

**更新**：關閉 DSH → 在市集卸載 `agent-senate-dsh` → 以新版本 tag 重新安裝 → 重開 DSH。
可用版本見 [Tags](https://github.com/Aben0515/agent_senate/tags)。

**本機連結（開發用）**：把此資料夾以 `link:` 方式加入 DSH profile 的 `package.json` dependencies，
並在 `dsh.profile.bundles` 加入 `agent-senate-dsh`，重啟 DSH。

> 套件名稱 `agent-senate-dsh` 被寫死在 `cordis.patch.yml` 中，不可更改。
> 目前尚未發布到 npm，因此市集無法對它提供一鍵更新。

## 使用
直接對 DSH 說：
> 用虛擬內閣辯論一下：我們 3 人新創做 B2B SaaS 後端，一年內預計 500 家企業客戶，團隊熟 Python，該選 Go 還是 Rust？

可以加：「加入資安官」、「辯 3 輪」、「附上這個專案的 README 當情境」。情境給得越具體（團隊、流量、期限），辯論越有價值。

輸出在工作目錄的 `senate-runs/<日期>-<題目>/`：

| 檔案 | 內容 |
|---|---|
| `report.md` | 決策報告（數字與表格由程式帶入） |
| `transcript.md` | 完整逐字稿 |
| `matrix.html` | 可互動網頁：矩陣（拖權重、切人格視角、一鍵示範翻盤點）、辯論重播、論點圖譜、逐字稿 |
| `analysis.json` | 數學計算結果 |
| `input.json`、`state.json`、`brief.json` | 輸入、記帳本、問題框定 |

範例網頁：`skills/agent-senate/examples/sample-matrix.html`（示範資料，非真實辯論，因此重播／論點圖／逐字稿分頁是空的）。

## 腳本
本專案採「LLM 負責判斷與寫作，確定性腳本負責記帳與查核」。腳本都在 `skills/agent-senate/scripts/`：

| 腳本 | 功能 |
|---|---|
| `analyze.mjs` | 加權總分、翻盤點解析求解、評審 Bootstrap、Monte Carlo、產生 `matrix.html`（`--state` 注入發言與論點） |
| `validate.mjs` | 校驗評審與辯手打分 JSON（缺格、重複、越界、無效引用） |
| `ledger.mjs` | `state.json` 記帳本：指派論點編號、追蹤讓步與引用、輸出 `transcript.md` |
| `report.mjs` | 組裝 `report.md` |
| `audit.mjs` | 稽核：引言是否為原文連續子字串、已讓步論點是否被當證據、贏家與計算結果是否一致 |
| `quality.mjs` | 辯論品質量表（10 項指標，滿分 20） |

```bash
npm test    # 32 項測試，含實際執行每支 CLI
node skills/agent-senate/scripts/analyze.mjs skills/agent-senate/examples/sample-input.json --out ./out
```

接手修改前請先讀 [HANDOFF.md](HANDOFF.md)（架構、已知地雷、改東西去哪改）與 [PLAN.md](PLAN.md)。版本變更見 [CHANGELOG.md](CHANGELOG.md)。

## 驗證狀態（誠實說明）
- 單元與整合測試 32 項通過（`npm test`）。
- 真實 DSH 辯論只跑過 **1 場**（`evals/baseline-go-vs-rust/`，舊版流程、只有 1 輪質詢）。
  v0.3.0 的完整流程（ledger → validate → analyze → audit → report）尚未在真實 DSH 中完整實跑。
- **沒有「辯論 vs 單一模型」的評測數據。** `evals/runs/` 是腳本產生的測試夾具，不是真實評測，不可引用其分數
  （見 `evals/summary.md`）。

## 已知限制
- 辯論品質取決於 DSH 目前的模型；所有角色用同一個模型時，多樣性來自人格提示與獨立 subagent，不如多家模型。
- 事實查核員沒有網路，只依穩定的公認知識判斷，不確定時標為 `unverifiable`。
- 勝率是依模型評分模擬出來的，反映的是「評分的不確定性」，不是現實世界成功的機率。

## 授權
MIT
