# 오늘의 일기 도우미

- 화면: GitHub Pages (`index.html`)
- AI 코치: Cloudflare Worker `diary-coach` (`worker.js`) → Google Gemini API (무료 등급)
- 주소: https://diary-coach.tuiumssaem.workers.dev/

## 설정 방법

1. **Gemini API 키 발급**: https://aistudio.google.com/apikey 에서 "Create API key"
2. **키 등록**: Cloudflare 대시보드 → Workers 및 Pages → `diary-coach` → 설정 → 변수 및 비밀 → 추가
   - 유형: 비밀(Secret), 이름: `GEMINI_API_KEY`, 값: 발급받은 키
   - (선택) `GEMINI_MODEL` = 기본값 `gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite` (앞 모델이 바쁘면 다음 모델로)
   - Worker 설정 → 런타임 → 배치는 **지역 / GCP / asia-northeast3(서울)** 로 둬야 해요. 기본값이면 Gemini가 "지원하지 않는 지역" 오류를 낼 수 있어요.
   - (선택) `ALLOWED_ORIGINS` = 기본값 `https://tuiumssaem-edu.github.io`
3. **코드 수정 시**: `worker.js`를 고친 뒤 Cloudflare의 `diary-coach` → 코드 편집에 붙여 넣고 배포

API 키는 Cloudflare에만 있고 GitHub 코드에는 들어가지 않아요.
