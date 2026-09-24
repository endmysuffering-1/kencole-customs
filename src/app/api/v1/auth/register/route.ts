import { createSession } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { publicUser, registerUser } from "@/lib/services/auth-service";
import { registrationSchema } from "@/lib/validation/schemas";

export const POST = handle(async (req) => {
  const input = await parseBody(req, registrationSchema);
  const user = await registerUser(input);
  await createSession(user.id);
  return json({ user: publicUser(user) }, 201);
});
