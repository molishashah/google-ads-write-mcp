import { signJwt, verifyJwt } from "./jwt";

interface PendingAuth {
  redirect_uri: string;
  state: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface AuthCode {
  email: string;
  code_challenge?: string;
  code_challenge_method?: string;
  redirect_uri: string;
}

export const pendingAuthStore = {
  async encode(value: PendingAuth): Promise<string> {
    return signJwt({ ...value, purpose: "pending_auth" }, "10m");
  },
  async decode(token: string): Promise<PendingAuth | null> {
    const payload = await verifyJwt(token);
    if (!payload || payload.purpose !== "pending_auth") return null;
    return {
      redirect_uri: payload.redirect_uri as string,
      state: payload.state as string,
      code_challenge: payload.code_challenge as string | undefined,
      code_challenge_method: payload.code_challenge_method as string | undefined,
    };
  },
};

export const authCodeStore = {
  async encode(value: AuthCode): Promise<string> {
    return signJwt({ ...value, purpose: "auth_code" }, "5m");
  },
  async decode(token: string): Promise<AuthCode | null> {
    const payload = await verifyJwt(token);
    if (!payload || payload.purpose !== "auth_code") return null;
    return {
      email: payload.email as string,
      code_challenge: payload.code_challenge as string | undefined,
      code_challenge_method: payload.code_challenge_method as string | undefined,
      redirect_uri: payload.redirect_uri as string,
    };
  },
};

const MAX_CLIENTS = 1000;
const clients = new Map<string, { redirect_uris: string[]; client_name?: string }>();

export const clientStore = {
  set: (key: string, value: { redirect_uris: string[]; client_name?: string }) => {
    if (clients.size >= MAX_CLIENTS) {
      const oldest = clients.keys().next().value!;
      clients.delete(oldest);
    }
    clients.set(key, value);
  },
  get: (key: string) => clients.get(key),
};
