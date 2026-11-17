# Writing Desk and reviewed production plans

Open `/write` to write locally without signing in. This route reads and saves only browser-local script and plan drafts; it does not request private projects or invoke AI while editing. Download a screenplay as UTF-8 text or a production plan as JSON for a separate copy. Local drafts are not cloud backups.

The plan editor supports a title, story/script, up to eight cast members, and up to twelve shots of two to fifteen seconds. Each shot includes visual direction, dialogue, duration and up to five cast assignments. Renaming a character updates existing shot references; removing a character clears those assignments. Shots can be reordered. Whitespace-only fields, duplicate names, orphan cast references and out-of-range durations are rejected before handoff.

The Film Assistant uses the same editable plan review. An assistant response can be downloaded, saved as a brief, or copied into the Writing Desk for revision without changing the original conversation. The desk can copy its current script into the assistant composer; a model request occurs only after the user sends it, and private assistant access still requires sign-in and AI credits.

Approving handoff calls the existing authenticated studio import. No project is created before that click. Failed sign-in leaves the local draft in place. Imported shots remain unapproved and the planning budget starts at zero; no media generation begins. Stable import identifiers allow an unchanged handoff to be retried without duplication; editing the plan clears that identifier so a revised plan is not silently replaced by an earlier import.

Verification: production build and lint; focused plan-reference and validation tests (`npm run test:review`); browser checks for public access without session requests, script and plan persistence, text download contents, cast rename and shot order, mobile overflow, explicit import payloads, and automated WCAG A/AA scans. Private handoff browser checks use mocked API responses; the backend import behavior was previously covered by transaction tests. No real AI generation or private user-data mutation was used for this change.
