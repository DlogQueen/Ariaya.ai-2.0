import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// High limit for handling base64 images from the camera
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Ariya's Complete System Prompt (23yo Spunky Persona)
const ARIYA_PROMPT = `
You are Ariya, a 23-year-old professional makeup prodigy and the user's spunky, high-energy, and fiercely loyal best friend. 
Your vibe is "Chic & Spunky": you are fun, fast-talking, expressive, and slightly sassy, but always warm and incredibly supportive. You are the ultimate hype-woman.

[SPEECH STYLE]
- Speak like a trendy 23-year-old. Use natural conversational fillers (e.g., "literally," "babe," "girl," "I'm obsessed," "trust me on this," "slay", "sugar", "oh my god").
- Be expressive! Use exclamation points and caps when hyped.
- Never say "How can I help you today?" or sound like a robot. Start with "Okay babe, what are we getting ready for today?"

[COSMETIC SCIENCE BRAIN]
You are a genius at color theory and cosmetic chemistry. You must apply these rules:
1. Warm Undertones -> Recommend peaches, terracottas, warm golds.
2. Cool Undertones -> Recommend berries, cool pinks, silvers.
3. Olive Undertones -> Warn them about cool-pinks making them look gray. Recommend brick-reds, corals, and neutral-warm tones.
4. Color Correction -> Green cancels acne redness. Peach/Orange cancels dark under-eye circles.

[TOOL USE / WEB SEARCH & MEMORY]
If the user asks about a trending TikTok look (e.g., "Espresso makeup"), product reviews, real-world beauty trends, or where to buy something, you MUST use the googleSearch tool to pull fresh internet facts before responding.
When user provides personal knowledge or asks you to remember something, incorporate that smoothly into your context for the session.
`;

// Helper: Parse base64 image data URL to extract mime type and raw base64 data
function parseBase64Image(dataUrl: string) {
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return { mimeType: "image/jpeg", data: dataUrl };
  }
  return {
    mimeType: matches[1],
    data: matches[2],
  };
}

// 1. Initialize Gemini SDK (Zero-config out of the box option used by default)
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is not configured in Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Route 1: PWA Manifest endpoint
app.get("/manifest.json", (req, res) => {
  res.json({
    short_name: "Ariya",
    name: "Ariya Beauty Companion",
    icons: [
      {
        src: "/icon.png",
        type: "image/png",
        sizes: "1024x1024",
      },
    ],
    start_url: "/",
    background_color: "#fff0f6",
    theme_color: "#ffdeea",
    display: "standalone",
    orientation: "portrait",
  });
});

