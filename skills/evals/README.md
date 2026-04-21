# Skills Evals

Anthropic 공식 Agent Skills 베스트 프랙티스에 따라, 각 스킬의 발견·트리거·결정론 검증을 위한 평가 시나리오를 스킬당 3개씩 정의합니다.

## 구성

| 파일 | 대상 스킬 | 평가 초점 |
|---|---|---|
| `investment-skills-index.json` | 파이프라인 진입점 | 트리거 정확도 (한/영/비관련) |
| `investment-analysis-rules.json` | KPI SSOT | 수식 재현성, Rf override, 금지 항목 거부 |
| `investment-data-schema.json` | 데이터 정규화 | Wide/Long 감지, 결측 기본값, 가중치 재정규화 |
| `investment-visualization.json` | 차트 선택 | 카탈로그 커버리지, 이중축 금지, 팔레트 일관성 |
| `investment-insight-generation.json` | 결정론 문장 | if-then 재현, 시장 예측 거부, 매매 추천 거부 |
| `investment-dashboard-composition.json` | HTML 조립 | 고정 레이아웃, self-contained, 세션 영속화 |

## 스키마

각 eval 은 다음 필드를 가집니다 (Anthropic 공식 포맷):

```jsonc
{
  "skills": ["skill-name"],       // 트리거 대상 스킬 (첫 요소)
  "query": "...",                  // 사용자 발화
  "files": ["path/to/input"],      // 입력 파일 (선택)
  "expected_behavior": [           // 검증 가능한 행동 목록
    "...",
    "..."
  ]
}
```

본 레포에서는 `skill`(단일) + `purpose` + `evals[]` 집합형으로 확장하여 스킬별 목적과 3개 시나리오를 한 파일에 묶었습니다.

## 실행 방법

Anthropic 은 아직 공식 런너를 제공하지 않으므로, 본 eval 은 **설계 체크리스트** 로 동작합니다:

1. 새 모델 (Haiku/Sonnet/Opus) 에서 각 쿼리를 실제로 실행
2. `expected_behavior` 의 각 항목이 충족되는지 수동 확인
3. 실패 항목은 해당 SKILL.md 의 description 을 "pushy" 하게 수정 (키워드·트리거 조건 강화)

## 왜 만들었는가

공식 베스트 프랙티스 문서 (`platform.claude.com/docs/ko/agents-and-tools/agent-skills/best-practices`) 의 다음 권고에 대응:

- **"평가 먼저 구성"** — "광범위한 문서 작성 전에 평가를 생성하세요"
- **"최소 3개의 평가"** — 체크리스트 항목
- **"undertriggering 방지"** — description 반복 개선 근거 확보

본 파일들은 본 프로젝트 Skills.md 패키지가 **재현 가능하게 트리거·거부·계산** 되는지 외부에서 검증하는 공개 테스트 세트입니다.
