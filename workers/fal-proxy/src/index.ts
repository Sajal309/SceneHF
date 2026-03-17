import { createFalClient } from "@fal-ai/client";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Fal-Api-Key",
  };
}

function jsonResponse(body: unknown, status = 200, origin: string | null = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/bg-remove" && url.pathname !== "/upscale")) {
      return jsonResponse({ error: "Not found" }, 404, origin);
    }

    const falApiKey = request.headers.get("x-fal-api-key");
    if (!falApiKey) {
      return jsonResponse({ error: "Missing x-fal-api-key header" }, 400, origin);
    }

    const formData = await request.formData();
    const image = formData.get("image");
    const model = String(formData.get("model") || "fal-ai/imageutils/rembg");
    if (!(image instanceof File)) {
      return jsonResponse({ error: "Missing image file" }, 400, origin);
    }

    try {
      const fal = createFalClient({
        credentials: falApiKey,
      });

      const imageUrl = await fal.storage.upload(image);
      const factor = Number(formData.get("factor") || 2);
      const input =
        url.pathname === "/upscale"
          ? {
              image_url: imageUrl,
              scale: factor,
            }
          : {
              image_url: imageUrl,
            };

      const result = await fal.subscribe(model, {
        input,
        logs: true,
      });

      const outputUrl =
        result?.data?.image?.url ||
        result?.data?.images?.[0]?.url ||
        result?.image?.url ||
        result?.images?.[0]?.url;

      if (!outputUrl) {
        return jsonResponse({ error: "Fal returned no output URL", result }, 502, origin);
      }

      const outputResponse = await fetch(outputUrl);
      if (!outputResponse.ok) {
        return jsonResponse({ error: `Failed to fetch Fal output (${outputResponse.status})` }, 502, origin);
      }

      return new Response(outputResponse.body, {
        status: 200,
        headers: {
          "Content-Type": outputResponse.headers.get("Content-Type") || "image/png",
          "Cache-Control": "no-store",
          ...corsHeaders(origin),
        },
      });
    } catch (error) {
      return jsonResponse(
        {
          error: error instanceof Error ? error.message : "Fal proxy request failed",
        },
        500,
        origin,
      );
    }
  },
};
