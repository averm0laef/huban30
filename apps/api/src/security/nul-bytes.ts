import type { FastifyInstance } from "fastify";

const NUL = "\u0000";

/**
 * True when a parsed request value carries a NUL character in any string or
 * object key. Walks iteratively: a deeply nested body must not exhaust the
 * stack. Buffers (raw 1C exchange bodies) and other non-plain values are
 * left to their own parsers.
 */
export function containsNulCharacter(root: unknown): boolean {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (value.includes(NUL)) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value !== null && typeof value === "object" && !ArrayBuffer.isView(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key.includes(NUL)) return true;
        pending.push(item);
      }
    }
  }
  return false;
}

/**
 * PostgreSQL text cannot hold U+0000, so a NUL that reaches a query ends in a
 * 500. Refuse it at the door for every route instead of per field.
 */
export function registerNulCharacterRejection(server: FastifyInstance): void {
  server.addHook("preValidation", async (request, reply) => {
    if (
      containsNulCharacter(request.body)
      || containsNulCharacter(request.query)
      || containsNulCharacter(request.params)
    ) {
      await reply.code(400).send({ error: "Bad Request", message: "Недопустимые символы в запросе", statusCode: 400 });
    }
  });
}
