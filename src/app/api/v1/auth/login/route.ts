import { createSession, destroySession } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { authenticate, publicUser } from "@/lib/services/auth-service";
import { credentialsSchema } from "@/lib/validation/schemas";

export const POST = handle(async (req) => {
  const input = await parseBody(req, credentialsSchema);
  const user = await authenticate(input);
  // A fresh token on every sign-in, so a token planted before login is worthless after it.
  await destroySession();
  await createSession(user.id);
  return json({ user: publicUser(user) });
});
