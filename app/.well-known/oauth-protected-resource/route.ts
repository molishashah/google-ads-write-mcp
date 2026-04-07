import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

let cachedHandler: ((req: Request) => Response | Promise<Response>) | null = null;

function getHandler() {
  if (cachedHandler) return cachedHandler;
  cachedHandler = protectedResourceHandler({
    authServerUrls: [process.env.NEXT_PUBLIC_BASE_URL?.trim() || "http://localhost:3000"],
  });
  return cachedHandler;
}

export async function GET(req: Request) {
  return getHandler()(req);
}

const corsHandler = metadataCorsOptionsRequestHandler();
export { corsHandler as OPTIONS };
