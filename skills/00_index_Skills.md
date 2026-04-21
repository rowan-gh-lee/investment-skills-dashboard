---
name: investment-skills-index
description: Use this skill first whenever a user requests an investment dashboard, portfolio analytics, KPI calculation, or risk report. Indexes the 5 companion Skills.md documents (data schema, analysis rules, visualization, insight, dashboard composition) and provides the overall pipeline. Trigger on mentions of portfolio, 포트폴리오, KPI, dashboard, 대시보드, 리스크 리포트, 수익률 분석.
version: 1.0.0
license: MIT
---

# 투자 데이터 시각화 — Skills.md 인덱스

본 패키지는 금융 투자 데이터를 **일관된 분석 기준**으로 처리하여 **자동으로 웹 대시보드를 생성**하기 위한 규칙 문서 세트입니다. 5개의 전문 Skills.md(01~05) + 본 인덱스(00) 의 총 6개 파일로 구성되며, 각 문서는 기능별로 독립 실행 가능하면서도 하나의 파이프라인으로 결합됩니다.

## 설계 철학

1. **데이터 → 의사결정까지 최단 경로**. 차트 수가 아니라 "의사결정이 몇 개 나오는가"로 품질을 판단.
2. **스키마 자동 인식, 수동 설정 최소화**. 컬럼명·포맷이 달라도 자동 매핑.
3. **규칙은 문서로, 코드는 얇게**. 모든 숫자 정의·시각화 규칙은 본 문서가 SSOT(Single Source of Truth).
4. **단일 파일 산출물**. 배포·공유가 쉬운 self-contained HTML을 최종 결과로 고정.

## 구성 문서

| # | 파일 | 역할 | 주요 규칙 |
|---|---|---|---|
| 01 | [`01_analysis_rules.md`](01_analysis_rules.md) | 투자 데이터 분석 기준 | 수익률 정의, KPI 계산식, 리스크 지표, 스트레스 시나리오 |
| 02 | [`02_data_schema.md`](02_data_schema.md) | 입력 데이터 스키마 | 가격·보유종목·거래내역 최소 스키마, 자동 매핑 규칙, 결측 처리 |
| 03 | [`03_visualization.md`](03_visualization.md) | 시각화 선택 기준 | 차트 선정 로직, 색상 팔레트, 반응형 레이아웃 |
| 04 | [`04_insight_generation.md`](04_insight_generation.md) | 인사이트 생성 규칙 | 규칙 기반 한 줄 요약, 리스크 플래그, 실행 제안 |
| 05 | [`05_dashboard_composition.md`](05_dashboard_composition.md) | 대시보드 조립 규칙 | 고정 레이아웃, KPI 카드, 해설 패널, 출력 파일 규약 |

## 실행 흐름

```
사용자 투자 데이터 (CSV/JSON/XLSX)
        │
        ▼
  ┌────────────────┐
  │ 02 데이터 스키마 │   ← 자동 스키마 인식, 결측 처리, 통화 정규화
  └────────┬───────┘
           ▼
  ┌────────────────┐
  │ 01 분석 규칙    │   ← 수익률/KPI/리스크 계산 (결정론적 공식)
  └────────┬───────┘
           ▼
  ┌────────────────┐   ┌────────────────┐
  │ 03 시각화 선택  │   │ 04 인사이트     │
  └────────┬───────┘   └────────┬───────┘
           └──────┬──────────────┘
                  ▼
         ┌────────────────┐
         │ 05 대시보드 조립 │   ← 단일 파일 HTML + MD 리포트 + JSON KPI
         └────────────────┘
```

## 사용 예시 (Vibe Coding 관점)

### 예시 대화 — 자연어 한 줄로 시작

> **사용자**: "내 포트폴리오 CSV(`my_prices.csv`) + `holdings.json` 분석해서 대시보드로 만들어줘"

→ Claude가 본 Skills.md 세트를 따라 **자동으로** 수행:

| 단계 | 참조 문서 | 결정 사항 |
|---|---|---|
| ① 데이터 감지 | `02_data_schema.md` | CSV shape 감지(Wide/Long), 날짜 컬럼 찾기, 결측 `ffill(5)`, 가중치 재정규화 |
| ② KPI 계산 | `01_analysis_rules.md` | CAGR·σ·Sharpe·Sortino·MDD·VaR/CVaR·β·α·IR·HHI — 수식은 전부 문서 표에서 참조 |
| ③ 스트레스 | `01_analysis_rules.md` §스트레스 | 고정 5개 시나리오 자동 적용 |
| ④ 차트 선정 | `03_visualization.md` | 성과·리스크·구성 3축 결정 트리 → 12 차트 선택 |
| ⑤ 인사이트 | `04_insight_generation.md` | 임계치 기반 결정론 문장 생성 — LLM 추론 금지 |
| ⑥ HTML 조립 | `05_dashboard_composition.md` | 헤더→Exec→KPI7→Row1~6→Insights 고정 레이아웃 |

사용자는 **자연어 한 줄**만 입력. Claude의 창의적 해석이 개입할 여지를 **문서가 전부 차단** — 같은 입력은 같은 산출물.

### 진짜 바이브코딩의 조건

1. **SSOT 문서** — 상수(`Rf=3.5%`, `MDD 경고 -20%`, `Sharpe 경고 0.5`)가 코드가 아닌 문서에만 존재. 문서를 고치면 구현이 자동 일치.
2. **Fallback 금지** — 문서에 없는 지표·차트·문장은 절대 생성 금지.
3. **재현성** — 같은 입력 + 같은 문서 → 같은 출력 (소수 5자리 일치 확인됨, `webapp_smoketest.js` 참조).

## 확장

- 새로운 KPI 추가 → `01_analysis_rules.md`의 "계산 정의" 섹션 + 구현 동시 갱신
- 새로운 차트 추가 → `03_visualization.md`의 "차트 카탈로그" + "선택 로직" 업데이트
- 새로운 자산군 지원 → `02_data_schema.md`의 `asset_class` 허용값 추가

각 스킬은 **독립적**으로 수정·교체 가능. 한 문서를 고쳐도 나머지는 그대로 동작.
