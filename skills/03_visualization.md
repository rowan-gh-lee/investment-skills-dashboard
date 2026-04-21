---
name: investment-visualization
description: Use this skill whenever deciding WHICH chart type to draw for investment data and HOW to style it. Defines the chart catalog (12 charts), selection logic (performance/risk/composition axes), color palette, font, interactive controls, and responsive breakpoints. Ensures visual consistency across any portfolio.
version: 1.0.0
license: MIT
---

# 03 · 시각화 선택 기준 Skills.md

본 문서는 "어떤 데이터에 어떤 차트를 그릴 것인가"를 결정하는 규칙을 정의합니다. 시각화 라이브러리는 **Plotly.js(CDN)** 로 고정하여 `plotly.to_html()` 결과를 그대로 HTML에 인라인합니다.

## 설계 원칙

1. **3축 분류 — 성과 / 리스크 / 구성**. 모든 차트는 이 중 하나에 속합니다.
2. **한 차트 한 메시지**. 한 그림에 2개 이상의 주장을 담지 않음.
3. **모든 차트에 1줄 캡션**. "무엇을 / 왜" 본문 바로 아래 12px 회색 주석.
4. **색 = 의미**. 양/음/경고를 색으로 구분하되, 색각이상 대비 충분한 대비를 유지.
5. **인터랙티브 기본**. 호버 툴팁·범례 토글·줌은 항상 활성.

## 차트 카탈로그 (12종)

| # | 축 | 차트명 | 목적 | 입력 | 렌더러 |
|---|---|---|---|---|---|
| 1 | 성과 | 누적 수익률 라인 (포트 vs 벤치) | 전체 성과 비교 | `port_ret, bench_ret` | `go.Scatter` |
| 2 | 성과 | 월별 수익률 히트맵 | 연중·월별 편향 | `port_ret` | `go.Heatmap` |
| 3 | 리스크 | Underwater Curve (포트 vs 벤치) | 낙폭 비교 | `port_ret, bench_ret` | `go.Scatter` |
| 4 | 리스크 | 일간수익률 분포 + VaR/CVaR 선 | 꼬리위험 형상 | `port_ret` | `go.Histogram` |
| 5 | 리스크 | 롤링 Sharpe & Beta (이중축) | 국면 민감도 | `port_ret, bench_ret` | `go.Scatter` |
| 6 | 리스크 | 60일 이동 연환산 변동성 | 변동성 국면 감지 | `port_ret` | `go.Scatter` |
| 7 | 리스크 | 스트레스 시나리오 막대 | 시나리오별 손익 | `summary.stress` | `go.Bar` |
| 8 | 리스크 | 종목 간 상관관계 히트맵 | 분산 효과 검증 | `prices[top_tickers]` | `go.Heatmap` |
| 9 | 구성 | 자산군 비중 가로 막대 | Equity/Bond/Alt 균형 | `holdings.asset_class` | `go.Bar` |
| 10 | 구성 | 섹터 비중 도넛 | 섹터 편중 | `holdings.sector` | `go.Pie(hole=0.55)` |
| 11 | 구성 | 지역·섹터·종목 Treemap | 계층 분해 | `holdings` | `px.treemap` |
| 12 | 구성 | Top 10 종목 가로 막대 | 종목 집중도 | `holdings` | `go.Bar` |

## 차트 선택 로직 (결정 트리)

```
질문: 무엇을 보여줘야 하는가?
├── "시간에 따른 성과" 
│   ├── 수준 비교 (포트 vs 벤치)       → 1. 누적 라인
│   ├── 주기성 / 편향                  → 2. 월별 히트맵
│   └── 낙폭 ·회복                    → 3. Underwater
├── "리스크 형상"
│   ├── 분포·꼬리                     → 4. 분포 + VaR/CVaR
│   ├── 시간에 따른 리스크             → 5. 롤링 Sharpe·Beta / 6. 롤링 Vol
│   ├── 가정적 충격                    → 7. 스트레스 바
│   └── 상관(분산효과)                 → 8. 상관 히트맵
└── "포트폴리오 구성"
    ├── 자산군 상위 관점               → 9. 자산군 바
    ├── 섹터 관점                      → 10. 섹터 도넛
    ├── 다차원 계층                    → 11. Treemap
    └── 종목 집중도                    → 12. Top10 바
```

