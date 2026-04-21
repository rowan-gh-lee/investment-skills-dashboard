---
name: investment-analysis-rules
description: Use this skill whenever computing financial KPIs on investment data — returns, risk metrics (CAGR, Sharpe, Sortino, MDD, VaR, CVaR, Beta, Alpha), concentration, and stress tests. Every formula is deterministic and defined here so that outputs are reproducible across any dataset.
version: 1.0.0
license: MIT
---

# 01 · 투자 분석 기준 Skills.md

이 문서는 대시보드에 표시되는 **모든 숫자의 정의**를 담는 SSOT(Single Source of Truth)입니다. 계산 구현(`scripts/metrics.py`)은 반드시 이 문서의 수식과 1:1 대응해야 합니다.

## 계산 전 전제

| 항목 | 기본값 | 재정의 조건 |
|---|---|---|
| 거래일/년 | **252일** | 데이터가 주간/월간이면 52/12로 스케일 |
| 무위험수익률 `rf` | **3.5% / 년** | 사용자 override 지원 — 웹앱 `#rf-input` (연 소수, 예 0.035 = 3.5%), Python `run_all.py --rf`. Sharpe · Sortino · Jensen α 에 즉시 반영. |
| 수익률 타입 | **log return** (`ln(P_t/P_{t-1})`) | `simple` 옵션 가능하나 KPI는 로그 기반 |
| 기준통화 | **USD** | holdings.currency 혼재 시 일괄 변환 필요 |
| 결측 처리 | `ffill(limit=5)` → 잔여 NaN 드롭 | 5영업일 초과 결측은 제외 |

## 수익률 구성

```
r_t = ln(P_t / P_{t-1})                                              # 일간 로그수익률
r_port = Σ_i w_i · r_i                                              # 포트폴리오 로그수익률 (근사)
cum_t = exp(Σ_{τ≤t} r_τ)                                            # 1.0에서 시작하는 누적가치
```

가중치 합이 1이 아니면 **사용 가능 종목만으로 재정규화** 후 경고 로그.

## 핵심 KPI 정의

| 지표 | 기호 | 정의 | 단위 |
|---|---|---|---|
| CAGR | `g` | `(P_end / P_start)^(1/years) - 1`, years = (end-start).days/365.25 | 연 % |
| 누적 수익률 | `TR` | `cum_end - 1` | % |
| 연환산 변동성 | `σ_a` | `std(r_daily, ddof=1) · √252` | 연 % |
| Sharpe | `S` | `(mean(r) · 252 - rf) / σ_a` | ratio |
| Sortino | `S_d` | `(mean(r) · 252 - rf) / (std(r|r<0, ddof=1) · √252)` | ratio |
| MDD | `D*` | `min(cum / cummax(cum) - 1)` — 음수 | % |
| Calmar | `C` | `CAGR / |MDD|` | ratio |
| Beta vs bench | `β` | `Cov(r_p, r_b) / Var(r_b)` | ratio |
| Alpha(Jensen) | `α` | `CAGR_p - (rf + β·(CAGR_b - rf))` | 연 %p |
| Tracking Error | `TE` | `std(r_p - r_b, ddof=1) · √252` | 연 % |
| Information Ratio | `IR` | `(CAGR_p - CAGR_b) / TE` | ratio |
| Outperformance Freq | `UC_daily` | `P(r_p > r_b)` over all days — 벤치 대비 <b>일간 승률</b>. 전통적 Up-Capture Ratio(∑r_p / ∑r_b on `r_b>0` days)와 구분. 본 대시보드 JSON 에서는 키 이름을 `up_capture_daily` 로 유지하되, 의미는 "일간 승률"로 해석할 것. | 0~1 |
| HHI (집중도) | `H` | `Σ w_i²`, 정규화된 가중치 기준 | 0~1 |
| VaR 95% | `VaR` | `-quantile(r, 0.05)` (역사적) | 일 % 손실 |
| CVaR 95% | `CVaR` | `-mean(r | r ≤ VaR)` | 일 % 손실 |

