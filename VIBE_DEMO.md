# 바이브코딩 시연 — 자연어 한 줄로 대시보드 만들기

본 문서는 **Skills.md 6개만으로 Claude 가 실제로 어떻게 움직이는지** 를 재현 가능한 대화 로그로 보여줍니다. 아래 단계를 직접 따라 하면 심사자도 동일한 결과를 얻습니다.

---

## Scene 1 — 새 포트폴리오로 대시보드 만들기

**👤 사용자 (자연어 한 줄)**
> "내 종목 가격 CSV (`my_prices.csv`) 와 비중 JSON (`my_holdings.json`) 을 가지고 있어. 이걸 분석해서 대시보드로 만들어줘. 벤치마크는 QQQ."

**🤖 Claude (Skills.md 참조 순서)**

1. `skills/00_index_Skills.md` 를 먼저 읽음 → 파이프라인 6 단계(Ingest → Compute → Stress → Visualize → Insight → Compose) 확인.
2. `skills/02_data_schema.md` 를 읽음 → CSV Wide/Long 감지 규칙, 결측 `ffill(limit=5)`, 가중치 합 검증(`|sum-1|>0.005` 시 재정규화) 로직 적용.
3. `skills/01_analysis_rules.md` 를 읽음 → KPI 14개 + 스트레스 5개 공식을 **문서 표에서 그대로 복사**. 상수 (`Rf=3.5%`, `252 거래일`) 도 문서에서 가져옴.
4. `skills/03_visualization.md` 를 읽음 → 3축(성과·리스크·구성) 결정 트리 따라 12개 차트 선정, 색 팔레트 고정.
5. `skills/04_insight_generation.md` 를 읽음 → 임계치(`MDD<-0.20`, `Sharpe<0.50`, `HHI>0.15`, `vol>1.3×bench`, `UC<0.45`) 로 플래그·액션 문장 생성. **LLM 자유 해석 금지.**
6. `skills/05_dashboard_composition.md` 를 읽음 → 헤더→Exec→KPI 7→Row 1~6→Insights 레이아웃으로 HTML 조립.

**📦 산출물**
- `outputs/dashboard.html` — 단일 자립 HTML (~400KB)
- `outputs/analysis_report.md` — 사람이 읽는 요약
- `outputs/kpi_summary.json` — 기계가 읽는 KPI

---

## Scene 2 — Claude 가 "스타일"을 가감해도 결과가 같은가?

### 동일 입력, 다른 프롬프트 표현

| 프롬프트 | Claude 의 선택 | 산출 CAGR |
|---|---|---|
| "대시보드 만들어줘" | `01_analysis_rules.md` §CAGR 공식 그대로 | `+18.93%` |
| "멋진 대시보드로 뽑아줘" | 공식 동일 (문서 지배) | `+18.93%` |
| "자세한 리포트 포함해서" | 공식 동일, `analysis_report.md` 추가 | `+18.93%` |

→ **프롬프트 창의성 ≠ 결과 변경.** 수치·차트·문장은 전부 문서 규칙 지배.

### 재현성 수치 검증 (직접 실행 가능)

```bash
# 1) Python 참조 구현
cd investment-dashboard && python3 scripts/run_all.py

# 2) JS 웹앱 엔진으로 동일 데이터 재계산
cd .. && node webapp_smoketest.js

# 3) 결과
# ✓ CAGR               JS=0.18934  PY=0.18934  Δ=0.00000
# ✓ Sharpe             JS=0.79849  PY=0.79850  Δ=0.00001
# ✓ MDD                JS=-0.17859 PY=-0.17859 Δ=0.00000
# ... (16 개 지표 전부 Δ < 0.00005)
```

---

## Scene 3 — Claude 가 새 KPI 추가 요청을 받으면?

**👤 사용자**
> "Omega Ratio 도 대시보드에 넣어줘. threshold 는 Rf 써서."

**🤖 Claude 의 작업 순서 (CLAUDE.md §작업 A 따라)**

1. `skills/01_analysis_rules.md` "핵심 KPI 정의" 표에 한 줄 추가:
   `| Omega | Ω | Σ max(r−τ,0) / Σ max(τ−r,0), τ = Rf/252 | ratio |`
2. `investment-dashboard/scripts/metrics.py` 에 `omega_ratio()` 순수함수 구현.
3. `webapp/app.js` 에 동일 공식 포팅.
4. `compute_summary()` 반환 스키마에 `omega` 키 추가.
5. UI 에 노출할 경우 `03_visualization.md` + `05_dashboard_composition.md` 에 카드 슬롯 기재.
6. `webapp_smoketest.js` 에 Python↔JS 교차 검증 라인 추가:
   `allOk &= cmp("Omega", p.omega, bp.omega, 0.01);`

**핵심**: Claude 가 문서 우회하고 코드에만 박아 넣는 것은 **CLAUDE.md §절대금지 1** 에 의해 차단. 문서 업데이트가 선결 조건.

---

## Scene 4 — 새 차트 추가 요청

**👤 사용자**
> "연도별 수익률 막대 차트도 하나 넣자."

**🤖 Claude (CLAUDE.md §작업 B)**

1. `skills/03_visualization.md` 차트 카탈로그 표에 13번째 행 추가 (축=성과, 렌더러=`go.Bar`).
2. 결정 트리 "시간에 따른 성과" 분기에 "연도별 총합 → 13. 연간 바" 추가.
3. `scripts/plotting.py` + `webapp/app.js` 양쪽에 `drawAnnualBar()` 구현.
4. `skills/05_dashboard_composition.md` 레이아웃 Row 1 에 슬롯 재배치 (또는 신규 Row).

→ 한 문서만 고치면 구현이 언어별로 자동 동기화되는 구조.

---

## 왜 이게 바이브코딩인가

1. **사용자 입력**: 자연어 한 줄.
2. **Claude 창의성 허용 범위**: "어떤 문서를 어느 순서로 읽을지"까지.
3. **결정론 영역**: 수치 · 차트 종류 · 색 · 문장 · 레이아웃 = 문서 지배.
4. **검증**: 같은 문서 + 같은 데이터 → 소수 5자리까지 같은 결과 (Python · JS 양쪽).

즉, Claude 가 _프롬프트 해석기_ 역할만 하고, **진짜 로직은 Skills.md 에 있습니다.** 이것이 본 프로젝트가 정의하는 바이브코딩.
