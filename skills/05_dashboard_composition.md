---
name: investment-dashboard-composition
description: Use this skill whenever assembling the final investor dashboard HTML — fixed layout (header → exec summary → 7 KPI cards → 6 figure rows → insights → footer), embedded Plotly via CDN, single self-contained .html output plus markdown report plus JSON KPI dump. Ensures deployable-anywhere output.
version: 1.0.0
license: MIT
---

# 05 · 대시보드 조립 규칙 Skills.md

본 문서는 **최종 산출물 HTML**의 레이아웃·CSS·출력 규약을 고정합니다. 이 문서의 레이아웃을 따르면 어떤 포트폴리오든 동일한 시각적 일관성으로 렌더됩니다.

## 출력 파일 규약

`outputs/` 아래 **정확히 3개 파일**:

```
outputs/
├── dashboard.html          # 단일 자립 HTML (Plotly via CDN)
├── analysis_report.md      # 사람이 읽는 해설 리포트
└── kpi_summary.json        # 기계가 읽는 KPI 원시값
```

- 파일명에 **타임스탬프 금지**. 재실행은 덮어쓰기.
- HTML은 외부 JS/CSS 번들 금지. Plotly는 **CDN one-liner**만 허용.
- 폰트는 Pretendard CDN 링크로 통일.

## HTML 레이아웃 (고정)

