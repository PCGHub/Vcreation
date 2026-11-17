# Authentication audit — 17 November 2026

## Verified deployment findings

- Vcreation's main production URL reaches its own Next.js session handler. Cross-origin rejection is distinct from Supabase token rejection. The alternate long Vercel alias can return Vercel deployment protection instead; use https://vcreation.vercel.app for account access.
- The configured production owner email matches the intended owner. The configured Supabase project responds to its settings endpoint with email/password login enabled.
- Existing runtime logs showed session requests reaching production, but had no application-level rejection reasons. They could not establish why the owner's actual token was rejected.
- The connected Supabase management account does not list Vcreation's configured project. No owner account record, password, confirmation state or real JWT was inspected. The audit did not reset passwords, confirm emails, disable access controls or obtain a service-role credential.

## Code defects corrected

The browser gate and login page were using different authorities: login could accept the server cookie while the gate preferred the browser's saved Supabase token. An old browser token could reject a valid server sign-in, causing a login/studio loop. Server verification is now authoritative; browser credentials are used only to repair a missing or rejected cookie. The repaired cookie is checked again before granting access. Supabase still independently validates every token; no client claims grant access.

The earlier concurrent response race was real but did not establish the cause of this owner's failed login. Identity-provider/network/configuration failures were also being collapsed into an expired-session message, and a failed session exchange could call global Supabase sign-out. The audit separates service failures, rejected tokens, unconfirmed email, owner mismatch, cookie persistence and origin failures. Transient verification failures no longer globally sign the account out.

## Evidence and verification

Focused Node tests cover authoritative cookies, stale browser tokens, serial repair, actual cookie retention checks, missing sessions, provider outages, owner restrictions, CSRF/origin checks and secure cookie flags. Browser tests use a mocked identity provider and actual browser cookie handling to check full login, tool navigation, reload and clear errors when cookies are unavailable. They do not establish a real owner login.

Session endpoints now emit safe `vcreation-auth` stage codes and return support codes. Logs contain no password, token, cookie, email address or raw provider payload. After a real owner attempt, these logs can distinguish SESSION_CREATED / SESSION_VERIFIED from TOKEN_REJECTED, EMAIL_UNCONFIRMED, OWNER_MISMATCH, COOKIE_NOT_RETAINED and AUTH_SERVICE_UNAVAILABLE. Actual owner success must be confirmed from that real attempt rather than inferred from mocked tests.

## Actual owner-attempt finding

After the audited deployment, a real login reached the production session exchange
and returned OWNER_MISMATCH (HTTP 403). This occurs after Supabase validates the
JWT and confirms the email. Therefore the observed attempt passed identity and
email verification but failed the application owner allowlist. The configured
allowlist had previously been checked against the intended owner address. The
registered address must be confirmed by the user before changing authorization;
no arbitrary authenticated account is promoted automatically.
