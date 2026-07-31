import type { AuthContext } from "../auth/auth-context.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}
