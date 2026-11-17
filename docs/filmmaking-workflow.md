# Filmmaking workflow and release limits

## Local, single-user MVP

The `/studio` workflow is: create project → save cast → add shots → approve
storyboard → review cost → submit take → select takes → reorder → export.
Changes to a shot reset its approval and selection; old takes stay in history.
Exports snapshot the selected takes, so later project changes do not rewrite films.

The bundled detective storyboard has three five-second shots. It is a **15-second
pipeline example**, not a generated dramatic performance or measured 60–90-second
AI pilot. Voice notes and references are direction, not identity/acting guarantees.

Local animatics use Pillow/FFmpeg to render labelled still boards and silence.
They do not synthesize actors, movement, lip sync or speech. Provider charges are
$0; hardware, electricity and storage costs are not included. MP4 assembly is
1280×720 at 24 fps. Source audio is preserved or silence added. The dialogue SRT
spans each shot; it is not word-aligned to spoken audio.

## Optional paid video

A real Replicate HTTP adapter submits one pinned model version, polls its prediction
ID, downloads a verified video, and stores a take. It is disabled by default. No
API token/paid render was used to verify this release: the provider contract was
tested with mocked HTTP plus real local media validation, not visual benchmarks.

Before opting in, inspect the selected version's current input schema:
<https://replicate.com/docs/reference/http>. Configure the backend `.env`:

- `REPLICATE_API_TOKEN`: server-only token, never a frontend public variable.
- `VCREATION_REPLICATE_VERSION`: pinned 64-character version hash.
- `VCREATION_VIDEO_USD_PER_SECOND`: your positive operator-supplied planning rate.
- `VCREATION_DURATION_FIELD`: model input field for seconds.
- `VCREATION_IMAGE_FIELD`: documented input field for actor references.
- `VCREATION_IMAGE_MODE`: `single` or `list`, matching that model's schema.
- `VCREATION_VIDEO_EXTRA_INPUT`: JSON for other required fields (ratio, resolution,
  etc.). No credentials: these parameters appear in the saved project manifest.
- `VCREATION_ENABLE_PAID_GENERATION=true`: explicit paid opt-in.

The model must support the requested 2–15-second duration and data-URI image inputs.
A single-image mapping rejects multiple actor images. Multiple images require a
documented list mapping. Outputs must be downloadable from Replicate's delivery
domain; other output schemas/hosts need an adapter extension. Do not guess a model
version or input mapping. FFmpeg/ffprobe must be on PATH.

Image generation was not implemented in the original backend and remains outside
this release. Upload approved actor references instead. Retired image/video routes
return HTTP 410 migration messages rather than fake "started" responses. New take
submissions use `/api/studio/shots/{id}/takes`.

## Estimates, charges and retries

All amounts are USD stored as integer millionths of a dollar. Quotes expire after
ten minutes and freeze shot/cast/model settings. A paid take atomically reserves
its estimate against the project's planning allowance. Repeated submissions with
the same request ID return the same job. Intentional new takes need new quotes.

**The planning allowance is not a hard cap on provider billing.** Actual charges
may depend on hardware time, resolution, rounding, audio or other settings. The
application never derives a supposedly measured charge from elapsed/output time.
Paid actuals remain unknown until a provider billing record is entered. Failed or
interrupted paid jobs keep reservations because billing may have occurred.

Use FastAPI's local interactive docs at `http://127.0.0.1:8000/docs` to call
`PUT /api/studio/jobs/{job_id}/billing` with `actual_usd` and `billing_reference`.
These are **operator-entered billing records**, not automatically verified invoices.
Reconciliation changes the reservation to the actual amount, even if above the
original allowance. CSV separates estimates, reservations and actuals; blank actual
means unknown. The UI and manifest report unreconciled paid jobs separately.

## Persistence and recovery

- SQLite: `storage/studio.sqlite3`; media/references: `static/studio/`.
- Back up both together. Runtime files and verification artifacts are ignored by Git.
- Use one backend process (`--workers 1`). Two render threads accept at most eight
  active jobs. This is not a distributed queue or horizontally scalable service.
- Startup marks unfinished jobs `interrupted` and does not resubmit them. Check the
  retained provider ID and billing before creating another paid take.
- No automatic media cleanup, cloud synchronization or restore UI is included.
- Cost CSV and project JSON are downloadable from the studio.

## Existing editor and optional services

`/video` accepts local video uploads without the optional account dashboard. The
multi-clip path uses every selected clip and honors 1–4 requested editing variants.
Variants are clean cuts, crossfades and subtle punch-ins, not generative style
transfer. Free-text notes are retained. The legacy single-source `clip_ref`
highlight path remains separate and requires the optional transcription model.

Optional faster-whisper/Demucs features need their own packages/model downloads.
They were not installed or exercised for this release. The existing music/lyric
tools can call paid services; do not run them as supposedly free tests.

Supabase is optional, configured in `frontend/.env.local`. No remote schema, RLS
policy, session or data was changed or verified. Account dashboard features require
your own `projects` table with appropriate ownership policies. Browser login does
not authorize the Python API. The local studio needs no Supabase connection.

## Public hosting is outside this release

The local API/media are shared with whoever can reach the server. Keep it local.
Public hosting requires backend authorization/ownership, private media, rate limits,
provider quotas, durable workers, payments/refunds and database migration strategy.
Enabling the existing sign-in UI does not provide those controls.

## Checks

`npm test` discovers only `tests/`; it does not run the original manual paid-service
scripts. Tests cover real FFmpeg preview/export, persistence, invalidation,
idempotency, budget reservations, billing reconciliation, restart handling,
references, paths, route uniqueness and multi-clip contracts. Provider HTTP is
mocked. `npm run lint` and `npm run build` check the frontend.
