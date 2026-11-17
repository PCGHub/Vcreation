type AuthFailure = { code?: string; status?: number; message?: string };
export function authErrorMessage(error: AuthFailure, signup = false): string {
  if (error.code === "invalid_credentials") return "The email or password wasn't accepted. If your browser filled the password automatically, clear it and enter the password you used when registering.";
  if (error.code === "email_not_confirmed") return "Your email is not confirmed in this app yet. Open the latest Vcreation confirmation email, then return here to sign in.";
  if (error.status === 429 || error.code?.includes("rate_limit")) return "Too many attempts. Please wait a few minutes before trying again.";
  if (error.code === "email_provider_disabled" || error.code === "signup_disabled") return "Email sign-in or account creation is currently disabled. The app's authentication settings need attention.";
  if (!error.status || error.status >= 500) return "We couldn't reach the sign-in service. Check your connection and try again in a moment.";
  return signup ? "We couldn't create this account. Check the details and try again." : "We couldn't sign you in. Please try again. If it continues, share the error code below.";
}
