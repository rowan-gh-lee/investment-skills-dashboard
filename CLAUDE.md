# CLAUDE.md — Agent 작업 규칙

이 프로젝트는 **Skills.md 6개** 로 정의된 SSOT(Single Source of Truth)를 기반으로 투자 대시보드를 생성합니다. Claude 혹은 다른 LLM 에이전트가 본 프로젝트에서 작업할 때 반드시 지켜야 하는 규칙을 정리합니다.

## 시작할 때 반드시 읽을 파일

| 순서 | 파일 | 목적 |
|---|---|---|
| 1 | `skills/00_index_Skills.md` | 파이프라인 전체 흐름 |
| 2 | `skills/01_analysis_rules.md` | KPI 공식·상수·스트레스 시나리오 |
| 3 | `skills/02_data_schema.md` | 입력 데이터 자동 매핑 규칙 |
| 4 | `skills/03_visualization.md` | 차트 카탈로그·색상·레이아웃 |
| 5 | `skills/04_insight_generation.md` | 결정론 인사이트 규칙 |
| 6 | `skills/05_dashboard_composition.md` | HTML 조립 규칙 |

## 작업 유형별 경로

### (A) 새 KPI 추가 요청
1. `01_analysis_rules.md` "핵심 KPI 정의" 표에 행 추가 → 수식·단위 명시
2. `investment-dashboard/scripts/metrics.py` 에 순수 함수로 구현
3. `webapp/app.js` 에 동일 공식 포팅
4. `compute_summary()` 반환 스키마에 키 추가
5. UI 노출이면 `03_visualization.md` + `05_dashboard_composition.md` 업데이트
6. `webapp_smoketest.js` 에 Python ↔ JS 교차 검증 추가

### (B) 새 차트 추가 요청
1. `03_visualization.md` 차트 카탈로그 표에 행 추가
2. 결정 트리에 분기 추가
3. `scripts/plotting.py` + `webapp/app.js` 양쪽에 `drawX` 구현
4. `05_dashboard_composition.md` 레이아웃 슬롯에 배치

### (C) 다른 나라 시장 / 통화 지원
1. `02_data_schema.md` 의 `region` / `asset_class` 허용값 확장
2. 벤치마크 자동 탐지 규칙 업데이트 (`SPY` / `KOSPI` / `NIKKEI` 등)
3. `01_analysis_rules.md` 거래일 수 (252/248/250) 재정의

## 절대 금지

1. **SSOT 우회 금지** — 문서에 없는 상수를 코드에 직접 박지 말 것. 반드시 문서 먼저 업데이트.
2. **LLM 자유 해석 금지 (인사이트)** — 인사이트 문장은 `04_insight_generation.md` 의 if-then 규칙만 사용. "시장 방향 예측", "매매 추천" 금지.
3. **문서 불일치 금지** — Python 구현과 JS 구현은 **같은 수식**. smoketest 의 Δ 가 0.005 를 넘으면 버그.
4. **타임스탬프 파일명 금지** — `outputs/` 는 항상 덮어쓰기 (`dashboard.html`, `analysis_report.md`, `kpi_summary.json`).
5. **외부 JS/CSS 번들 금지** — Plotly 만 CDN 허용. 다른 라이브러리 추가 시 PR 에서 논의.

## 검증 루틴 (변경 후 반드시 실행)

```bash
# 1. Python 참조 구현 재생성
cd investment-dashboard && python3 scripts/run_all.py

# 2. JS ↔ Python KPI 일치 검증
node webapp_smoketest.js
# 통과 기준: 모든 Δ < 0.005, 스트레스 시나리오 완전 일치

# 3. 웹앱 수동 스모크
cd webapp && python3 -m http.server 8080
# http://localhost:8080 → "샘플 데이터" 클릭 → 12 차트 렌더 확인
```

## 바이브코딩 흐름 (자연어 요청 → 대시보드)

사용자가 자연어로 요청하면 Claude 는 다음 순서를 따릅니다. 이 흐름 자체가 Skills.md 의 존재 이유입니다.

```
사용자: "이 CSV로 대시보드 만들어줘"
  ↓
Claude: (00_index 읽음) "어떤 문서가 관여하는지 결정"
  ↓
Claude: (02_data_schema 읽음) "Wide/Long 감지, 결측 처리 규칙 적용"
  ↓
Claude: (01_analysis_rules 읽음) "KPI 12 개 + 스트레스 5 개 계산"
  ↓
Claude: (03_visualization 읽음) "차트 12 개 선정, 색·레이아웃 결정"
  ↓
Claude: (04_insight_generation 읽음) "결정론 문장 생성"
  ↓
Claude: (05_dashboard_composition 읽음) "HTML 조립"
  ↓
산출물: dashboard.html + analysis_report.md + kpi_summary.json
```

Claude 가 마음대로 해도 되는 부분은 **"이 문서를 어떻게 읽고 순서를 결정할지"** 까지만. **수치·차트·문장은 문서 지배** — 이것이 본 프로젝트의 바이브코딩 철학.
