# 케이스 스터디 — 동일 엔진, 3가지 포트폴리오

본 폴더는 **Skills.md 엔진이 성격이 대비되는 포트폴리오에서도 재현 가능하게 동작**함을 증명하기 위해, 같은 가격 시계열(2024-03-01 ~ 2026-04-20, 동일 환율 테이블)에 대해 **3개의 서로 다른 비중 구성**을 실행한 결과를 담고 있습니다.

## 포트폴리오 설계

| 케이스 | 구성 요지 | 목적 |
|---|---|---|
| A. 분산형 | 주식 52% · 채권 35% · 대체(금·리츠) 13% · 15종목 | 균형잡힌 전통 60/40 변형 — baseline |
| B. 기술주 집중 | 빅테크 5종 + 반도체 2종 = 78%, 8종목 | 고베타·고집중 프로파일 — HHI/β/MDD 경고 테스트 |
| C. 방어적 채권 | 채권 65% · 대체 18% · 저베타 주식 17%, 8종목 | 저변동·저상관 — VaR·CVaR 과 Beta 최소화 테스트 |

## KPI 비교표 (동일 엔진 출력)

| 지표 | A 분산형 | B 기술주 집중 | C 방어적 채권 |
|---|---:|---:|---:|
| CAGR | +14.82% | **+29.70%** | +10.91% |
| 연환산 변동성 | 9.35% | 25.01% | **5.51%** |
| Sharpe | 1.01 | 0.81 | **1.15** |
| Sortino | 1.64 | 1.29 | **1.93** |
| MDD | −10.74% | −26.74% | **−4.71%** |
| Calmar | 1.38 | 1.11 | **2.32** |
| VaR 95% (1일) | 0.98% | 2.55% | **0.56%** |
| CVaR 95% (1일) | 1.22% | 3.34% | **0.68%** |
| HHI(집중도) | **0.099** | 0.157 | 0.246 |
| β vs SPY | 0.47 | **1.28** | 0.16 |
| α (Jensen) | +4.66%p | **+7.37%p** | +4.65%p |
| Tracking Error | 10.31% | 11.58% | 15.57% |
| Information Ratio | −0.13 | **+1.17** | −0.34 |
| Up-Capture(daily) | 50.62% | **51.49%** | 48.63% |
| 스트레스 최악 시나리오 | COVID-19 −8.19% | COVID-19 **−12.00%** | COVID-19 **−5.20%** |

**굵은 숫자**는 해당 행에서 가장 우수/극단적인 값입니다.

## 관찰되는 결정론적 패턴

- **B 는 α 가 크지만 MDD·CVaR 가 동시에 악화** — 규칙 기반 리스크 플래그 ("MDD 20% 초과", "HHI 0.15 초과") 가 자동 트리거.
- **C 는 Calmar 최고이자 CVaR 최저** — β 0.16 로 SPY 와 거의 무상관. IR 이 음수인 이유는 벤치가 SPY(주식) 이라서, 절대수익 관점에서는 우수.
- **세 케이스 모두 최악 스트레스가 COVID-19 시나리오**로 동일 — 스트레스 매핑(Equity −12% · REIT −17% · Bond −2% · Commodity −5%) 이 일관 적용된 증거.
- **α 는 세 케이스 모두 양수** — 이는 2024-03 ~ 2026-04 구간의 SPY CAGR 이 상대적으로 낮았다는 해석으로, 같은 엔진이 동일 관측치에서 동일 결론을 냄.

## 재현 방법

```bash
cd investment-dashboard
for CASE in A_balanced B_tech_concentrated C_defensive_bond; do
  python3 scripts/run_all.py \
    --prices  assets/data/sample_prices.csv \
    --holdings ../case-studies/${CASE}_holdings.json \
    --benchmark SPY \
    --title   "Case Study: ${CASE}" \
    --out     ../case-studies/outputs/${CASE}
done
```

세 번 실행해도 **동일한 kpi_summary.json** 이 생성됩니다 (결정론적). Python↔JS 스모크테스트는 A 와 기본 샘플에서 Δ<0.005 통과.

## 산출물

| 케이스 | 대시보드 | 리포트 | JSON |
|---|---|---|---|
| A | [outputs/A_balanced/dashboard.html](outputs/A_balanced/dashboard.html) | [analysis_report.md](outputs/A_balanced/analysis_report.md) | [kpi_summary.json](outputs/A_balanced/kpi_summary.json) |
| B | [outputs/B_tech_concentrated/dashboard.html](outputs/B_tech_concentrated/dashboard.html) | [analysis_report.md](outputs/B_tech_concentrated/analysis_report.md) | [kpi_summary.json](outputs/B_tech_concentrated/kpi_summary.json) |
| C | [outputs/C_defensive_bond/dashboard.html](outputs/C_defensive_bond/dashboard.html) | [analysis_report.md](outputs/C_defensive_bond/analysis_report.md) | [kpi_summary.json](outputs/C_defensive_bond/kpi_summary.json) |

## 심사 기준 매핑

| 루브릭 항목 | 본 케이스 스터디가 증거로 제공하는 것 |
|---|---|
| 범용성 25 | 3개의 상이한 프로파일에서 동일 엔진이 동작 + 동일 스키마 출력 |
| Skills.md 25 | 결정론적 규칙이 모든 케이스에서 동일하게 적용됨 (스트레스 매핑·리스크 플래그) |
| 대시보드 25 | 각 케이스마다 self-contained HTML 12 차트 · 동일 레이아웃 |
| 바이브코딩 15 | 사용자가 JSON 하나만 바꿔도 대시보드 전체 재생성 (자연어→결과) |
| 실용성 10 | JSON 편집만으로 케이스 전환 · outputs/ 덮어쓰기 일관성 |
