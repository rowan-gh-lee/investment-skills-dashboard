# Skills.md Bundle — Investment Dashboard

투자 데이터 분석 대시보드를 규칙 기반으로 재현 가능하게 만드는 **6개 Skills.md 문서**입니다.

## 문서 구성

| 파일 | 역할 | 대응 파이프라인 단계 |
|---|---|---|
| `00_index_Skills.md` | 전체 인덱스 · 흐름도 · vibe-coding narrative | 진입점 |
| `01_analysis_rules.md` | KPI 공식·상수·스트레스 시나리오 (SSOT) | ② Compute / ③ Stress |
| `02_data_schema.md` | Wide/Long 감지 · 컬럼 매핑 · 가중치 검증 | ① Ingest |
| `03_visualization.md` | 12 차트 카탈로그 · 팔레트 · 반응형 기준 | ④ Visualize |
| `04_insight_generation.md` | 결정론적 문장 템플릿 · 플래그 임계치 · 액션 | ⑤ Insight |
| `05_dashboard_composition.md` | HTML 레이아웃 · KPI 카드 스펙 · CSS 토큰 | ⑥ Compose |

## 사용 방식

1. **문서가 SSOT** — 모든 상수(Rf=3.5%, MDD 경고 −20%, Sharpe 경고 0.5, HHI 경고 0.15 등)는 문서에 고정.
2. **구현체는 복사만** — Python(`investment-dashboard/scripts/`)과 JS(`webapp/app.js`)가 같은 공식을 구현하며, 양쪽 결과는 소수 5자리까지 일치해야 함 (프로젝트에서 검증됨).
3. **확장 절차** — 각 문서 하단에 "새 KPI / 차트 / 시나리오 추가" 절차가 3~4단계로 명시.

## 참조 구현

- Python: `investment-dashboard/scripts/run_all.py` → `outputs/` 에 HTML·MD·JSON 3개 산출
- JavaScript: `webapp/index.html` + `app.js` → 단일 페이지 웹앱, 업로드 지원

## 재현성 검증

`webapp_smoketest.js` (Node) 는 동일 샘플 데이터에 대해 JS 구현이 Python 기준선과 일치함을 확인합니다.

```
$ node webapp_smoketest.js
✓ CAGR               JS=0.18934  PY=0.18934  Δ=0.00000
✓ Sharpe             JS=0.79849  PY=0.79850  Δ=0.00001
✓ MDD                JS=-0.17859 PY=-0.17859 Δ=0.00000
... (16개 지표 모두 통과)
✓ smoke test PASSED
```

## 라이선스

MIT — 각 문서의 YAML frontmatter 참조.
