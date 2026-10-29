import { z } from "zod";

export const registerSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(12).max(128),
});

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(128),
});

export const workspaceNameSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
});

export const decisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("approve"),
    role: z.enum(["editor", "viewer"]),
  }),
  z.strictObject({ decision: z.literal("decline") }),
]);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
