---
name: investment-dashboard
description: Use this skill whenever the user wants to analyze investment data, build investor-facing dashboards, compute portfolio KPIs (CAGR, Sharpe, Sortino, MDD, volatility, beta), produce allocation/risk/return visualizations, or convert raw price/portfolio data into an interactive HTML dashboard. Trigger for requests like "분석해줘", "대시보드 만들어줘", "포트폴리오 진단", "수익률 계산", ".csv 가격 데이터 시각화", "백테스트 결과 정리", "위험도 평가", "섹터/자산군 배분 차트". Produces a single self-contained HTML dashboard plus a markdown analysis report.
version: 1.0.0
license: MIT
---

# Investment Data Dashboard Skill

이 Skill은 사용자의 투자 관련 원본 데이터(가격 시계열, 포트폴리오 보유종목, 거래 내역 등)를 받아 **(1) 재무 KPI를 계산**하고 **(2) 단일 HTML 대화형 대시보드를 생성**하며 **(3) 해석 중심의 분석 리포트(MD)를 작성**하는 표준 절차를 제공합니다.

## 언제 이 Skill을 쓰는가

| 상황 | 예시 요청 |
|---|---|
| 포트폴리오 진단 | "내 보유종목 CSV 분석해서 리스크와 배분 보여줘" |
| 가격 시계열 분석 | "3년치 일별 가격 데이터로 수익률/MDD 계산해줘" |
| 백테스트 리포팅 | "전략 수익률 엑셀을 보기 좋은 대시보드로" |
| 자산배분 점검 | "섹터·국가·자산군별 비중을 시각화해줘" |
| 동적 비교 | "벤치마크 대비 알파/베타 뽑고 차트까지" |

이 중 하나라도 해당되면 **즉시 본 Skill을 사용**하십시오.

## 실행 전 원칙 (중요)

1. **데이터 우선 확인.** 절대 추정하지 말 것. Python으로 먼저 샘플 행·스키마·결측·기간을 출력해 실제 구조를 파악한다.
2. **통화·주기·수익률 기준을 명시.** KPI 계산 전에 `frequency`(일/주/월), `base_ccy`, `return_type`(log/simple) 세 가지는 반드시 결정하고 리포트 서문에 기재.
3. **단일 파일 원칙.** 최종 대시보드는 Plotly CDN + 인라인 JSON을 사용하는 **단 하나의 `.html` 파일**이어야 한다. 이미지 의존, 외부 JS/CSS 번들 금지.
4. **수치는 소수점 규칙을 통일.** % 지표는 소수점 2자리, 금액은 천 단위 구분자 + 통화기호, 비율(Sharpe 등)은 소수점 2자리.
5. **한국어 레이블 기본.** 축·범례·KPI 카드 레이블은 한국어, 원 데이터 티커·섹터명은 그대로 유지.
6. **설명가능성.** 모든 차트는 "무엇을/왜 보여주는가" 주석이 캡션으로 1줄 이상 붙어야 한다.

## 표준 파이프라인

```
1. ingest        → 원본 파일 감지(.csv/.xlsx/.json) → 스키마 추론
2. normalize     → 가격 → 일간수익률, 결측 처리, 주기 통일
3. kpi           → CAGR / Vol / Sharpe / Sortino / MDD / Calmar / Beta / Alpha
4. attribution   → 섹터·자산군·종목별 비중/기여도
5. visualize     → scripts/plotting.py 로 Plotly Figure 6~8개 생성
6. compose       → scripts/build_dashboard.py 로 단일 HTML 조립
7. report        → analysis_report.md 작성 (결론/리스크/제안)
```

각 단계는 `scripts/` 하위 모듈로 분리되어 있으며, 단독 실행 가능하다. **전체 실행은 `python scripts/run_all.py --input <path>` 한 줄로 끝난다.**

## 데이터 스키마 (최소 요구)

### A) 가격 시계열 (wide 또는 long)

Wide 형식 선호:

| date | AAPL | MSFT | TSLA | SPY |
|---|---|---|---|---|
| 2023-01-02 | 130.28 | 239.58 | 108.10 | 381.82 |

- `date`: ISO-8601, 거래일만.
- 종목 컬럼은 조정 종가(`adjusted close`) 기준.

### B) 포트폴리오 holdings

| ticker | name | sector | asset_class | weight | currency | region |
|---|---|---|---|---|---|---|
| AAPL | Apple Inc. | IT | Equity | 0.12 | USD | US |

- `weight` 합은 1.0(±0.005) 이어야 함. 초과 시 경고 후 재정규화.

### C) 거래 내역 (선택)

| date | ticker | side | qty | price | fee |
|---|---|---|---|---|---|

거래 내역이 있으면 시점별 포지션 재구성 및 **실현/미실현 손익** 분리를 수행한다.

## 계산 정의 (반드시 이 정의를 따를 것)

