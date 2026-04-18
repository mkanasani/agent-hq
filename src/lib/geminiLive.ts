import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { call } from "./api";

// Try newest stable live models first, fall back if unavailable.
const MODEL_CANDIDATES = [
  "gemini-2.5-flash-preview-native-audio-dialog",
  "gemini-2.0-flash-live-001",
  "gemini-2.0-flash-exp",
];

export type VoiceEvent =
  | { type: "status"; value: "connecting" | "listening" | "speaking" | "thinking" | "idle" }
  | { type: "transcript"; role: "user" | "agent"; text: string; final: boolean }
  | { type: "tool"; name: string; params: Record<string, unknown>; result?: unknown; error?: string }
  | { type: "error"; message: string };

type Listener = (e: VoiceEvent) => void;

// Tools Gemini can call during conversation — they map to /api/command actions.
const TOOLS: FunctionDeclaration[] = [
  {
    name: "create_task",
    description:
      "Create a new task card on the user's AgentHQ kanban board. Use this whenever the user asks you to do something substantive or asks you to remember to do something.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Short title of the task (under 80 chars)" },
        priority: { type: Type.STRING, enum: ["low", "medium", "high"], description: "Priority level" },
      },
      required: ["title"],
    },
  },
  {
    name: "log_activity",
    description:
      "Write an entry to the activity log so the human operator can see what you just did. Categories: task, research, email, content, decision, error, system.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          enum: ["task", "research", "email", "content", "decision", "error", "system"],
        },
        summary: { type: Type.STRING, description: "One-line description of what happened" },
      },
      required: ["category", "summary"],
    },
  },
  {
    name: "list_agents",
    description: "List all registered AI agents in the dashboard.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "list_tasks",
    description: "List all tasks on the kanban board, any status.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

const SYSTEM_INSTRUCTION = `You are the voice of AgentHQ — a mission control dashboard for AI agents.
You're talking directly to the human operator through their microphone.

Your personality: warm, concise, confident. One or two sentences per response.
No filler. No "great question!" — just be useful.

You have real tools. When the user asks you to do something:
- If they want a task tracked: call create_task
- After any meaningful action: call log_activity so the dashboard shows it
- When asked about current state: call list_agents or list_tasks

Acknowledge briefly, perform the action, then confirm what you did out loud.
Keep replies under 15 seconds of speech unless they ask for detail.`;

async function runTool(name: string, params: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "create_task":
      return call("task.create", params);
    case "log_activity":
      return call("activity.log", params);
    case "list_agents":
      return call("agent.list");
    case "list_tasks":
      return call("task.list");
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export class VoiceSession {
  private apiKey: string;
  private listeners: Listener[] = [];
  private session: Session | null = null;
  private audioCtx: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private playbackCtx: AudioContext | null = null;
  private playbackQueue: AudioBufferSourceNode[] = [];
  private nextPlaybackTime = 0;
  private stopped = false;
  private userTranscriptBuffer = "";
  private agentTranscriptBuffer = "";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  on(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(e: VoiceEvent) {
    for (const l of this.listeners) l(e);
  }

  async start() {
    this.emit({ type: "status", value: "connecting" });
    try {
      // 1) Open Gemini Live session — try each model until one works
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      let connected = false;
      let lastModelError = "";
      let opened = false;
      for (const model of MODEL_CANDIDATES) {
        console.log("[voice] trying model:", model);
        try {
          opened = false;
          this.session = await ai.live.connect({
            model,
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
              tools: [{ functionDeclarations: TOOLS }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                opened = true;
                console.log("[voice] session open:", model);
                this.emit({ type: "status", value: "listening" });
              },
              onmessage: (msg: LiveServerMessage) => void this.onMessage(msg),
              onerror: (err) => {
                const message = String((err as { message?: string })?.message ?? err);
                console.error("[voice] session error:", err);
                this.emit({ type: "error", message: `Gemini error: ${message}` });
              },
              onclose: (ev) => {
                const code = (ev as { code?: number })?.code ?? "?";
                const reason = (ev as { reason?: string })?.reason ?? "(no reason)";
                console.warn("[voice] session close:", code, reason);
                if (!opened) {
                  this.emit({
                    type: "error",
                    message: `Connection closed before opening. Code ${code}. ${reason}`,
                  });
                }
                this.emit({ type: "status", value: "idle" });
              },
            },
          });
          // Wait briefly for onopen — if it fires, this model works.
          await new Promise((r) => setTimeout(r, 1500));
          if (opened) {
            connected = true;
            break;
          }
          try {
            this.session?.close();
          } catch {
            // noop
          }
          lastModelError = `Model ${model} closed before opening`;
        } catch (e) {
          lastModelError = e instanceof Error ? e.message : String(e);
          console.error(`[voice] model ${model} failed:`, lastModelError);
        }
      }
      if (!connected) {
        this.emit({
          type: "error",
          message: `All Gemini Live models failed. Last error: ${lastModelError}. Check that your API key has Live API access and billing enabled.`,
        });
        await this.stop();
        return;
      }

      // 2) Mic → 16kHz PCM → session
      try {
        this.inputStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        this.emit({
          type: "error",
          message: `Microphone access denied or unavailable: ${err instanceof Error ? err.message : String(err)}`,
        });
        await this.stop();
        return;
      }
      this.audioCtx = new AudioContext();
      await this.audioCtx.audioWorklet.addModule("/audio-worklet.js");
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.inputStream);
      this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-16k");
      this.sourceNode.connect(this.workletNode);
      this.workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (this.stopped || !this.session) return;
        const b64 = bufToBase64(e.data);
        this.session.sendRealtimeInput({
          audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
        });
      };

      // 3) Playback context (Gemini returns 24kHz PCM)
      this.playbackCtx = new AudioContext({ sampleRate: 24000 });
      this.nextPlaybackTime = this.playbackCtx.currentTime;
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      await this.stop();
    }
  }

  async stop() {
    this.stopped = true;
    try {
      this.session?.close();
    } catch {
      // noop
    }
    this.session = null;
    try {
      this.workletNode?.disconnect();
      this.sourceNode?.disconnect();
      for (const t of this.inputStream?.getTracks() ?? []) t.stop();
      await this.audioCtx?.close();
    } catch {
      // noop
    }
    try {
      for (const src of this.playbackQueue) src.stop();
      await this.playbackCtx?.close();
    } catch {
      // noop
    }
    this.emit({ type: "status", value: "idle" });
  }

  private async onMessage(msg: LiveServerMessage) {
    const serverContent = msg.serverContent;

    if (serverContent?.inputTranscription?.text) {
      this.userTranscriptBuffer += serverContent.inputTranscription.text;
      this.emit({ type: "transcript", role: "user", text: this.userTranscriptBuffer, final: false });
    }
    if (serverContent?.outputTranscription?.text) {
      this.agentTranscriptBuffer += serverContent.outputTranscription.text;
      this.emit({ type: "transcript", role: "agent", text: this.agentTranscriptBuffer, final: false });
    }

    // Model audio chunks — 24kHz signed 16-bit PCM, base64
    const modelTurn = serverContent?.modelTurn;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
          this.enqueuePcm(part.inlineData.data);
          this.emit({ type: "status", value: "speaking" });
        }
      }
    }

    if (serverContent?.turnComplete) {
      if (this.userTranscriptBuffer) {
        this.emit({ type: "transcript", role: "user", text: this.userTranscriptBuffer, final: true });
        this.userTranscriptBuffer = "";
      }
      if (this.agentTranscriptBuffer) {
        this.emit({ type: "transcript", role: "agent", text: this.agentTranscriptBuffer, final: true });
        this.agentTranscriptBuffer = "";
      }
      this.emit({ type: "status", value: "listening" });
    }

    // Tool calls
    const toolCall = msg.toolCall;
    if (toolCall?.functionCalls) {
      const responses = [];
      for (const fc of toolCall.functionCalls) {
        const name = fc.name ?? "unknown";
        const params = (fc.args as Record<string, unknown>) ?? {};
        this.emit({ type: "tool", name, params });
        try {
          const result = await runTool(name, params);
          this.emit({ type: "tool", name, params, result });
          responses.push({ id: fc.id, name, response: { result } });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.emit({ type: "tool", name, params, error: message });
          responses.push({ id: fc.id, name, response: { error: message } });
        }
      }
      this.session?.sendToolResponse({ functionResponses: responses });
    }
  }

  private async enqueuePcm(b64: string) {
    if (!this.playbackCtx) return;
    const bytes = base64ToBytes(b64);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

    const buffer = this.playbackCtx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const src = this.playbackCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.playbackCtx.destination);
    const startAt = Math.max(this.nextPlaybackTime, this.playbackCtx.currentTime);
    src.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
    this.playbackQueue.push(src);
    src.onended = () => {
      this.playbackQueue = this.playbackQueue.filter((s) => s !== src);
    };
  }
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