## 롤링 지표

| 지표 | 기본 윈도우 | 계산식 |
|---|---|---|
| Rolling Sharpe | 63영업일 (≈1분기) | `(ma_ret·252 - rf) / (ma_std·√252)` |
| Rolling Beta | 63영업일 | `roll_cov(r_p, r_b) / roll_var(r_b)` |
| Rolling Vol | 60영업일 | `roll_std(r) · √252` |

## 스트레스 시나리오

다음 5개 시나리오는 **고정값**으로 정의합니다. 각 시나리오는 (섹터 또는 자산군 → 1일 로그수익률 충격)의 매핑이며, 포트폴리오 손익은 `Σ w_i · shock_i`.

| 시나리오 | 설명 |
|---|---|
| 2008 GFC (1일 최악) | Equity -9%, REIT -12%, Bond +1%, Commodity 0% |
| COVID-19 쇼크 (2020-03-16) | Equity -12%, REIT -17%, Bond -2%, Commodity -5% |
| 테크 디레이팅 (금리 +100bp) | IT/Comm/Consumer 하락, Financial/Energy 상승, Bond -3% |
| 달러 초강세 (DXY +5%) | Equity -2%, Commodity -4%, Bond -1%, REIT -1% |
| 에너지 쇼크 (유가 +30%) | Energy +8%, Consumer -3%, Commodity +4% |

섹터 매핑이 없으면 `asset_class` 기본값으로 fallback, 그것도 없으면 0.

## 오분류 방지 — 절대 금지 리스트

| 금지 | 이유 | 대안 |
|---|---|---|
| 평균 일간수익률을 "연수익률"로 표기 | 연환산은 `×252` 필요 | `mean(r)·252` 후 % 표기 |
| 결측일 `ffill` 없이 삭제 | 변동성 과소 추정 | `ffill(limit=5)` 후 잔여 삭제 |
| 가중치 합 ≠ 1 상태로 기여도 계산 | 합계 불일치 | 경고 후 재정규화 |
| 벤치마크 없이 "초과수익률" 단정 | 비교 불가 | `bench_ticker` 자동 탐지(SPY/KOSPI) |
| % / 금액 이중축 한 차트 | 해석 오류 | 별도 차트 분리 |

## 출력 규칙

`compute_summary()`는 항상 아래 키를 가진 딕셔너리를 반환합니다:

```jsonc
{
  "period": {"start": "...", "end": "...", "trading_days": N},
  "portfolio": {
    "cagr", "total_return", "ann_vol", "sharpe", "sortino",
    "mdd", "mdd_peak", "mdd_trough", "calmar", "hhi",
    "var_95", "cvar_95", "var_99"
  },
  "vs_benchmark": { "ticker", "beta", "alpha", "cagr", "ann_vol",
                    "mdd", "tracking_error", "information_ratio",
                    "up_capture_daily" }  // null if no bench
  "stress": [ {scenario, pnl_pct, by_sector}, ... ],
  "composition": { "by_sector", "by_asset_class", "by_region", "n_positions" }
}
```

소수점은 `round(x, 6)` 원시값, UI 표시는 **퍼센트 2자리 / 비율 2자리** 통일.

## 새 KPI 추가 체크리스트

1. 본 문서의 "핵심 KPI 정의" 표에 행 추가 (수식·단위 명시).
2. `scripts/metrics.py`에 순수 함수로 구현.
3. `compute_summary()`의 반환 스키마에 키 추가.
4. UI 표시가 필요하면 `03_visualization.md`·`05_dashboard_composition.md` 업데이트.
5. 인사이트 생성 로직에 쓰이면 `04_insight_generation.md` 업데이트.

> 5개 문서 동시 갱신이 원칙. 한 군데라도 누락되면 숫자 불일치가 발생한다.
