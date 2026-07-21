export async function translate(text, targetLang, config) {
  const { apiUrl, apiKey, model } = config;
  const url = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetLang}. Only output the translation, no explanations or extra text. Preserve the original formatting including line breaks and paragraphs.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

export async function translateBatch(segments, targetLang, config) {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const joined = batch.map((s, idx) => `[${idx}] ${s}`).join('\n\n');

    const { apiUrl, apiKey, model } = config;
    const url = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate each numbered segment to ${targetLang}. Keep the [number] prefix for each segment. Only output translations, no explanations.`
          },
          { role: 'user', content: joined }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    const parsed = content.split(/\[\d+\]\s*/).filter(Boolean);
    results.push(...parsed);
  }

  return results;
}
