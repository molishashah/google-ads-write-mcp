import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { clientStore } from "@/lib/auth-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientId = crypto.randomUUID();

  clientStore.set(clientId, {
    redirect_uris: body.redirect_uris || [],
    client_name: body.client_name,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris || [],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201 }
  );
}
