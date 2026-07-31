import { z } from "zod";

const developmentSeedEnvironment = z.object({
  ALLOW_DEV_SEED: z.literal("true"),
  DATABASE_ENVIRONMENT: z.literal("development"),
  NODE_ENV: z.literal("development"),
});

export function assertDevelopmentSeedAllowed(environment: NodeJS.ProcessEnv = process.env): void {
  const result = developmentSeedEnvironment.safeParse(environment);
  if (!result.success) {
    throw new Error(
      "Development seed is blocked unless NODE_ENV=development, DATABASE_ENVIRONMENT=development and ALLOW_DEV_SEED=true",
    );
  }
}
