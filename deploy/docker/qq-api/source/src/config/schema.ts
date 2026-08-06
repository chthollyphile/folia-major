import { z } from 'zod';

export const ServerSchema = z.object({
  port: z.number().int().positive(),
  cors: z.object({
    exposeHeaders: z.array(z.string()),
    maxAge: z.number().int().nonnegative(),
    credentials: z.boolean(),
    allowMethods: z.array(z.string()),
    allowHeaders: z.array(z.string()),
  }),
});

export const RequestSchema = z.object({
  timeout: z.number().int().positive(),
  withCredentials: z.boolean(),
  contentType: z.string(),
  responseType: z.string(),
  baseURL: z.object({
    y: z.string().url(),
    c: z.string().url(),
    u: z.string().url(),
    pic: z.string().url(),
  }),
  referer: z.object({
    y: z.string().url(),
    c: z.string().url(),
    u: z.string().url(),
  }),
});

export const ApiSchema = z.object({
  commonParams: z.record(z.string(), z.unknown()),
  _guid: z.number(),
  options: z.object({
    param: z.string(),
    prefix: z.string(),
  }),
  optionsPrefix: z.object({
    param: z.string(),
    prefix: z.string(),
  }),
});

export const UserSchema = z.object({
  loginUin: z.string(),
  cookie: z.string(),
  uin: z.string().optional(),
  musicid: z.union([z.string(), z.number()]).optional(),
  str_musicid: z.string().optional(),
  musickey: z.string().optional(),
  loginType: z.number().optional(),
  cookieList: z.array(z.string()).optional(),
  cookieObject: z.record(z.string(), z.string()).optional(),
});

export const AppConfigSchema = z.object({
  server: ServerSchema,
  request: RequestSchema,
  api: ApiSchema,
  user: UserSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
