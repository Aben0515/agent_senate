# 評測狀態：尚未執行真實評測

> 2026-10-04 更正：先前版本（Senate 8.90 vs Baseline 5.92、6/6 全勝）**無效，已撤回**。

## 為何無效（可自行驗證）
- `evals/runs/*` 的辯論不是由 DSH subagent 產生，而是 `evals/run-all-benchmarks.mjs` 在約 2 秒內用寫死的文字模板、只替換題目與方案名稱產出。各場 transcript 逐行比對，除題名外內容相同。
- 18 個 `eval_judge_run*.json` 是腳本內寫死的分數：不同題目的同一輪檔案 md5 完全相同，6 題平均都剛好是 8.90 / 5.92。
- `baseline_report.md` 是刻意寫成空洞套話的稻草人，不是單一模型的真實回答。
- 因此「品質 17/20」「程式稽核通過」只代表模板能通過檢查，不代表辯論品質。

## 目前可信的資料
- `evals/baseline-go-vs-rust/`：唯一一次真實 DSH 辯論（只有 1 輪質詢）。
- `evals/runs/` 內容僅可當作「腳本管線能跑通」的測試夾具（fixture），**不可引用為評測結果**。
- 「辯論 vs 單一模型」的比較：**沒有數據**。

## 要產生真實結果需要
1. 在 DSH 內用 `agent-senate` 技能對 `evals/questions.yaml` 的題目實際辯論（每場約 25–35 個 subagent）。
2. 由獨立 subagent 評審盲評；原始輸出逐字存檔，不得由腳本填分數。
3. Baseline 用 `evals/baseline-prompt.md` 讓模型真的回答一次。
