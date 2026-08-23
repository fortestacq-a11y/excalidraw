import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import React from "react";

const STORAGE_KEY = "excalidraw.custom-ai-provider";

export type CustomAIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export const loadCustomAIConfig = (): CustomAIConfig | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.baseUrl === "string" &&
      parsed.baseUrl.trim() &&
      typeof parsed?.apiKey === "string" &&
      typeof parsed?.model === "string" &&
      parsed.model
    ) {
      return parsed as CustomAIConfig;
    }
    return null;
  } catch {
    return null;
  }
};

export const saveCustomAIConfig = (config: CustomAIConfig | null) => {
  if (config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
};

const OPEN_EVENT = "open-ai-settings";

export const openAISettings = () => {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
};

export const AISettingsDialog = () => {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  const onClose = React.useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) {
      const cfg = loadCustomAIConfig();
      setBaseUrl(cfg?.baseUrl ?? "");
      setApiKey(cfg?.apiKey ?? "");
      setModel(cfg?.model ?? "");
      setModels([]);
      setStatus(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const fetchModels = async () => {
    if (!baseUrl.trim()) {
      setStatus("Enter a base URL first");
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const url = `/ai-proxy/models`;
      const res = await fetch(url, {
        headers: {
          "X-AI-Target": baseUrl.replace(/\/+$/, ""),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const ids: string[] = Array.isArray(json?.data)
        ? json.data.map((m: any) => m.id).filter(Boolean)
        : [];
      setModels(ids);
      setStatus(
        ids.length ? `Found ${ids.length} models` : "No models in response",
      );
    } catch (e: any) {
      setStatus(`Failed to load models: ${e.message}. Enter model ID manually.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      setStatus("Base URL, API key and model are all required");
      return;
    }
    saveCustomAIConfig({
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey: apiKey.trim(),
      model: model.trim(),
    });
    onClose();
  };

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999999,
  };

  const panelStyle: React.CSSProperties = {
    background: "var(--island-bg-color, #fff)",
    color: "var(--text-primary-color, #1b1b1f)",
    borderRadius: 12,
    padding: "24px",
    width: 460,
    maxWidth: "90vw",
    boxShadow: "0 10px 40px rgba(0,0,0,.3)",
    fontFamily: "inherit",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    marginTop: 4,
    marginBottom: 14,
    border: "1px solid var(--button-gray-3, #ccc)",
    borderRadius: 8,
    background: "var(--input-bg-color, transparent)",
    color: "inherit",
    fontSize: 14,
  };

  const buttonRow: React.CSSProperties = {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 8,
  };

  const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 14,
  };

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>AI provider</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, opacity: 0.7 }}>
          Any OpenAI-compatible endpoint (opencode, OpenAI, Ollama, LiteLLM…).
          Stored locally in your browser.
        </p>

        <label>Base URL</label>
        <input
          style={inputStyle}
          placeholder="https://opencode.ai/zen/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <label>API key</label>
        <input
          style={inputStyle}
          type="password"
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <label>
          Model{" "}
          <button
            style={{ ...buttonStyle, padding: "2px 10px", marginLeft: 6 }}
            onClick={fetchModels}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load models"}
          </button>
        </label>
        {models.length > 0 ? (
          <select
            style={inputStyle}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {!models.includes(model) && model && (
              <option value={model}>{model}</option>
            )}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            style={inputStyle}
            placeholder="model-id (e.g. claude-sonnet-4-5)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        )}

        {status && (
          <div style={{ fontSize: 13, marginBottom: 10, opacity: 0.8 }}>
            {status}
          </div>
        )}

        <div style={buttonRow}>
          <button
            style={{
              ...buttonStyle,
              background: "var(--button-gray-2, #eee)",
              color: "inherit",
            }}
            onClick={() => {
              saveCustomAIConfig(null);
              onClose();
            }}
          >
            Use default backend
          </button>
          <button
            style={{
              ...buttonStyle,
              background: "#6965db",
              color: "#fff",
            }}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
