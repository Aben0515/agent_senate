# 🏛️ Agent Senate 虛擬內閣 — DSH 技能插件

重大技術選型（「Go 還是 Rust？」「要不要拆微服務？」）不要只問單一模型。
這個技能讓 DSH 的 agent 擔任**天秤主席**，派出多個立場極端對立的 **subagent** 互相辯論，
最後用程式算出一份**決策權衡矩陣**：加權總分、勝率、翻盤臨界點，並產出報告與可互動網頁。

- **不需要任何 API Key**：辯手就是 DSH 目前使用的模型，透過 DSH 的 subagent 工具派出。
- **不用額外安裝 Python 或其他環境**：只需要 Node（DSH 本身就有）。
- **數學不由模型負責**：模型只負責評分與判斷；總分、排名、Monte Carlo 勝率、翻盤點全由 `analyze.mjs` 計算。

## 角色
| 角色 | 立場 |
|---|---|
| ⚖️ 天秤主席（主 agent） | 框定問題、點名謬誤、逼出具體數字、防止團體迷思、判決 |
| 🛡️ 鐵算盤・陳 CTO | 保守實用派：維運成本、招募難易、拒絕追風 |
| ⚡ 極速狂・Vex | 極致性能：p99、記憶體、吞吐、雲端帳單 |
| 🪓 剃刀・Occam | 極簡極客：能用 3 行 bash 或 SQLite 解決就不加框架 |
| 🔐 偏執資安官、💼 產品派 | 選配：要求加入資安或產品視角時才上場 |
| 幕後 | 事實查核員、盲點獵人、3 位獨立評審、稽核員 |

## 流程
框定問題 → 開場陳述（平行、互相看不到）→ 2–3 輪交叉質詢（主席每輪逼問、查核、抓謬誤）→ 鋼人論證 →
結辯 → 盲點獵人 → 定案準則 → 辯手評分 + 3 位獨立評審 → **程式計算** → 判決 → 稽核修復 → 報告。

## 安裝
**本機連結**（開發用）：把此資料夾以 `link:` 方式加入 DSH profile 的 `package.json` dependencies，
並在 `dsh.profile.bundles` 加入 `agent-senate-dsh`，重啟 DSH。

**從 GitHub**：在 DSH 市集輸入 `github:<帳號>/<repo>`。

## 使用
直接對 DSH 說：
> 用虛擬內閣辯論一下：我們 3 人新創做 B2B SaaS 後端，一年內預計 500 家企業客戶，團隊熟 Python，該選 Go 還是 Rust？

可以加：「加入資安官」、「辯 3 輪」、「附上這個專案的 README 當情境」。情境給得越具體（團隊、流量、期限），辯論越有價值。

輸出在工作目錄的 `senate-runs/<日期>-<題目>/`：
`report.md`、`transcript.md`、`matrix.html`（可互動：拖權重、切人格視角、一鍵示範翻盤點）、`analysis.json`、`input.json`。

範例輸出：`skills/agent-senate/examples/sample-matrix.html`（示範資料，非真實辯論）。

## 開發
接手修改前請先讀 [HANDOFF.md](HANDOFF.md)（歷史、架構、已修的 bug、地雷、驗證狀態、改東西去哪改）。

```
npm test    # 11 個測試，含「翻盤點解析解 vs 暴力掃描」200 組隨機矩陣的對照
node skills/agent-senate/scripts/analyze.mjs skills/agent-senate/examples/sample-input.json --out ./out
```

## 已知限制
- 辯論品質取決於 DSH 目前的模型；所有角色用同一個模型時，多樣性來自人格提示與獨立 subagent，不如多家模型。
- 事實查核員沒有網路，只依穩定的公認知識判斷，不確定時標為 `unverifiable`。
- 一場完整辯論會派出約 25–35 個 subagent，需要幾分鐘。