## 색 팔레트

| 용도 | 색 | 사용 |
|---|---|---|
| 포트 (주) | `#2E86AB` (딥 블루) | 주요 라인, KPI 양수 |
| 벤치 | `#E63946` (버밀리언) | 벤치 라인 (점선 dot) |
| 양(positive) | `#2A9D8F` (티얼) | 양수 수익 |
| 음(negative) | `#E76F51` (코랄) | 음수 수익, Drawdown |
| 강조 | `#F4A261` (샌드) | 경고, 롤링 변동성 |
| 중립 | `#6C757D` (그레이) | 보조선, 격자 |

히트맵 발산 컬러맵: `[#E76F51, #FFFFFF, #2A9D8F]` (zmid=0).  
상관 히트맵: `[#1D3557, #FFFFFF, #E63946]` (zmid=0).

## 타이포그래피

```
font-family: 'Pretendard Variable', Pretendard, -apple-system, 'Noto Sans KR', sans-serif
기본 본문: 14px / line-height 1.55
차트 제목: 14~15px weight:700
축 레이블: 12px
캡션: 11.5px color:#64748b
KPI 값: 20px weight:700 letter-spacing:-0.02em
헤더 제목: 24px weight:800
```

## 레이아웃 및 반응형

```
전체 컨테이너: max-width 1440px · padding 24px
그리드:
  row-2-wide: 1.6fr 1fr  (큰 성과/월 히트맵)
  row-2:      1.15fr 1fr
  row-2b:     1fr 1fr
  row-3:      1fr 1fr 1fr

브레이크포인트:
  ≥ 1280px : 기본 레이아웃, KPI 7열
  1024~1280: KPI 4열
  < 1024px : KPI 2열, 모든 row → 1열 스택
```

## 인터랙션 규칙

| 동작 | 기본값 | 비고 |
|---|---|---|
| 호버 툴팁 | x-unified | 같은 x의 모든 계열 표시 |
| 범례 클릭 | 토글 | 클릭 시 해당 trace 숨김 |
| 줌 | 활성 | 드래그-줌 + 더블클릭 리셋 |
| 모드바 | 최소 | `lasso2d, select2d` 제거 |
| displaylogo | false | Plotly 로고 숨김 |

## 접근성

- 색으로만 구분하지 않기 — 선 스타일(`dash=dot` for 벤치), 텍스트 레이블 병기.
- 대시보드 전체 contrast ratio ≥ 4.5:1.
- 차트 내 텍스트는 최소 10px, KPI 값은 최소 18px.

## 스타일 가이드 — Do / Do Not

✅ **DO**
- 퍼센트 값은 `%` 단위 붙이고 `tickformat` 쓰지 말고 직접 `ticksuffix="%"`.
- 선 굵기는 주선 2.5~2.8px, 보조선 1.5~2px.
- 그리드 색 `#eee`, 배경 `white`.

❌ **DO NOT**
- 한 차트에 이중축(%·금액 혼재). 단, 의미상 비교 가능한 지표끼리는 허용 (Sharpe & Beta).
- PNG 이미지 삽입 (`<img src="file://">` 금지 — 배포 시 깨짐).
- 3D 차트·도넛 여러 겹 중첩·파이 16조각 이상 (인지 부담).

## 신규 차트 추가 절차

1. "차트 카탈로그" 표에 행 추가 (축·목적·입력·렌더러).
2. "차트 선택 로직" 트리에 분기 추가.
3. `scripts/plotting.py`에 `fig_<name>(...)` 함수 추가, `_base_layout()` 공통 레이아웃 사용.
4. `05_dashboard_composition.md`의 레이아웃 슬롯에 배치.
