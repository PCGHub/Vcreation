# Pilot QA remediation

The pilot uses one consistent workspace for brief planning, studio, editing, history and sign-in. Planning explicitly saves briefs rather than promising conversational AI or image generation. Lavender primary actions, readable controls, compact project selection, smaller headings, and a scrollable sidebar replace the oversized layouts.

Drafts persist in this browser across navigation and reloads. Deleting a brief offers Undo. Uploaded footage is limited to 4 MiB per file through the current hosted gateway; direct-to-storage uploads are a future improvement. Editing keeps every selected clip and supports one to three clean, crossfade or punch-in versions. Notes are saved metadata, not AI instructions.

Production is an owner-only pilot. The frontend exchanges a Supabase-verified, email-confirmed owner session for a secure HttpOnly cookie. The backend independently verifies the token with Supabase and restricts all API and media routes to VCREATION_OWNER_EMAILS. The public root remains a health check. Existing SQLite projects and media are retained. This is not multi-user isolation: customer accounts require a separate ownership and storage design before opening access.

Required production settings: VCREATION_REQUIRE_AUTH=true, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, VCREATION_OWNER_EMAILS, and VCREATION_ALLOWED_ORIGINS on Render; the existing public Supabase settings and matching VCREATION_OWNER_EMAILS on Vercel. No service-role key is used. Paid generation remains disabled.

Verification: backend access denial/owner/CSRF/provider-failure tests; session-route validation and cookie tests; real two-clip FFmpeg render of all three editing styles; mixed studio/editor history; browser draft persistence, Undo, upload errors and access gates; automated WCAG A/AA scans of six pages; 320x568 and 1280x600 navigation checks; lint and production build. Browser owner sessions are mocked for reproducibility. Actual owner sign-in must be confirmed by the owner without sharing credentials.
