// Explicit, optional smoke check; never runs on ordinary builds.
import { generateText } from 'ai';
try {
  const result = await generateText({ model: process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4-mini', prompt: 'Reply with only READY.', maxOutputTokens: 1024, maxRetries: 0, abortSignal: AbortSignal.timeout(45000) });
  console.log('FILM_AI_SMOKE', JSON.stringify({ connected: !!result.text.trim(), inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }));
} catch (error) {
  const message = [error?.message, error?.cause?.message, error?.responseBody, error?.cause?.responseBody].filter(Boolean).join(' ');
  console.log('FILM_AI_SMOKE', JSON.stringify({ connected: false, activationNeeded: /credit|fund|payment|verification|budget|unauthorized|authentication|oidc|api.key/i.test(message), oidcPresent: !!process.env.VERCEL_OIDC_TOKEN, paymentRequired: /payment|credit.card|customer_verification/i.test(message), insufficientCredits: /insufficient|balance|no.credits|quota/i.test(message), authentication: /unauthoriz|authentication|api.key|oidc/i.test(message), status: error?.statusCode || error?.cause?.statusCode || null, kind: error?.constructor?.name || 'Error' }));
}
