// Explicit, optional smoke check; never runs on ordinary builds.
import { generateText } from 'ai';
try {
  const result = await generateText({ model: process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4-mini', prompt: 'Reply with only READY.', maxOutputTokens: 1024, maxRetries: 0, abortSignal: AbortSignal.timeout(45000) });
  console.log('FILM_AI_SMOKE', JSON.stringify({ connected: !!result.text.trim(), inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }));
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.log('FILM_AI_SMOKE', JSON.stringify({ connected: false, activationNeeded: /credit|fund|payment|verification|budget|unauthorized|authentication|oidc|api.key/i.test(message), kind: error?.constructor?.name || 'Error' }));
}
