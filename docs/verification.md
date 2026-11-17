# Verification and remaining work

## Verified in this change

- 14 automated tests passed, including an actual local FFmpeg preview → selection
  → MP4/SRT export flow and a mocked paid-provider HTTP contract.
- Frontend ESLint and production Next.js/TypeScript build passed.
- Chromium browser: create detective project → approve three shots → review $0
  costs → render three animatics → select takes → export MP4 → reload and preserve
  all three selections → hand selected clips to the existing editor.
- Browser run: no page errors or API failures. A 390-pixel viewport had no
  horizontal overflow. Initial desktop and mobile layouts were inspected.
- Existing footage editor: three selected preview clips were merged successfully.
  Its intermittent status-poll JSON-write race was found and repaired using atomic snapshots.
- No paid generation, account/database changes, deployment or model download.

The browser example is a 15-second animatic with still boards and silence. It does
not establish AI actor quality, dialogue performance or paid pilot cost. Exports
were validated with ffprobe. Provider dollar charges for local operations are $0;
local CPU/electricity/storage and engineering time have not been costed.

## Blocked or deferred

- Live Replicate generation: requires a funded token, selected model version and
  verified input mapping. Adapter tests use mocks; visual quality is unmeasured.
- Actual paid pilot cost and public customer prices: unknown until paid takes,
  retries and provider billing are measured/reconciled.
- Image generation, generated acting, voice/lip-sync studio and automatic identity
  validation: not implemented by the local animatic preview.
- Optional hosted Supabase account dashboard: no credentials or owned table/RLS
  configuration were used to test it. The local film studio works independently.
- Optional transcription/Demucs/music integrations: no models or paid jobs run.
- Public SaaS deployment, payments and multi-user privacy: deliberately not shipped.

This is a reviewable first filmmaking MVP, not parity with OpenArt.
