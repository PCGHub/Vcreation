# Connect the FastAPI backend

## Render account setup

Create a Render account at https://dashboard.render.com/register and connect it
to ChatGPT using the Render integration. Account sign-in and any billing entry
must be completed by the owner. Do not paste credentials in chat.

render.yaml prepares one Docker web service with a 1 GB persistent disk, one
instance and automatic deploys disabled. Its Starter instance and disk are paid;
check the current monthly quote in Render before creating the service. Nothing
has been provisioned or charged by adding this file. The source and Dockerfile
must first be published to an accessible GitHub branch; GitHub write access from
this session previously returned HTTP 403. Configure owner access protection
before making the shared workspace available to visitors.

## Current status

Vercel hosts the frontend. It has Supabase integration variables but no BACKEND_URL
or NEXT_PUBLIC_API_BASE_URL. No remotely hosted FastAPI service has been located.
Supabase is a database/auth/storage service; connecting it does not start this API.

The frontend now handles unavailable services, HTML error pages, malformed JSON,
and network failures with readable messages. It does not treat these errors as
successful empty project lists.

## Prepared Docker host

Dockerfile includes Python, FFmpeg/ffprobe and preview fonts. It copies backend
source only and excludes credentials, local databases, dependencies and media.
The image runs one Uvicorn worker as a non-root user. A persistent /data volume
holds both the SQLite database and every generated/uploaded media directory.
The mounted volume must be writable by UID 10001.

On a Docker-capable server:

    docker compose up -d --build

Compose binds port 8000 to localhost. Put it behind an HTTPS reverse proxy and
owner-only access control before exposing it. This remains a single shared
workspace; multi-user authentication and project isolation have not been added.
Do not horizontally scale or use a read-only/ephemeral disk. Back up /data.
Paid generation stays disabled. The image built successfully here. Container startup could not be verified because
the local Docker daemon ran out of disk space. No remote host was provisioned.
Docker Compose configuration validation passed. In an environment with a private
TLS proxy, the optional build_ca BuildKit secret can supply its trusted CA bundle
without disabling TLS verification.

## Connect Vercel once hosting is available

1. Confirm the HTTPS backend root returns the Vcreation running-status JSON.
2. Confirm /api/studio/capabilities and /api/studio/projects return JSON.
3. In the existing Vercel vcreation project, set server-side BACKEND_URL to the
   backend HTTPS origin, without a trailing /api. Keep NEXT_PUBLIC_API_BASE_URL
   unset to use the same-origin /api and /static rewrites. Do not enter credentials
   into a public NEXT_PUBLIC variable.
4. Rebuild/deploy the frontend: the rewrite destination is resolved during build.
5. Verify actual browser → Vercel → API → database flow, and create/reload a test
   project before treating the connection as complete.

A server-side access-control integration is also needed if the backend requires
authentication; a URL alone cannot bypass a login page. Do not turn off backend
authentication just to make a proxy request pass. Large uploads may need direct
storage uploads because the Vercel proxy has request-size limits.

To finish the connection, provide the backend HTTPS URL if a host exists, or
choose/connect a persistent Docker hosting account. No new paid hosting plan was
created during this work.
