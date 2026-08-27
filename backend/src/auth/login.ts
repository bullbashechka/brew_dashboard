import { loginSchema, passwordSchema } from "@brew-dashboard/contracts";

export const normalizeLogin = (value: string) => value.trim().toLowerCase();

export const isSupportedLogin = (value: string) => loginSchema.safeParse(value).success;

export const parseLogin = (value: string) => loginSchema.parse(normalizeLogin(value));

export const parsePassword = (value: string) => passwordSchema.parse(value);
