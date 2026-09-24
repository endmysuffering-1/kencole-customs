import { NextResponse } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { AuthError } from "@/lib/auth/session";
import { DomainError } from "@/lib/services/errors";
import { UploadRejected } from "@/lib/providers/storage";

/**
 * Route handlers stay thin: parse, authorise, call a service, return. This file
 * turns the errors services throw into responses, so no handler builds its own.
 */

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function parseBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new DomainError("Send the request body as JSON.");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function errorResponse(e: unknown): Response {
  if (e instanceof ZodError) {
    const { fieldErrors, formErrors } = e.flatten();
    return json({ error: formErrors[0] ?? "Check the highlighted fields.", fields: fieldErrors }, 400);
  }
  if (e instanceof DomainError) return json({ error: e.message }, e.status);
  if (e instanceof AuthError) return json({ error: e.message }, e.status);
  if (e instanceof UploadRejected) return json({ error: e.message }, 400);
  console.error(e);
  // Internal detail stays in the server log, never in the response.
  return json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
}
