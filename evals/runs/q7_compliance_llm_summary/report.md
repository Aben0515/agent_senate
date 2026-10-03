# 虛擬內閣決策裁決報告：客服對話摘要功能（每日 5 萬次呼叫、含敏感客戶個資）：該自架開源 LLM 還是使用雲端商業 API？

## 一、 一句話結論
> **推薦方案：雲端商業 API + 本地去識別化前置代理（cloud_api_with_anonymization）**（勝率：97%，加權總分：8.45，信心評級：高）
---

## 二、 問題框定與情境約束

### 情境事實（硬性約束）
- 客服系統每日處理 5 萬通客服對話，內含電話、地址與信用卡後四碼
- 符合金融法規要求，若使用雲端 API 需做去識別化；若自架開源模型則需自購 GPU 伺服器並負擔高昂電費與維運

### 採納之前提假設
- **業務優先活下來並驗證 PMF**（原因：界定資源優先級；若不成立影響：重大時程延誤）

---

## 三、 決策權衡矩陣（由程式計算產生）

本矩陣由中立評審獨立評分經 `analyze.mjs` 取中位數並結合情境權重計算：

| 準則 ID | 評估準則（越高越好） | 中立權重 | 雲端商業 API + 本地去識別化前置代理 (`cloud_api_with_anonymization`) | 自架開源私有化 LLM (vLLM) (`self_hosted_open_llm`) | 關鍵理由摘要 |
|---|---|:---:|:---:|:---:|---|
| `regulatory_compliance` | 個資法法規合規與審計安全性 | **33%** | 9.0 | 4.2 | 雲端商業 API + 本地去識別化前置代理 在 個資法法規合規與審計安全性 表現分析 |
| `summary_quality` | 長文本對話摘要品質與精準度 | **26%** | 9.0 | 4.2 | 雲端商業 API + 本地去識別化前置代理 在 長文本對話摘要品質與精準度 表現分析 |
| `tco_infrastructure` | 基礎設施三年總持有成本 (TCO) | **10%** | 9.0 | 8.8 | 雲端商業 API + 本地去識別化前置代理 在 基礎設施三年總持有成本 (TCO) 表現分析 |
| `ops_simplicity` | 維運簡單度與 SLA 保證 | **10%** | 7.2 | 8.8 | 雲端商業 API + 本地去識別化前置代理 在 維運簡單度與 SLA 保證 評估 |
| `scalability_concurrency` | 尖峰流量彈性伸縮 | **10%** | 7.2 | 8.8 | 雲端商業 API + 本地去識別化前置代理 在 尖峰流量彈性伸縮 評估 |
| `vendor_lockin` | 供應商鎖定防範 | **10%** | 7.2 | 8.8 | 雲端商業 API + 本地去識別化前置代理 在 供應商鎖定防範 評估 |
| **加權總分** | — | **100%** | **8.45** | **6.07** | **領先幅度：2.38 分** |

---

## 四、 穩健度與敏感度分析

- **推薦贏家**：`cloud_api_with_anonymization`
- **領先幅度 (Margin)**：2.38 分
- **最小後悔方案 (Minimax Regret)**：`cloud_api_with_anonymization`
- **Monte Carlo 模擬勝率**（在評審意見擾動與權重隨機變動下的模擬獲勝比例；註：此為模型敏感度指標，非真實商業成功機率）：
  - 雲端商業 API + 本地去識別化前置代理 (`cloud_api_with_anonymization`): **97%**
  - 自架開源私有化 LLM (vLLM) (`self_hosted_open_llm`): **3%**

### 翻盤臨界點 (Tipping Points)
- 若「**維運簡單度與 SLA 保證**」權重從目前 10% 提高至 **64%** 以上，**self_hosted_open_llm** 將翻盤勝出。
- 若「**尖峰流量彈性伸縮**」權重從目前 10% 提高至 **64%** 以上，**self_hosted_open_llm** 將翻盤勝出。
- 若「**供應商鎖定防範**」權重從目前 10% 提高至 **64%** 以上，**self_hosted_open_llm** 將翻盤勝出。

### 各人格價值觀視角 (Persona Lens: 辯手權重 × 主席客觀分數)
> 說明：檢驗「如果採用該辯手的核心價值觀與權重排序，但依據客觀中位數評分」，哪一個方案會勝出：

| 辯手身分 | 勝出方案 | 各方案得分詳情 |
|---|:---:|---|
| **security_paranoid** | `cloud_api_with_anonymization` | cloud_api_with_anonymization: 8.46、self_hosted_open_llm: 6.04 |
| **conservative_cto** | `self_hosted_open_llm` | cloud_api_with_anonymization: 7.74、self_hosted_open_llm: 7.88 |

### 辯手主觀立場評分 (Persona Own View: 辯手自身主觀打分)
> 說明：辯手完全基於自身偏好與立場各自打出的主觀評分總結：

| 辯手身分 | 主觀推薦 | 各方案主觀得分 | 總結一句話 |
|---|:---:|---|---|
| **security_paranoid** | `cloud_api_with_anonymization` | cloud_api_with_anonymization: 9.00、self_hosted_open_llm: 5.00 |  |
| **conservative_cto** | `self_hosted_open_llm` | cloud_api_with_anonymization: 6.00、self_hosted_open_llm: 9.50 |  |

---

## 八、 辯論精華與計分板

### 辯手表現計分板
| 辯手 | 提出論點數 | 攻擊命中 | 主動讓步 | 被標謬誤 | 查核存疑 | MVP得分 |
|---|---:|---:|---:|---:|---:|---:|
| security_paranoid | 3 | 1 | 0 | 0 | 0 | **3** |
| conservative_cto | 2 | 1 | 1 | 0 | 0 | **4** |
| kiss_hacker | 2 | 1 | 0 | 0 | 0 | **3** |