- 일간 로그수익률: `r_t = ln(P_t / P_{t-1})`
- 연환산 변동성: `σ_ann = σ_daily × √252`
- CAGR: `(P_end / P_start)^(1/years) - 1` — `years`는 실제 경과 일 / 365.25
- Sharpe: `(평균일수익률 × 252 - rf) / σ_ann` — `rf` 기본값은 3.5% (사용자가 지정하면 override)
- Sortino: Sharpe 수식에서 분모를 **하방 편차만** 사용
- Max Drawdown(MDD): `min( P_t / cummax(P_t) - 1 )`
- Calmar: `CAGR / |MDD|`
- Beta: `Cov(r_p, r_bench) / Var(r_bench)` — 벤치마크 컬럼명은 `SPY` 또는 `KOSPI` 자동 탐지
- Alpha(Jensen): `CAGR_p - (rf + β × (CAGR_bench - rf))`

위 정의는 `scripts/metrics.py`에 그대로 구현되어 있다. 새로운 KPI 추가 시 이 문서의 표와 함수를 **동시에** 업데이트할 것.

## 대시보드 레이아웃 (고정)

```
┌───────────────────────────── 헤더 ─────────────────────────────┐
│ 포트폴리오명 · 분석 기간 · 기준통화 · 갱신 시각                   │
├────────────── KPI 카드 (가로 6개) ─────────────────────────────┤
│ [CAGR] [연변동성] [Sharpe] [MDD] [Calmar] [Beta vs 벤치]        │
├───────────── 행 1: 성과 ───────────────────────────────────────┤
│  [누적수익률 선그래프(포트 vs 벤치)]  [월별 수익률 히트맵]        │
├───────────── 행 2: 리스크 ─────────────────────────────────────┤
│  [Drawdown 영역그래프]                [수익률 분포(히스토그램)]   │
├───────────── 행 3: 구성 ───────────────────────────────────────┤
│  [섹터 비중 도넛]    [국가/지역 Treemap]    [Top 10 종목 바차트] │
├────────────── 해설 패널(좌측 고정) ────────────────────────────┤
│  핵심 인사이트 3문장 + 리스크 플래그                             │
└────────────────────────────────────────────────────────────────┘
```

- 팔레트: 포트 `#2E86AB`, 벤치 `#E63946`, 보조 `#F4A261`, 중립 `#6C757D`.
- 폰트: `Pretendard, -apple-system, 'Noto Sans KR', sans-serif`.
- 반응형: 최소 `1280×800` 기준, 태블릿(`~ 1024px`)에서 2열 → 1열로 축소.

## 해설 리포트(MD) 작성 규칙

리포트는 다음 섹션 순서로 작성한다:

1. **한 줄 요약** — "기간 X ~ Y 동안 포트는 CAGR n%, MDD -m% 를 기록했다" 형식.
2. **성과 분석** — 벤치마크 대비 초과수익/열위 구간 식별, 원인(섹터·종목) 2~3개 짚기.
3. **리스크 진단** — MDD 발생 구간, 변동성, 집중도(HHI), 상관관계.
4. **포트폴리오 구성** — 상위 비중 종목/섹터, 편중 여부 판단.
5. **제안** — 리밸런싱·헤지·현금비중 조정 등 실행 가능한 항목 3개.

숫자 근거 없는 단정은 금지. 모든 주장은 위 대시보드 차트 중 하나를 `(그림 X)` 형태로 인용.

## 출력 파일 규칙

`outputs/` 폴더에 아래 3개 파일을 생성:

```
outputs/
├── dashboard.html          # 단일 파일 Plotly 대시보드
├── analysis_report.md      # 해설 리포트
└── kpi_summary.json        # KPI 원시값 (다른 도구와 연동용)
```

파일명에 타임스탬프를 **붙이지 말 것**. 재실행 시 덮어쓰기가 기본.

## 자주 하는 실수 (Do NOT)

- ❌ 평균 일간수익률을 그대로 "연수익률"이라고 표기.
- ❌ 결측일을 `ffill` 없이 지워 변동성이 과소 추정됨.
- ❌ 가중치 합이 1이 아닌 채로 기여도 계산.
- ❌ 벤치마크 없이 Sharpe 하나로 "우수"/"열위"를 단정.
- ❌ 금액·수익률·비율을 같은 축에 올리는 이중축 남용.
- ❌ PNG 이미지를 HTML에 `<img src="file://...">`로 삽입 (배포 시 깨짐).

## 실행 예시

```bash
# 기본 실행 — CSV 가격 + holdings json
python scripts/run_all.py \
  --prices assets/data/sample_prices.csv \
  --holdings assets/data/sample_holdings.json \
  --benchmark SPY \
  --out outputs/

# 분석 기간 지정
python scripts/run_all.py --prices prices.csv --start 2022-01-01 --end 2024-12-31
```

실행이 끝나면 `outputs/dashboard.html`을 브라우저로 열어 확인한다.

## 확장 포인트

- **팩터 분석**: `scripts/factor.py`에 Fama-French 3/5 팩터 회귀 추가 (선택).
- **실시간 데이터**: yfinance/pykrx 커넥터는 `scripts/connectors/` 하위에 두되, 기본 파이프라인은 **로컬 파일 우선**으로 유지.
- **PDF 내보내기**: `pdf` skill과 결합해 `outputs/dashboard.html` → `outputs/report.pdf` 변환.

---

이 Skill의 목적은 **"데이터 → 의사결정 가능한 화면/문장"** 으로의 최단 경로를 제공하는 것. 차트 개수가 아니라 **의사결정이 몇 개 나오는가**로 품질을 판단하라.
