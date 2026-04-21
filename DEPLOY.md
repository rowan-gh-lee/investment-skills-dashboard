# 배포 가이드 — GitHub Pages

`webapp/` 정적 번들은 **빌드 단계가 없는 순수 HTML/JS** 이므로, GitHub Pages 에 그대로 올리면 됩니다. 본 프로젝트는 **`.github/workflows/deploy.yml` 이 이미 포함** 되어 있어서, `main` 브랜치에 `webapp/**` 변경을 푸시하면 자동 배포됩니다.

## 최초 배포 절차 (심사자 기준 약 3분)

```bash
# 1. 프로젝트 루트에서 Git 초기화
cd "투자 데이터 시각화"
git init
git add .
git commit -m "Initial: investment-skills-dashboard"

# 2. GitHub 리포지토리 생성 & 푸시
#   https://github.com/new 에서 <username>/investment-skills-dashboard 생성
git branch -M main
git remote add origin https://github.com/<username>/investment-skills-dashboard.git
git push -u origin main

# 3. GitHub Pages 활성화 (GitHub UI)
#   Settings → Pages → Source: "GitHub Actions" 선택
#   (첫 푸시 직후 workflow 가 자동 실행되며, 2~3분 후 URL 노출)

# 4. 배포된 URL 확인
#   https://rowan-gh-lee.github.io/investment-skills-dashboard/
#   또는 Actions 탭에서 deploy 완료 시 링크 확인
```

## 워크플로우 구조

`.github/workflows/deploy.yml` 요약:

| 트리거 | 동작 |
|---|---|
| `push` to `main` (webapp/** 경로) | 자동 배포 |
| `workflow_dispatch` (수동) | Actions 탭 → Run workflow |

배포 아티팩트는 `webapp/` 전체 (index.html · app.js · data/ · fx_rates.json).

## 로컬 검증 (푸시 전)

```bash
cd webapp
python3 -m http.server 8080
# 브라우저 → http://localhost:8080
#   · "샘플 데이터" 버튼 → 12 차트 렌더 확인
#   · "파일 업로드" → 사용자 CSV/XLSX/JSON 업로드 확인
#   · "🖨 PDF" → 인쇄 미리보기 A3 레이아웃 확인
```

## CI 없이 수동 배포 (대안)

GitHub Actions 를 쓰고 싶지 않을 때:

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: `main` · Folder: `/webapp` 선택
3. 저장 → 몇 분 후 `https://<username>.github.io/<repo>/` 에 webapp 직접 서빙

이 경우 `webapp/` 가 레포 루트가 아니므로 GitHub Pages 가 `/webapp/` 경로로 접근 가능하게 매핑합니다. (Actions 방식이 더 깔끔해서 본 프로젝트의 기본값은 Actions.)

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 404 Plotly / PapaParse | CSP 블록 | 기본값은 CDN 허용. `webapp/index.html` 의 `<script src>` 확인 |
| "샘플 데이터" 로드 실패 | `data/` 경로 미포함 | `webapp/data/` 전체 포함되었는지 확인 (artifact path 가 `webapp` 이면 자동 포함) |
| 차트 미렌더 | JS 콘솔에 에러 | DevTools → Console 확인. 대부분 데이터 스키마 문제 |

## 배포 URL 기재 위치 (제출 시)

- 기획서.pdf 6페이지 "제출 산출물" 표의 "필수 (c) 배포 URL" 행
- 해커톤 제출 폼의 URL 필드

**최종 URL**: `https://rowan-gh-lee.github.io/investment-skills-dashboard/`

## 현재 로컬 상태 (2026-04-21)

- `.git/` 초기화 완료, `main` 브랜치에 초기 커밋 (`ac1fca6`) 생성됨
- `origin` 원격: `https://github.com/rowan-gh-lee/investment-skills-dashboard.git`
- 푸시만 남음

```bash
# Rowan 님 로컬 터미널에서 실행 (단 1회)
cd "투자 데이터 시각화"
git push -u origin main
```

푸시 후:
1. `https://github.com/rowan-gh-lee/investment-skills-dashboard` 로 이동
2. **Settings → Pages → Source: "GitHub Actions"** 선택
3. Actions 탭에서 "Deploy webapp to GitHub Pages" 워크플로우가 녹색 체크되면 완료
4. URL: **https://rowan-gh-lee.github.io/investment-skills-dashboard/**
