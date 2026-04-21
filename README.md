# Investment Skills Dashboard

투자 데이터 기반 자동 분석 대시보드 · Hackathon 제출물

## 한 줄 요약

Skills.md 규칙만 있으면 누구의 포트폴리오든, 어떤 포맷의 데이터든 같은 품질로 재현되는 분석 시스템.

## 구성

```
투자-데이터-시각화/
├─ skills/                      # [제출물 b] 6개 Skills.md 문서
│   ├─ 00_index_Skills.md
│   ├─ 01_analysis_rules.md     # KPI 공식·임계치·스트레스 SSOT
│   ├─ 02_data_schema.md        # 데이터 포맷 매핑
│   ├─ 03_visualization.md      # 12 차트 규칙
│   ├─ 04_insight_generation.md # 결정론적 인사이트 문장
│   └─ 05_dashboard_composition.md  # HTML/CSS 레이아웃
├─ webapp/                      # [제출물 c] 배포용 웹앱
│   ├─ index.html
│   ├─ app.js                   # 클라이언트 사이드 분석 엔진
│   └─ data/                    # 샘플 데이터
├─ investment-dashboard/        # 파이썬 참조 구현
│   ├─ scripts/
│   │   ├─ generate_sample_data.py
│   │   ├─ metrics.py
│   │   ├─ plotting.py
│   │   ├─ build_dashboard.py
│   │   └─ run_all.py           # 메인 엔트리포인트
│   └─ outputs/                 # dashboard.html · analysis_report.md · kpi_summary.json
├─ case-studies/                # 3개 대비되는 포트폴리오 실행 결과 (범용성 증거)
│   ├─ A_balanced_holdings.json
│   ├─ B_tech_concentrated_holdings.json
│   ├─ C_defensive_bond_holdings.json
│   ├─ outputs/{A,B,C}/         # dashboard·리포트·JSON 각각
│   └─ README.md                # 비교표 + 결정론 관찰
├─ skills/evals/                # Skills.md 스킬당 3개씩 트리거·거부 eval
│   └─ README.md
└─ submission/                  # [제출물 a] 기획서 PDF + zip
    ├─ 기획서.pdf
    └─ skills_bundle.zip
```

## 빠른 시작

### 웹앱 (브라우저만 있으면 됨)

```bash
cd webapp
python3 -m http.server 8080
# http://localhost:8080 접속 → "샘플 데이터" 클릭
```

또는 단순히 `webapp/index.html`을 브라우저에서 열기. 업로드 UI에서 사용자 CSV/JSON도 지원합니다.

### Python 참조 구현

```bash
cd investment-dashboard
pip install pandas numpy plotly
python3 scripts/run_all.py
# → outputs/dashboard.html · analysis_report.md · kpi_summary.json
```

## 배포

- **GitHub Pages**: `webapp/` 폴더만 push → 자동 배포
- **Vercel / Netlify**: `webapp/` 을 드래그 앤 드롭
- **이메일 첨부**: `dashboard.html` 단일 파일 (~400KB) 첨부

## 검증

JS 클라이언트와 Python 구현이 소수 5자리까지 동일 KPI를 산출함을 확인:

```
$ node webapp_smoketest.js
✓ CAGR   JS=0.18934  PY=0.18934
✓ Sharpe JS=0.79849  PY=0.79850
✓ MDD    JS=-0.17859 PY=-0.17859
... 16개 지표 모두 통과
```

## 케이스 스터디 — 범용성 증거

같은 가격 시계열·같은 엔진으로 **성격이 대비되는 3개 포트폴리오**를 돌려 결과를 비교 가능하게 했습니다.

| 케이스 | 구성 | CAGR | Vol | Sharpe | MDD | β | HHI |
|---|---|---:|---:|---:|---:|---:|---:|
| A. 분산형 | 주식52·채권35·대체13 | +14.82% | 9.35% | 1.01 | −10.74% | 0.47 | 0.099 |
| B. 기술주 집중 | 빅테크 5종 78% | +29.70% | 25.01% | 0.81 | −26.74% | 1.28 | 0.157 |
| C. 방어적 채권 | 채권 65%·대체 18% | +10.91% | 5.51% | 1.15 | −4.71% | 0.16 | 0.246 |

전체 KPI 비교와 재현 방법은 [case-studies/README.md](case-studies/README.md) 참조.

## 핵심 설계

**SSOT 원칙** — 모든 상수(Rf=3.5%, MDD 경고 −20%, Sharpe 경고 0.5, HHI 경고 0.15 등)는 `01_analysis_rules.md`에만 정의. 구현 코드는 문서를 복사할 뿐.

**결정론 원칙** — 인사이트·플래그·액션은 LLM 추론 없이 if-then 규칙으로만 생성. 같은 데이터는 같은 문장을 만듦.

**범용성** — Wide/Long CSV 자동 감지 · 컬럼명 유연 매핑 · 가중치 자동 재정규화 · 통화 혼재 경고.

## 스킬 Evals

Anthropic 공식 Agent Skills 베스트 프랙티스에 따라 6개 스킬 각각에 대해 **트리거 정확도 · 결정론 · 금지 항목 거부** 3개씩 총 18개의 eval 시나리오를 `skills/evals/`에 정의. 새 모델로 업그레이드할 때마다 이 eval 을 돌려 스킬 발견율·결정론 퇴행 여부를 점검하도록 설계.

## 제작

Rowan Lee · 2026-04-20 · v1.0
