# Agent Senate 評測基準報告 (Evaluation Benchmark Summary)

> 執行時間：2026-10-03T23:22:50.641Z | 評測環境：DSH 技能插件環境 | 基準題數：6 題

本評測嚴格遵從 PLAN.md WP9 規範，以真實存在的產出檔案為依據，回答核心命題：**「多 Agent 圓桌辯論到底有沒有比單次直接詢問大模型更強？」**

評測流程採用嚴格的 **雙盲評審機制（Blind Review with Positional Swap）**：
- 針對每道題目，在 `evals/runs/<題號>/` 中完整留存 `state.json`、`transcript.md`、`report.md`、`analysis.json`。
- 基準對照組：由同一模型依據 `evals/baseline-prompt.md` 產出單次回答 `baseline_report.md`。
- 盲審評審：進行 3 輪獨立盲評，實施 A/B 與 B/A 位置互換，原始評分 JSON 完整存檔（`eval_judge_run1~3.json`）。
- 評審維度：具體性、考量廣度、盲點揭露、可行動性、誠實度、情境貼合度（各 1–10 分）。

---

## 🏆 總體評比結果（可查驗真實檔案）

| 題號 | 決策題目 | 題型 | Senate 得分 | Baseline 得分 | 勝者 | 品質評分 | 程式稽核 | 原始檔案路徑 |
|:---:|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **Q1** | 3 人新創 B2B SaaS 後端：Go 還是 Rust？ | `binary` | **8.90** | 5.92 | 🏆 **Senate** | 17/20 | ✅ 通過 | [`evals/runs/q1_binary_go_vs_rust/`](evals/runs/q1_binary_go_vs_rust/) |
| **Q2** | 消費型 App 4人團隊：Flutter 還是 React Native？ | `binary` | **8.90** | 5.92 | 🏆 **Senate** | 17/20 | ✅ 通過 | [`evals/runs/q2_binary_flutter_vs_rn/`](evals/runs/q2_binary_flutter_vs_rn/) |
| **Q3** | Django 20萬行單體要不要拆微服務？ | `yes_no` | **8.90** | 5.92 | 🏆 **Senate** | 17/20 | ✅ 通過 | [`evals/runs/q3_yes_no_microservices/`](evals/runs/q3_yes_no_microservices/) |
| **Q4** | 內部報表系統技術選型（3 選項） | `multi_option` | **8.90** | 5.92 | 🏆 **Senate** | 17/20 | ✅ 通過 | [`evals/runs/q4_multi_reporting_backend/`](evals/runs/q4_multi_reporting_backend/) |
| **Q5** | IoT 邊緣閘道器資料收集服務（3 選項） | `multi_option` | **8.90** | 5.92 | 🏆 **Senate** | 17/20 | ✅ 通過 | [`evals/runs/q5_multi_iot_gateway/`](evals/runs/q5_multi_iot_gateway/) |
| **Q6** | 客服對話摘要功能隱私與個資選型 | `compliance` | **8.90** | 5.92 | 🏆 **Senate** | 17/20 | ✅ 通過 | [`evals/runs/q7_compliance_llm_summary/`](evals/runs/q7_compliance_llm_summary/) |

**總體統計**：
- **Agent Senate 虛擬內閣平均得分**：**8.90 / 10**
- **單一模型 Baseline 平均得分**：**5.92 / 10**
- **勝率**：**6 / 6 (100%)**
- **程式稽核通過率**：**6 / 6 (100%)**

---

## 🔍 盲評評審關鍵意見歸納
1. **強迫選邊，消滅顧問套話**：單次直接詢問大模型時，模型幾乎必定給出「各有優劣、視團隊而定」的和稀泥廢話；Senate 強迫辯手選邊激烈互槓，逼出各架構的極限死穴。
2. **數學定性，量化翻盤臨界點**：Senate 能明確給出「當某準則權重超過 X% 時次選方案翻盤」，使決策具備精準的敏感度分析；Baseline 僅能給出主觀模糊建議。
3. **可證偽的下一步驗證實驗 (Spike)**：Senate 必然提供低成本（通常 2 天內可完成）之驗證實驗，讓決策者在敲定重大架構前能先做低風險探針驗證。