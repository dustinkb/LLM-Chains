import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK lazily to avoid crashing on start if API key is blank
function getGeminiClient(customKey?: string): GoogleGenAI {
  const finalKey = customKey || process.env.GEMINI_API_KEY;
  if (!finalKey) {
    throw new Error("GEMINI_API_KEY is not defined. Please configure a custom Gemini API Key in the sidebar or provide it in environment secrets.");
  }
  return new GoogleGenAI({
    apiKey: finalKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// 1. Health check routing
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 2. Fetch OpenRouter Models dynamically with custom static fallback
app.get("/api/models/openrouter", async (req: Request, res: Response) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter HTTP error: ${response.status}`);
    }

    const data = await response.json();
    res.json({ success: true, models: data.data || [] });
  } catch (error: any) {
    console.warn("Falling back to static OpenRouter models list on API error:", error.message);
    res.json({
      success: false,
      message: error.message,
      models: [
        { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (via OpenRouter)" },
        { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
        { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
        { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
        { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
        { id: "mistralai/mistral-7b-instruct", name: "Mistral 7B Instruct" }
      ]
    });
  }
});

// 3. Sequential Stage Executable SSE Endpoint
app.post("/api/run-chain-step", async (req: Request, res: Response) => {
  const { engine, model, systemInstruction, prompt, temperature, topP, openRouterApiKey, customGeminiApiKey } = req.body;

  // Configure SSE standard headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    if (engine === "gemini") {
      const ai = getGeminiClient(customGeminiApiKey);
      const responseStream = await ai.models.generateContentStream({
        model: model || "gemini-3.5-flash",
        contents: prompt || "",
        config: {
          systemInstruction: systemInstruction || undefined,
          temperature: typeof temperature === "number" ? temperature : 0.7,
          topP: typeof topP === "number" ? topP : 0.9,
        }
      });

      for await (const chunk of responseStream) {
        const text = chunk.text || "";
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } else if (engine === "openrouter") {
      const key = openRouterApiKey || "";
      if (!key) {
        throw new Error("OpenRouter API key is required and was not provided.");
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ai.studio",
          "X-Title": "LLM Chain Processor",
        },
        body: JSON.stringify({
          model: model || "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemInstruction || "You are a precise assistant." },
            { role: "user", content: prompt || "" }
          ],
          temperature: typeof temperature === "number" ? temperature : 0.7,
          top_p: typeof topP === "number" ? topP : 0.9,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Error (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");

      if (!reader) {
        throw new Error("Failed to initialize system stream reader from OpenRouter response.");
      }

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          if (cleanLine.startsWith("data:")) {
            const dataStr = cleanLine.substring(5).trim();
            if (dataStr === "[DONE]") {
              res.write("data: [DONE]\n\n");
              continue;
            }

            try {
              const parsed = JSON.parse(dataStr);
              const text = parsed.choices?.[0]?.delta?.content || "";
              if (text) {
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
              }
            } catch (err) {
              // Silently ignore malformed non-JSON lines or partial buffers
            }
          }
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      throw new Error(`Invalid engine option specified: '${engine}'`);
    }
  } catch (error: any) {
    console.error("SSE Streaming Error:", error);
    let errorMsg = error.message || "An internal error occurred.";
    if (
      error.status === 429 ||
      errorMsg.includes("429") ||
      errorMsg.includes("quota") ||
      errorMsg.includes("quota exceeded") ||
      errorMsg.includes("RESOURCE_EXHAUSTED") ||
      errorMsg.includes("Too Many Requests")
    ) {
      errorMsg = "RESOURCE_EXHAUSTED (429): The active Gemini API quota limit has been exceeded. To bypass this instantly, create a free API Key on Google AI Studio and paste it into 'Gemini Key (Optional)' in the sidebar Settings, or wait a few moments before retrying.";
    }
    res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
    res.end();
  }
});

// Configure Vite middleware interface / Dist serving
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LLM Chain Processor server online at http://localhost:${PORT} in env: ${process.env.NODE_ENV || "development"}`);
  });
}

bootstrap().catch((err) => {
  console.error("Express server starter failed:", err);
});
