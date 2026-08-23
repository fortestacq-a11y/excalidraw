import {
  DiagramToCodePlugin,
  exportToBlob,
  getNonDeletedElements,
  getTextFromElements,
  MIME_TYPES,
  TTDDialog,
  TTDStreamFetch,
} from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { safelyParseJSON } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TTDIndexedDBAdapter } from "../data/TTDStorage";
import { loadCustomAIConfig } from "./AISettings";

import type { CustomAIConfig } from "./AISettings";
import type { LLMMessage, TTTDDialog } from "@excalidraw/excalidraw/components/TTDDialog/types";

const MERMAID_SYSTEM_PROMPT = `You are a diagram generation assistant. The user describes a scenario and you respond ONLY with a Mermaid diagram definition that represents it.
Rules:
- Respond with ONLY the mermaid code, no explanations, no markdown fences.
- Use "graph TB" (flowchart) syntax unless the user explicitly requests another diagram type (sequenceDiagram, erDiagram, etc.).
- Keep node labels short.`;

const streamFromCustomProvider = async (
  config: CustomAIConfig,
  messages: readonly LLMMessage[],
  {
    onChunk,
    onStreamCreated,
    signal,
  }: {
    onChunk?: (chunk: string) => void;
    onStreamCreated?: () => void;
    signal?: AbortSignal;
  },
): Promise<TTTDDialog.OnTextSubmitRetValue> => {
  const { RequestError } = await import("@excalidraw/excalidraw/errors");

  try {
    const response = await fetch(
      `/ai-proxy/chat/completions`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "X-AI-Target": config.baseUrl,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: MERMAID_SYSTEM_PROMPT },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
        }),
        signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return {
        error: new RequestError({
          message: text || `Request failed (${response.status})`,
          status: response.status,
        }),
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        error: new RequestError({
          message: "Couldn't get reader from response body",
          status: 500,
        }),
      };
    }

    onStreamCreated?.();

    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";
    let error: InstanceType<typeof RequestError> | null = null;

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          break outer;
        }
        try {
          const json = JSON.parse(data);
          const delta: string =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content ??
            "";
          if (delta) {
            fullResponse += delta;
            onChunk?.(delta);
          }
          if (json?.error) {
            error = new RequestError({
              message: json.error.message || "Provider returned an error",
              status: 500,
            });
            break outer;
          }
        } catch {
          // ignore keep-alive comments / non-JSON lines
        }
      }
    }

    if (error) {
      return { error };
    }

    // strip markdown fences some models add despite instructions
    const cleaned = fullResponse
      .replace(/^```(?:mermaid)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();

    if (!cleaned) {
      return {
        error: new RequestError({
          message: "Generation failed... (empty response)",
          status: 500,
        }),
      };
    }

    return {
      generatedResponse: cleaned,
      error: null,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return {
        error: new RequestError({ message: "Request aborted", status: 499 }),
      };
    }
    return {
      error: new RequestError({
        message: err.message || "Request failed",
        status: 500,
      }),
    };
  }
};

export const AIComponents = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  return (
    <>
      <DiagramToCodePlugin
        generate={async ({ frame, children }) => {
          const appState = excalidrawAPI.getAppState();

          // SAFETY: This should never happen, but log it just in case
          if (children.some((el) => el.isDeleted)) {
            console.error(
              "[NONDELETED][INVARIANT] Generated children elements should not be `isDeleted: true`",
            );
          }

          const blob = await exportToBlob({
            elements: getNonDeletedElements(children),
            appState: {
              ...appState,
              exportBackground: true,
              viewBackgroundColor: appState.viewBackgroundColor,
            },
            exportingFrame: frame,
            files: excalidrawAPI.getFiles(),
            mimeType: MIME_TYPES.jpg,
          });

          const dataURL = await getDataURL(blob);

          const textFromFrameChildren = getTextFromElements(children);

          const response = await fetch(
            `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/diagram-to-code/generate`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                texts: textFromFrameChildren,
                image: dataURL,
                theme: appState.theme,
              }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            const errorJSON = safelyParseJSON(text);

            if (!errorJSON) {
              throw new Error(text);
            }

            if (errorJSON.statusCode === 429) {
              return {
                html: `<html>
                <body style="margin: 0; text-align: center">
                <div style="display: flex; align-items: center; justify-content: center; flex-direction: column; height: 100vh; padding: 0 60px">
                  <div style="color:red">Too many requests today,</br>please try again tomorrow!</div>
                  </br>
                  </br>
                  <div>You can also try <a href="${
                    import.meta.env.VITE_APP_PLUS_LP
                  }/plus?utm_source=excalidraw&utm_medium=app&utm_content=d2c" target="_blank" rel="noopener">Excalidraw+</a> to get more requests.</div>
                </div>
                </body>
                </html>`,
              };
            }

            throw new Error(errorJSON.message || text);
          }

          try {
            const { html } = await response.json();

            if (!html) {
              throw new Error("Generation failed (invalid response)");
            }
            return {
              html,
            };
          } catch (error: any) {
            throw new Error("Generation failed (invalid response)");
          }
        }}
      />

      <TTDDialog
        onTextSubmit={async (props) => {
          const { onChunk, onStreamCreated, signal, messages } = props;

          const customConfig = loadCustomAIConfig();
          if (customConfig) {
            return streamFromCustomProvider(customConfig, messages, {
              onChunk,
              onStreamCreated,
              signal,
            });
          }

          const result = await TTDStreamFetch({
            url: `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/text-to-diagram/chat-streaming`,
            messages,
            onChunk,
            onStreamCreated,
            extractRateLimits: true,
            signal,
          });

          return result;
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />
    </>
  );
};
