# Vcreation

A focused filmmaking workspace: plan a story, save your cast, approve shots, compare
takes, assemble a film, and keep clear cost records.

**Current release:** a local, single-user MVP. Start with labelled storyboard animatics
without provider charges. Optional paid video uses a configurable Replicate adapter;
it needs your own model settings, token and explicit opt-in. This is not a hosted
service or a promise of consistent AI actors across a finished drama.

## Start frontend and backend together

Requirements: Node.js 22+, Python 3.11+, FFmpeg and ffprobe on PATH. Run from the
repository root. Keep downloaded models, dependencies and actual `.env` files local.

```sh
python -m venv .venv
```

Install Python dependencies using the environment's Python:

```powershell
# Windows PowerShell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

```sh
# macOS / Linux
.venv/bin/python -m pip install -r requirements-dev.txt
cp .env.example .env
```

Then, on either platform:

```sh
npm --prefix frontend ci
npm run dev
```

Open **http://127.0.0.1:3000/studio**. Both services start from one command; Ctrl+C
stops them. Leave paid generation disabled while testing previews.

Choose **Try detective storyboard**, approve its three shots, review render costs,
render animatics, select takes, and export. This is 15 seconds of still boards with
silence, not realistic AI footage. Existing footage editing remains at `/video`.

## Checks

```sh
npm test
npm run lint
npm run build
```

For a production frontend build: `npm --prefix frontend run start`. Backend-only and
frontend-only development: `npm run dev:backend` and `npm run dev:frontend`.

## Documentation

- [Workflow, provider configuration, costs and limitations](docs/filmmaking-workflow.md)
- [Verification results and remaining work](docs/verification.md)
- [Existing backend/media tools](BACKEND.md)
- Interactive API docs: http://127.0.0.1:8000/docs

The optional account dashboard requires your own Supabase public configuration in
`frontend/.env.local` (see `frontend/.env.example`). The film studio needs no Supabase
connection. Backend authentication/private media isolation are not provided for
public multi-user hosting: keep this release local.
