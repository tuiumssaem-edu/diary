// 오늘의 일기 도우미 - AI 코칭 서버 (Cloudflare Workers + Gemini)
// Worker 설정 → 변수 및 비밀: GEMINI_API_KEY (비밀, 필수), GEMINI_MODEL (선택, 쉼표로 여러 개 = 순서대로 시도), ALLOWED_ORIGINS (선택, 쉼표로 구분)
const SYSTEM =
  '너는 특수교육 교사를 돕는 따뜻한 일기 코치다. 학생이 쓴 일기를 조금 더 풍부하게 다듬는다.\n' +
  '규칙:\n' +
  '1) 학생이 고른 사실(누가·언제·어디서·무엇을·기분)만 사용하고 새로운 사건·인물·장소를 지어내지 않는다.\n' +
  '2) 초등 저학년이 쓸 법한 쉬운 단어와 짧은 문장으로 쓴다. 어른스러운 표현, 한자어, 비유는 쓰지 않는다.\n' +
  '3) 전체 5문장 이내. 학생이 말한 범위 안에서 보이는 것, 들리는 것, 기분 중 한두 가지를 자연스럽게 덧붙인다.\n' +
  '4) 맞춤법과 띄어쓰기를 바로잡는다.\n' +
  '5) diary는 학생의 말투(~다 / ~요)를 그대로 유지한다.\n' +
  '6) feedback은 교사가 학생에게 말하듯 다정한 2~3문장: 잘한 점 하나를 칭찬하고, 다음에 해 볼 것 하나를 제안한다.\n' +
  '7) feedback은 학생 말투와 상관없이 반드시 해요체로만 쓴다. 모든 문장은 "요"로 끝나야 한다.\n' +
  '   좋은 예: "잘 썼어요.", "정말 멋져요!", "다음에는 소리도 써 보세요.", "더 멋진 일기가 될 거예요."\n' +
  '   나쁜 예(쓰지 말 것): "잘 썼어.", "멋지다!", "써 보렴.", "될 거야.", "해 봐.", "써 보자."\n' +
  '출력은 JSON 한 개만: {"diary":"...","feedback":"..."}';

// 문장이 모두 "요"로 끝나는지 확인 (끝의 문장부호·이모지는 무시)
const isHaeyo = t => {
  const s = String(t || '').split(/(?<=[.!?~])\s+|\n+/).map(x => x.replace(/[\s.!?~…"'”’)\]\p{Extended_Pictographic}️‍]+$/u, '')).filter(Boolean);
  return s.length > 0 && s.every(x => x.endsWith('요'));
};

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || 'https://tuiumssaem-edu.github.io')
      .split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const okOrigin = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    if (okOrigin) cors['Access-Control-Allow-Origin'] = origin;
    const json = (o, status = 200) => new Response(JSON.stringify(o), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return new Response('일기 도우미 연결 OK', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (request.method !== 'POST') return json({ ok: false, error: 'POST만 돼요' }, 405);
    if (!okOrigin) return json({ ok: false, error: '허용되지 않은 주소예요' }, 403);
    if (!env.GEMINI_API_KEY) return json({ ok: false, error: 'API 키가 설정되지 않았어요' }, 500);

    try {
      const d = await request.json();
      const draft = String(d.draft || '').slice(0, 2000);
      if (!draft.trim()) return json({ ok: false, error: '일기 내용이 비어 있어요' }, 400);
      const f = d.fields || {};
      const user = '날짜: ' + (d.date || '') + '\n날씨: ' + (d.weather || '') +
        '\n학생이 고른 내용: 누가=' + (f.who || '') + ', 언제=' + (f.when || '') + ', 어디서=' + (f.where || '') +
        ', 무엇을=' + (f.what || '') + ', 어떻게=' + (f.how || '') + ', 기분=' + (f.feel || '') +
        '\n학생의 일기:\n' + draft;

      // 앞 모델이 바쁘면(429/500/503) 다음 모델로 넘어가요
      const models = (env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite')
        .split(',').map(s => s.trim()).filter(Boolean);
      const ask = async (system, prompt, list) => {
        let r, j;
        for (const model of list) {
          r = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 4096 }
              }),
              signal: AbortSignal.timeout(25000)
            }
          ).catch(() => null);
          if (!r) continue;
          j = await r.json();
          if (r.ok || ![429, 500, 503].includes(r.status)) break;
        }
        if (!r) return { err: 'AI가 응답하지 않아요. 잠시 뒤에 다시 해 주세요.', status: 504 };
        if (!r.ok) {
          const busy = r.status === 429 ? '오늘 무료 사용량이 다 찼거나 너무 자주 눌렀어요. 잠시 뒤에 다시 해 주세요.' : '';
          return { err: busy || (j.error && j.error.message) || 'AI 호출 실패', status: 502 };
        }
        const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const m = parts.map(p => p.text || '').join('').match(/\{[\s\S]*\}/);
        if (!m) return { err: 'AI 답변을 읽지 못했어요', status: 502 };
        return { o: JSON.parse(m[0]) };
      };

      const res = await ask(SYSTEM, user, models);
      if (res.err) return json({ ok: false, error: res.err }, res.status);
      let feedback = res.o.feedback || '';
      // 반말이 섞이면 한마디만 해요체로 한 번 고쳐요 (실패하면 원래 글 그대로)
      if (feedback && !isHaeyo(feedback)) {
        const fix = await ask(
          '다음 글을 뜻은 그대로 두고 초등학생에게 말하는 다정한 해요체로 고친다. 모든 문장은 "요"로 끝나야 한다. 출력은 JSON 한 개만: {"feedback":"..."}',
          feedback, models
        ).catch(() => ({}));
        if (fix.o && fix.o.feedback) feedback = fix.o.feedback;
      }
      return json({ ok: true, diary: res.o.diary || '', feedback });
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 500);
    }
  }
};