```
┌─────────────────────────────── 헤더 ────────────────────────────────┐
│ 제목 / 분석기간·거래일·벤치·포지션수·생성시각 / 자산군 pill          │
├────────────────────── Executive Summary 밴드 ──────────────────────┤
│ 한 문장 요약 (04의 첫 인사이트)                                       │
├──────────────────────── KPI 카드 (7개) ─────────────────────────────┤
│ 누적·CAGR·연변동성·Sharpe·MDD·VaR/CVaR·α(β·IR)                       │
├────────────── Row 1 (1.6fr : 1fr) 성과 ────────────────────────────┤
│ [1 누적수익률]                         [2 월별 히트맵]                │
├────────────── Row 2 (1.15fr : 1fr) 리스크 ─────────────────────────┤
│ [3 Underwater vs 벤치]                 [4 분포 + VaR/CVaR]            │
├────────────── Row 3 (1fr : 1fr) 롤링 지표 ─────────────────────────┤
│ [5 롤링 Sharpe·Beta]                   [6 60일 이동 변동성]           │
├────────────── Row 4 (1.15fr : 1fr) 스트레스 ───────────────────────┤
│ [7 스트레스 바]                         [스트레스 표 패널]            │
├────────────── Row 5 (1.15fr : 1fr) 상관·자산군 ────────────────────┤
│ [8 상관 히트맵]                         [9 자산군 바]                 │
├────────────── Row 6 (1:1:1) 구성 3종 ──────────────────────────────┤
│ [10 섹터 도넛]   [11 지역 Treemap]   [12 Top10 종목]                  │
├────────────────── 핵심 인사이트 패널 ──────────────────────────────┤
│ 📈 성과 / 🛡 리스크 / 🧩 구성 / 🌪 스트레스 / ⚠︎ 플래그 / ✅ 제안      │
├────────────────────────── Footer ──────────────────────────────────┤
│ 버전 · 배포 정보                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## KPI 카드 사양 (7장)

| 카드 | 값 | 부제(sub) | 톤 규칙 |
|---|---|---|---|
| 누적수익률 | `total_return` % | 벤치 같은 기간 % | `cagr≥0→pos, else neg` |
| CAGR | `cagr` % | 벤치 CAGR % | same |
| 연환산 변동성 | `ann_vol` % | 벤치 변동성 % | 중립 |
| Sharpe | `sharpe` | `Sortino sortino` | `≥1 pos, 0.5~1 warn, <0.5 neg` |
| MDD | `mdd` % | `peak → trough` | `< -0.15 neg else warn` |
| VaR/CVaR 95% | `VaR/CVaR %` | "일간 기준(역사적)" | neg (고정) |
| Alpha vs bench | `alpha` % | `β ratio · IR ratio` | `α>0 pos else neg` |

벤치마크가 없으면 마지막 카드 자리에 **HHI(집중도)** 로 대체.

## CSS 토큰 (변경 금지)

```css
:root {
  --bg:      #f4f6fb;
  --card:    #ffffff;
  --border:  #e4e7ee;
  --ink:     #0f172a;
  --muted:   #64748b;
  --accent:  #2E86AB;
  --pos:     #2A9D8F;
  --neg:     #E76F51;
}
```

## 헤더 그라디언트

```css
background: linear-gradient(135deg, #0f3b6b 0%, #2E86AB 50%, #3fa7c4 100%);
padding: 24px 32px 64px;  /* 하단 여유 → Executive Summary 밴드가 겹쳐 들어옴 */
```

Executive Summary 밴드는 `margin-top: -40px`로 헤더에 **반쯤 겹쳐서** 등장 — "떠 있는 카드" 효과.

## Plotly 포함 규칙

```python
# 첫 figure만 CDN-include 플래그, 나머지는 body만
include_plotlyjs="cdn" if is_first else False
full_html=False
config={
  "displaylogo": False,
  "responsive": True,
  "modeBarButtonsToRemove": ["lasso2d", "select2d"],
}
```

→ HTML 파일 하나로 1개 `<script src="plotly...cdn">` + 12개 Figure div.

## 반응형 브레이크포인트

```css
@media (max-width:1280px) { .kpi-grid { grid-template-columns:repeat(4, 1fr); } }
@media (max-width:1024px) {
  .kpi-grid { grid-template-columns:repeat(2, 1fr); }
  .row.row-2, .row.row-2b, .row.row-2-wide, .row.row-3 { grid-template-columns:1fr; }
}
@media (max-width:640px) {
  /* 모바일 — KPI 2열, 컨트롤 축소, 카드 패딩 축소, 차트 min-height=240 */
  .kpi-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .kpi-card { min-height: 78px; padding: 10px 12px; }
  .fig { min-height: 240px; }
}
```

## UX 필수 기능 (대시보드 완성도)

| 기능 | 규칙 | 이유 |
|---|---|---|
| KPI hover 툴팁 | 각 카드에 `01_analysis_rules.md` 공식 문자열 그대로 노출. `KPI_DEFS` 객체가 SSOT 미러. | 심사자가 "이 숫자가 뭐지?" 할 때 즉답. 문서 SSOT 가 UI 까지 관통. |
| 벤치마크 프리셋 드롭다운 | SPY / QQQ / VT / KOSPI / NIKKEI / SHCOMP / BND 기본 제공 + 직접 입력 병행. | 1클릭 비교, 타이핑 없이 국가/시장 교체. |
| 다크 모드 토글 | `html[data-theme="dark"]` 변수 오버라이드. localStorage 저장. | 장시간 분석·프레젠테이션 편의. |
| 토스트 알림 | `alert()` 금지. `#toast-root` 에 `.toast.{info,success,warn,error}` 삽입 → 4초 후 자동 제거. | 비차단 UX, 대시보드 흐름 끊지 않음. |
| 키보드 단축키 | `P` = PDF, `S` = 샘플, `D` = 다크. input/select 포커스 중이면 동작 안 함. | 반복 작업 생산성. |
| 차트 캡션 | 모든 차트 카드에 `.caption` 1줄 — "무엇을 읽어야 하는가". | 해석 가이드, 심사자 가독성. |

## 실용성 기능 (현장 운용)

실제 분석가·심사자가 대시보드를 **반복 사용**할 수 있도록 다음 기능을 고정합니다. 모든 설정은 `localStorage` 세션 키 `investment-dashboard-session-v1` 에 직렬화됩니다.

| 기능 | 규칙 | 이유 |
|---|---|---|
| Rf 입력 | `#rf-input` (number, step 0.005, 0~1). 변경 시 `computeAll(..., rf)` 자동 재호출, Sharpe/Sortino/Alpha 재계산. 기본 `DEFAULT_RF = 0.035`. | 금리 환경·통화별로 무위험 수익률 가정이 달라짐. 값을 바꾸고 즉시 Sharpe/α 변동을 관찰하는 것이 실전 분석가 워크플로. |
| 포트폴리오 명 | `#portfolio-name` — 헤더 `#header-title` 와 `analysis_report.md` 첫 줄에 반영. | 다중 포트폴리오 비교 시 어떤 분석인지 즉시 식별. |
| 세션 영속화 | `SESSION_FIELDS = [benchmark, rf, portfolioName, dateFrom, dateTo, topN]` 를 모든 핸들러에서 `saveSession()` 호출. 새로고침 후 복원 배너 4초 노출. | 브라우저를 닫았다 열어도 설정이 유지되어야 실용. |
| 세션 초기화 | `#btn-reset-session` — `localStorage.removeItem(SESSION_KEY) + removeItem("theme")` 후 reload. | 클린 상태로 돌아갈 수 있어야 재현 가능. |
| KPI 클릭→클립보드 | `.kpi-value` 클릭 시 `navigator.clipboard.writeText` + success 토스트. `cursor: copy` 로 affordance 제공. | 수치를 슬랙/이메일에 복사하는 경우가 많음. 선택 후 Cmd+C 보다 빠름. |
| 입력 템플릿 다운로드 | `#btn-template` → `prices.csv`, `holdings.json`, `README.md` 3개 파일. Wide/Long 규칙과 필수/선택 컬럼을 예시로 포함. | 업로드 전 포맷 오류 제거, 첫 사용자 진입 장벽 해소. |
| Rf 검증 | 0~1 범위 밖 또는 NaN 입력 시 복원 + error 토스트. | 잘못된 값이 전체 KPI를 무효화하지 않도록 방어. |

## 해설 패널 (하단)

- 배경 `#fff9ea`, 테두리 `#f0dba5` — 노란 탑포인트.
- 제목: "핵심 인사이트 · 리스크 플래그 · 실행 제안".
- `<ul>`에 `04_insight_generation.md`의 모든 문장을 순서대로 삽입.

## Markdown 리포트 구조 (`analysis_report.md`)

```
# {portfolioName ? portfolioName + " · " : ""}포트폴리오 분석 리포트

- 기간: YYYY-MM-DD ~ YYYY-MM-DD (거래일 N일)
- 벤치마크: XXX
- 무위험 수익률 (Rf): X.XX%
- 포지션 수: N

## 한 줄 요약
{첫 인사이트, HTML 태그 제거}

## 성과 · 리스크 지표
{KPI 표 — 포트 / 벤치 2열}

## 리스크 진단
{MDD 구간 / Sharpe 판정 / HHI 판정 / VaR·CVaR 비율}

## 스트레스 시나리오
{시나리오별 손익 표}

## 포트폴리오 구성
{섹터·자산군·Top 5 종목 표}

## 실행 제안 (규칙 기반)
{액션만 추출하여 번호 매김}

## 핵심 인사이트
{전 인사이트 bullet}
```

## JSON 덤프 (`kpi_summary.json`)

`01_analysis_rules.md`의 **Summary 반환 스키마**와 1:1 동일. 다른 도구(Slack 봇, Excel, 2차 분석 스크립트)에서 재사용 가능.

## 배포 포맷

- **단일 파일 HTML**: 심사자가 바로 브라우저로 확인 가능 (외부 파일 의존 없음).
- **GitHub Pages / Vercel / Netlify**: `outputs/dashboard.html`만 업로드하면 끝.
- **Docker** (옵션): nginx:alpine에 `outputs/` 디렉터리 마운트.
- **이메일 첨부**: 파일 크기 일반적으로 < 5MB. 압축 시 < 1MB.

## 품질 체크 (반드시 통과)

```
✓ Plotly 로드 스크립트는 정확히 1회만 등장
✓ 12개 figure div 전부 렌더 가능한 JSON 포함
✓ KPI 7장, 정의된 톤 규칙 준수
✓ Footer 버전 문자열 일치
✓ 반응형 640/1024/1280px 브레이크포인트에서 레이아웃 붕괴 없음
✓ analysis_report.md / kpi_summary.json 병행 생성
✓ 모든 KPI 카드 hover 툴팁에 01_analysis_rules 공식 표시
✓ alert() 0회 사용 — 오류는 전부 토스트
✓ 다크 모드 토글 시 KPI·차트 텍스트 가독성 유지
✓ Rf 입력 변경 시 Sharpe·Sortino·Alpha 즉시 재계산 (재로딩 불필요)
✓ benchmark·rf·portfolioName·dateRange·topN 은 localStorage 에 자동 저장/복원
✓ KPI 카드 클릭 시 클립보드 복사 + 성공 토스트 노출
✓ "⬇ 템플릿" 버튼은 prices.csv · holdings.json · README.md 3개 파일을 순차 다운로드
```

## 확장 포인트 (선택)

- **PDF 내보내기**: `dashboard.html` → Playwright `page.pdf()` → `report.pdf`.
- **다중 포트폴리오 비교**: 헤더 아래 탭바 추가, 각 탭이 하나의 `compute_summary` 결과.
- **실시간**: 헤더 우측에 "갱신됨 { HH:mm }" 배지, WebSocket 옵션.
- **인쇄 스타일**: `@media print`로 figure를 vectorize한 PNG fallback 제공.

이 문서를 지킨 모든 산출물은 **시각·구조적으로 동일**합니다. 내용(= 데이터)만 달라집니다.
