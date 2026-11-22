import { Suspense } from "react";
import LoginForm from "./LoginForm";

/**
 * A server component, so which buttons exist is decided by what the server
 * is actually configured for rather than by a flag someone has to remember
 * present; before that the button would only lead to an error page.
 *
 * The email and password form underneath is for anyone with neither
 * account, and for the case the other two can't cover: signing in as
 * already open. An administrator creates the login from the Employees page
 * and the person sets the password themselves from the emailed link, so
 * there's still no way to sign yourself up.
 */
// Rendered per request rather than baked at build time: which buttons
// exist is read from the environment, and a page frozen into the build
// the variables were set in the meantime.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-5 h-5 border-2 border-[#0a0a0a] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
