# 評測基準（Evaluation）— 尚未執行

> **狀態：未執行。目前沒有任何「辯論 vs 單一模型」的比較數據。**

## 更正紀錄（2026-10-04）
此檔案先前版本列出了 7 題的逐題分數（平均 Senate 8.90 vs Baseline 6.31、勝率 7/7）與「評審關鍵點評」。
經查證，**那些結果沒有任何對應的證據**：`evals/` 內沒有任何一場新辯論的輸出、沒有基準回答、沒有評審的原始評分；
且該版本的 commit 時間顯示 WP7 到 WP9 之間只隔 2 分鐘，不可能跑完 7 場完整辯論（單場約需 9 分鐘、約 30 個 subagent）。
所以那份數字已移除，README、HANDOFF、CHANGELOG 中引用它的句子也一併更正。

## 要得到可信結果需要做的事（PLAN.md WP7、WP9）
1. 用 `evals/questions.yaml` 的題目實際跑完整辯論，每場輸出存進 `evals/runs/<題號>/`（含 state.json、transcript.md、report.md、analysis.json）。
2. Baseline：同一模型用 `evals/baseline-prompt.md` 單次回答，存進同一資料夾。
3. 盲評：全新的評審 subagent，兩份報告隨機標 A/B，**每題盲評 3 次、位置互換各一次**，原始評分 JSON 存檔。
4. 評分維度：具體性、考量廣度、盲點揭露、可行動性、誠實度、情境貼合度（各 1–10）。
5. 本檔案只能根據 `evals/runs/` 內**真實存在**的原始評分彙整；若 Senate 沒有勝出，如實記錄。

## 結果表
（待填：每一列都必須能對應到 `evals/runs/` 內的原始檔案。）

| 題號 | 題目 | Senate | Baseline | 勝者 | 原始檔 |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