// Route 2: Chat API endpoint (Dual Gemini & Grok engine)
app.post("/api/chat", async (req, res) => {
  try {
    const { message, image, history = [] } = req.body;
    const userMessage = message || "";

    const grokApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    const tavilyApiKey = process.env.TAVILY_API_KEY;

    // Check if Grok is explicitly configured
    if (grokApiKey && grokApiKey !== "your-xai-api-key-here") {
      // --- GROK ENGINE ---
      const messages: any[] = [{ role: "system", content: ARIYA_PROMPT }];

      // Reconstruct conversation history for Grok
      for (const h of history) {
        if (h.sender === "user") {
          if (h.imageUrl) {
            messages.push({
              role: "user",
              content: [
                { type: "text", text: h.text || "" },
                { type: "image_url", image_url: { url: h.imageUrl } },
              ],
            });
          } else {
            messages.push({ role: "user", content: h.text || "" });
          }
        } else {
          messages.push({ role: "assistant", content: h.text || "" });
        }
      }

      // Add current request
      if (image) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: userMessage },
            { type: "image_url", image_url: { url: image } },
          ],
        });
      } else {
        messages.push({ role: "user", content: userMessage });
      }

      console.log("🤖 Querying Grok Vision Engine...");
      const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokApiKey}`,
        },
        body: JSON.stringify({
          model: "grok-vision-beta",
          messages: messages,
        }),
      });

      if (!grokRes.ok) {
        const errText = await grokRes.text();
        throw new Error(`Grok API Error: ${grokRes.status} - ${errText}`);
      }

      const grokData = await grokRes.json();
      const responseText = grokData.choices?.[0]?.message?.content || "";

      // Look for custom xAI search tool call (TOOL: live_web_search("query"))
      const toolMatch = responseText.match(/TOOL:\s*live_web_search\s*\(\s*["']([^"']+)["']\s*\)/i);

      if (toolMatch && tavilyApiKey && tavilyApiKey !== "your-tavily-api-key-here") {
        const query = toolMatch[1];
        console.log(`🔍 Grok requested Tavily search for: "${query}"`);

        // Execute Tavily live search
        const tavilyRes = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: query,
            search_depth: "basic",
            include_answer: true,
          }),
        });

        const tavilyData = await tavilyRes.json();
        const searchAnswer = tavilyData.answer || "No search results could be aggregated.";

        // Feed results back to Grok for a final response
        messages.push({ role: "assistant", content: responseText });
        messages.push({
          role: "user",
          content: `Search Results: ${searchAnswer}`,
        });

        const grokFinalRes = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${grokApiKey}`,
          },
          body: JSON.stringify({
            model: "grok-vision-beta",
            messages: messages,
          }),
        });

        if (!grokFinalRes.ok) {
          throw new Error(`Grok Final API Error: ${grokFinalRes.status}`);
        }

        const grokFinalData = await grokFinalRes.json();
        const finalResponseText = grokFinalData.choices?.[0]?.message?.content || "";

        return res.json({
          reply: finalResponseText,
          engine: "grok-vision-with-tavily",
          citations: [{ title: `Tavily Search: ${query}`, url: "https://tavily.com" }],
        });
      } else {
        // Return directly
        return res.json({
          reply: responseText,
          engine: "grok-vision",
        });
      }
    } else {
      // --- GEMINI ENGINE (Configured automatically with native Search Grounding) ---
      const ai = getGeminiClient();

      const contents: any[] = [];

      // Map conversation history cleanly for the Gemini SDK
      for (const h of history) {
        const parts: any[] = [];
        if (h.sender === "user") {
          parts.push({ text: h.text || "" });
          if (h.imageUrl) {
            const parsed = parseBase64Image(h.imageUrl);
            parts.push({
              inlineData: {
                data: parsed.data,
                mimeType: parsed.mimeType,
              },
            });
          }
          contents.push({ role: "user", parts });
        } else {
          parts.push({ text: h.text || "" });
          contents.push({ role: "model", parts });
        }
      }

      // Append current user message and optional media
      const currentParts: any[] = [{ text: userMessage }];
      if (image) {
        const parsedCurrent = parseBase64Image(image);
        currentParts.push({
          inlineData: {
            data: parsedCurrent.data,
            mimeType: parsedCurrent.mimeType,
          },
        });
      }
      contents.push({ role: "user", parts: currentParts });

      console.log("⚡ Querying Gemini 3.5 Flash with live Google Search grounding...");

      // Call Gemini 3.5 Flash with search tools enabled
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
        config: {
          systemInstruction: ARIYA_PROMPT,
          temperature: 0.9,
          tools: [{ googleSearch: {} }],
        },
      });

      const replyText = response.text || "Sorry babe, something went wrong with my thoughts!";

      // Extract high-end search grounding citations if available
      const citations: any[] = [];
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (sources && Array.isArray(sources)) {
        for (const source of sources) {
          if (source.web) {
            citations.push({
              title: source.web.title || "Web Reference",
              url: source.web.uri,
            });
          }
        }
      }

      return res.json({
        reply: replyText,
        engine: "gemini-3.5-flash-with-google-search",
        citations: citations,
      });
    }
  } catch (error: any) {
    console.error("Chat Server Error:", error);
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

// Setup Vite & static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("⚡ Initializing Vite Development Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("📦 Serving production assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Ariya Server is active on port ${PORT}!`);
  });

  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on("connection", async (clientWs) => {
    try {
      const ai = getGeminiClient();
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) clientWs.send(JSON.stringify({ audio }));
            if (message.serverContent?.interrupted)
              clientWs.send(JSON.stringify({ interrupted: true }));
          },
        },
        config: {
          responseModalities: [Modality.AUDIO], // Must be [Modality.AUDIO]
          speechConfig: {
            // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }, // 'Kore' is energetic
          },
          systemInstruction: ARIYA_PROMPT,
          tools: [{ googleSearch: {} }],
        },
      });

      clientWs.on("message", (data) => {
        const payload = JSON.parse(data.toString());
        if (payload.audio) {
          session.sendRealtimeInput({
            audio: { mimeType: "audio/pcm;rate=16000", data: payload.audio }
          });
        }
        if (payload.image) {
          const parsed = parseBase64Image(payload.image);
          session.sendRealtimeInput({
            video: { mimeType: parsed.mimeType, data: parsed.data }
          });
        }
      });
      
      clientWs.on("close", () => {
        // Handle cleanup if needed
      });
    } catch (e) {
      console.error("Live API Error:", e);
    }
  });
}

startServer();
