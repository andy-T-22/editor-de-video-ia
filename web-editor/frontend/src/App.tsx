import React, { useState, useRef, useEffect, useCallback } from "react";
import "./styles/design-system.css";
import "./styles/editor.css";

const API = "http://localhost:3001";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Segment { start: number; end: number; duration: number; enabled?: boolean; }
interface Word { word: string; start: number; end: number; original_start?: number; original_end?: number; }
interface Config {
  title: string; title_start_sec: number; title_end_sec: number;
  music_volume: number;
  subtitle_style: { font: string; size: number; color: string; highlight: string; stroke: string; words_per_line: number; };
}
interface VideoData {
  config: Config; original_duration: number; edited_duration: number;
  active_segments: Segment[]; words: Word[]; full_text: string;
  language: string; clips?: { name: string; index: number }[];
  clip_boundaries?: { name: string; start: number; end: number; duration: number; }[];
  guion?: string; concat_video?: string;
}
interface FileInfo { name: string; url: string; size: number; }
interface Toast { id: number; type: "success" | "error" | "info" | "warning"; message: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};
const fmtSize = (bytes: number) => bytes > 1e6 ? `${(bytes/1e6).toFixed(1)}MB` : `${(bytes/1e3).toFixed(0)}KB`;

let toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  return { toasts, add };
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);  // MULTI-SELECT
  const [data, setData]   = useState<VideoData | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processStep, setProcessStep] = useState("");
  const [rendering, setRendering]   = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [currentTime, setCurrentTime]  = useState(0);
  const [title, setTitle]   = useState("");
  const [guion, setGuion]   = useState("");
  const [modelSize, setModelSize] = useState("base");
  const [language, setLanguage]   = useState("es");
  const [dragOver, setDragOver]   = useState(false);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const videoRef    = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toasts, add: addToast } = useToasts();

  // Health check
  useEffect(() => {
    const check = async () => {
      try { const r = await fetch(`${API}/api/health`); setServerOnline(r.ok); }
      catch { setServerOnline(false); }
    };
    check();
    const iv = setInterval(check, 5000);
    return () => clearInterval(iv);
  }, []);

  // Cargar data.json existente al iniciar
  useEffect(() => {
    fetch(`${API}/api/data`).then(r => r.json()).then(d => {
      if (d && d.active_segments) setData(d);
    }).catch(() => {});
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/files`);
      const j = await r.json();
      setFiles(j.files || []);
    } catch {}
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Video time tracking
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [selectedFiles]);

  // Upload file
  const handleUpload = async (file: File) => {
    const form = new FormData();
    form.append("video", file);
    try {
      const r = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      const j = await r.json();
      if (j.ok) { addToast("success", `✅ "${file.name}" subido`); loadFiles(); }
      else addToast("error", j.error || "Error al subir");
    } catch { addToast("error", "No se pudo conectar al servidor"); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(f => handleUpload(f));
  };

  const handleClearFiles = async () => {
    if (!window.confirm("¿Estás seguro de borrar todos los videos subidos? Esto reiniciará el espacio de trabajo.")) return;
    try {
      const r = await fetch(`${API}/api/files`, { method: "DELETE" });
      if (r.ok) {
        setFiles([]);
        setSelectedFiles([]);
        setData(null);
        setRenderedUrl(null);
        addToast("info", "🧹 Espacio de trabajo limpiado");
      }
    } catch { addToast("error", "Error al limpiar"); }
  };

  // Toggle selección de clips (multi-select)
  const toggleFile = (name: string) => {
    setSelectedFiles(prev =>
      prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name]
    );
  };

  // Procesar todos los clips seleccionados
  const handleProcess = async () => {
    if (selectedFiles.length === 0) { addToast("error", "Seleccioná al menos un video"); return; }
    setProcessing(true);
    try {
      setProcessStep(`Concatenando ${selectedFiles.length} clip(s) con FFmpeg...`);
      await new Promise(r => setTimeout(r, 200));
      setProcessStep("Transcribiendo con Whisper local (puede tardar 1-3 min)...");

      const r = await fetch(`${API}/api/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: selectedFiles, title, model_size: modelSize, language, guion })
      });
      const j = await r.json();
      if (j.ok) {
        setData(j.data);
        addToast("success", `✅ ${selectedFiles.length} clip(s) procesados — ${j.data.active_segments.length} segmentos detectados`);
      } else {
        addToast("error", j.error || "Error en el procesamiento");
      }
    } catch (e: any) {
      addToast("error", "Error: " + e.message);
    } finally { setProcessing(false); setProcessStep(""); }
  };

  const saveData = useCallback(async (newData: VideoData) => {
    await fetch(`${API}/api/data`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newData)
    }).catch(() => {});
  }, []);

  const updateWord = (idx: number, word: string) => {
    if (!data) return;
    const words = [...data.words];
    words[idx] = { ...words[idx], word };
    const nd = { ...data, words };
    setData(nd); saveData(nd);
  };

  const toggleSegment = (idx: number) => {
    if (!data) return;
    const active_segments = data.active_segments.map((s, i) =>
      i === idx ? { ...s, enabled: !s.enabled } : s
    );
    const nd = { ...data, active_segments };
    setData(nd); saveData(nd);
  };

  const updateConfig = (key: keyof Config, val: any) => {
    if (!data) return;
    const nd = { ...data, config: { ...data.config, [key]: val } };
    setData(nd); saveData(nd);
  };

  const handleRender = async () => {
    if (!data) { addToast("error", "Primero procesá los clips"); return; }
    setRendering(true);
    setRenderedUrl(null);
    addToast("info", "⏳ Renderizando video con FFmpeg...");
    try {
      const r = await fetch(`${API}/api/render`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const j = await r.json();
      if (j.ok) {
        setRenderedUrl(`${API}${j.output}`);
        addToast("success", `🎬 Video listo: ${j.filename}`);
      } else {
        addToast("error", "Error render: " + j.error);
      }
    } catch (e: any) {
      addToast("error", "Error: " + e.message);
    } finally { setRendering(false); }
  };

  const seekTo = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  };

  const enabledSegments  = data?.active_segments.filter(s => s.enabled !== false) || [];
  const totalEditedDuration = enabledSegments.reduce((a, s) => a + s.duration, 0);
  const previewVideoUrl = selectedFiles.length > 0 ? `${API}/input/${encodeURIComponent(selectedFiles[selectedFiles.length - 1])}` : null;

  return (
    <>
      {/* Processing Overlay */}
      {processing && (
        <div className="processing-overlay">
          <div className="processing-card">
            <div className="processing-spinner" />
            <div className="processing-title">Procesando {selectedFiles.length} clip(s) con IA...</div>
            <div className="processing-subtitle">
              Whisper está transcribiendo tu audio localmente.<br />
              Esto puede tomar 1-5 minutos según la duración total.
            </div>
            <div className="processing-step">{processStep}</div>
          </div>
        </div>
      )}

      <div className="app-layout">
        {/* ── Header ── */}
        <header className="app-header">
          <div className="app-logo">⚡ AutoEditor IA</div>
          <div className="header-status">
            <div className={`status-dot ${serverOnline ? "" : "offline"}`} />
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {serverOnline ? "Servidor online" : "Servidor offline"}
            </span>
            {selectedFiles.length > 0 && (
              <span className="badge badge-accent">
                🎞️ {selectedFiles.length} clip(s) seleccionados
              </span>
            )}
            {data && (
              <span className="badge badge-success">
                ✂️ {fmt(totalEditedDuration)} editados
              </span>
            )}
          </div>
          <div className="header-actions">
            <button id="btn-render" className="btn btn-success btn-lg"
              onClick={handleRender} disabled={!data || rendering}>
              {rendering ? <><span className="spinner" /> Renderizando...</> : "🎬 Renderizar Video Final"}
            </button>
          </div>
        </header>

        {/* ── Sidebar ── */}
        <aside className="app-sidebar">
          {/* Upload */}
          <div className="sidebar-section">
            <div className="sidebar-label">📁 Subir clips</div>
            <div id="upload-zone"
              className={`upload-zone ${dragOver ? "drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="upload-icon">🎥</div>
              <div className="upload-text">
                <strong>Arrastrá tus clips</strong><br />
                Podés subir varios a la vez<br />
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>MP4, MOV, MKV, AVI</span>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="video/*" multiple style={{ display: "none" }}
              onChange={e => Array.from(e.target.files || []).forEach(f => handleUpload(f))} />
          </div>

          {/* File list multi-select */}
          <div className="sidebar-section" style={{ flex: 1, overflowY: "auto" }}>
            <div className="sidebar-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Clips disponibles ({files.length})</span>
              {files.length > 0 && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedFiles(files.map(f => f.name))}
                    style={{ fontSize: 10, padding: "2px 6px" }}>
                    Todos
                  </button>
                  <button className="btn btn-sm"
                    onClick={handleClearFiles}
                    style={{ fontSize: 10, padding: "2px 6px", background: "var(--danger)", color: "#fff", border: "none" }}>
                    🗑️ Limpiar
                  </button>
                </div>
              )}
            </div>
            {files.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
                No hay videos aún. Subí uno arriba ↑
              </div>
            )}
            {files.map((f, i) => {
              const isSelected = selectedFiles.includes(f.name);
              const orderIdx   = selectedFiles.indexOf(f.name);
              return (
                <div key={f.name} id={`file-${i}`}
                  className={`file-item ${isSelected ? "active" : ""}`}
                  onClick={() => toggleFile(f.name)}
                  title={`${f.name} — ${fmtSize(f.size)}\nClic para seleccionar/deseleccionar`}
                >
                  <span className="file-icon">{isSelected ? "✅" : "🎞️"}</span>
                  <span className="file-name">{f.name}</span>
                  {isSelected && (
                    <span style={{
                      background: "var(--accent)", color: "#fff",
                      borderRadius: "50%", width: 18, height: 18,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, flexShrink: 0
                    }}>{orderIdx + 1}</span>
                  )}
                </div>
              );
            })}
            {selectedFiles.length > 1 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 4px", lineHeight: 1.4 }}>
                💡 El orden de los números indica cómo se concatenarán los clips.<br />
                Los clips sin número no se procesarán.
              </div>
            )}
          </div>

          {/* Guion */}
          <div className="sidebar-section">
            <div className="sidebar-label">📝 Guion / Idea principal</div>
            <textarea
              id="input-guion"
              className="input"
              style={{ minHeight: 80, resize: "vertical", lineHeight: 1.5 }}
              placeholder="Ej: Primero presento el problema, luego explico la solución y termino con un CTA..."
              value={guion}
              onChange={e => setGuion(e.target.value)}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              El guion ayuda a dar contexto semántico a los cortes
            </div>
          </div>

          {/* Config */}
          <div className="sidebar-section">
            <div className="sidebar-label">⚙️ Configuración</div>
            <div className="config-row">
              <div className="config-label">Título del video</div>
              <input id="input-title" className="input" placeholder="Ej: Tips de productividad"
                value={title} onChange={e => { setTitle(e.target.value); if (data) updateConfig("title", e.target.value); }} />
            </div>
            <div className="config-row">
              <div className="config-label">Modelo Whisper</div>
              <select id="select-model" className="input" value={modelSize} onChange={e => setModelSize(e.target.value)}>
                <option value="tiny">tiny — Ultra rápido</option>
                <option value="base">base — Rápido ✅</option>
                <option value="small">small — Más preciso</option>
                <option value="medium">medium — Alta precisión</option>
              </select>
            </div>
            <div className="config-row">
              <div className="config-label">Idioma</div>
              <select id="select-language" className="input" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="pt">Portugués</option>
              </select>
            </div>
          </div>

          {/* Process button */}
          <div className="process-actions">
            <button id="btn-process" className="btn btn-primary btn-lg"
              onClick={handleProcess} disabled={selectedFiles.length === 0 || processing || !serverOnline}>
              {processing
                ? <><span className="spinner" /> Procesando...</>
                : `⚡ Procesar ${selectedFiles.length > 1 ? selectedFiles.length + " clips" : "clip"} con IA`}
            </button>
            {!serverOnline && (
              <div style={{ fontSize: 11, color: "var(--warning)", textAlign: "center" }}>
                ⚠️ Servidor offline. Iniciá <code>start.bat</code>
              </div>
            )}
          </div>
        </aside>

        {/* ── Player ── */}
        <main className="app-player">
          {renderedUrl ? (
            <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#000" }}>
              <div style={{ fontSize: 14, color: "var(--success)", fontWeight: 600 }}>🎬 Video renderizado listo</div>
              <video src={renderedUrl} controls style={{ maxWidth: "100%", maxHeight: "calc(100% - 80px)", objectFit: "contain" }} />
              <a href={renderedUrl} download className="btn btn-success">⬇️ Descargar video</a>
            </div>
          ) : previewVideoUrl ? (
            <>
              <div className="player-wrapper">
                <video ref={videoRef} id="main-video-player"
                  src={previewVideoUrl} controls
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              </div>
              {/* Preview de subtítulo activo */}
              {data && (() => {
                const aw = data.words.find(w => currentTime >= (w.original_start ?? w.start) && currentTime <= (w.original_end ?? w.end));
                if (!aw) return null;
                return (
                  <div style={{
                    position: "absolute", bottom: 70, left: 0, right: 0,
                    display: "flex", justifyContent: "center", pointerEvents: "none"
                  }}>
                    <div style={{
                      background: "rgba(0,0,0,0.75)", color: "#fff",
                      fontSize: 22, fontWeight: 700, padding: "6px 16px",
                      borderRadius: 8, fontFamily: "Montserrat, sans-serif",
                    }}>{aw.word}</div>
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="player-empty">
              <div className="player-empty-icon">🎬</div>
              <div>Seleccioná clips de la barra lateral</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Podés seleccionar múltiples clips para combinarlos
              </div>
            </div>
          )}
        </main>

        {/* ── Subtitles Editor ── */}
        <aside className="app-subtitles">
          <div className="card-header" style={{ padding: "10px 14px", margin: 0 }}>
            <div className="card-title">✏️ Subtítulos</div>
            {data && <span className="badge badge-muted">{data.words.length} palabras</span>}
          </div>
          <div className="subtitles-list">
            {!data ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, padding: "24px 8px" }}>
                Los subtítulos aparecerán aquí después de procesar.
              </div>
            ) : data.words.map((w, i) => {
              const isActive = currentTime >= (w.original_start ?? w.start) && currentTime <= (w.original_end ?? w.end);
              return (
                <div key={i} id={`word-${i}`} className={`subtitle-item ${isActive ? "active" : ""}`}
                  onClick={() => seekTo(w.original_start ?? w.start)}>
                  <span className="subtitle-time">{fmt(w.original_start ?? w.start)}</span>
                  <input className="subtitle-word-input" value={w.word}
                    onChange={e => updateWord(i, e.target.value)}
                    onClick={e => e.stopPropagation()} />
                  <span className="subtitle-time">{fmt(w.original_end ?? w.end)}</span>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Timeline ── */}
        <section className="app-timeline">
          <div className="timeline-header">
            <div className="card-title">📐 Línea de Tiempo</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {data && (
                <>
                  <span className="badge badge-muted">{enabledSegments.length}/{data.active_segments.length} activos</span>
                  <span className="badge badge-success">Duración: {fmt(totalEditedDuration)}</span>
                  {data.clips && data.clips.length > 1 && (
                    <span className="badge badge-accent">🎞️ {data.clips.length} clips combinados</span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="timeline-tracks">
            {!data ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, padding: "24px" }}>
                La línea de tiempo aparecerá aquí después de procesar.
              </div>
            ) : (
              <div className="timeline-track-row">
                <span className="timeline-track-label">VIDEO</span>
                <div className="timeline-inner" style={{ width: Math.max(800, data.original_duration * 80) + "px" }}>
                  <div className="timeline-playhead" style={{ left: currentTime * 80 + "px" }} />
                  
                  {/* Divisores de clips */}
                  {data.clip_boundaries && data.clip_boundaries.map((cb, i) => (
                    <div key={i} style={{
                      position: "absolute",
                      left: cb.start * 80,
                      height: "100%",
                      borderLeft: "2px dashed rgba(255,255,255,0.4)",
                      zIndex: 1,
                      pointerEvents: "none"
                    }}>
                      <span style={{ 
                        position: "absolute", top: -20, left: 4, 
                        fontSize: 10, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" 
                      }}>
                        {cb.name}
                      </span>
                    </div>
                  ))}

                  {data.active_segments.map((seg, i) => {
                    const isDisabled = seg.enabled === false;
                    return (
                      <div key={i} id={`segment-${i}`}
                        className={`timeline-segment ${isDisabled ? "disabled" : ""}`}
                        style={{ left: seg.start * 80, width: Math.max(seg.duration * 80, 8) }}
                        title={`Segmento ${i + 1}: ${fmt(seg.start)} → ${fmt(seg.end)}\nClic: ir al momento\nClic derecho: activar/desactivar`}
                        onClick={() => { if (!isDisabled) seekTo(seg.start); }}
                        onContextMenu={e => { e.preventDefault(); toggleSegment(i); }}
                      >
                        <span className="timeline-segment-text">
                          {isDisabled ? "🚫" : fmt(seg.start)}
                        </span>
                        {seg.ai_reason && isDisabled && (
                          <span style={{ position: "absolute", top: -25, left: 0, fontSize: 10, background: "var(--danger)", padding: "2px 4px", borderRadius: 4, whiteSpace: "nowrap" }}>
                            IA: {seg.ai_reason}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {data && (
              <div style={{ padding: "4px 16px 0 80px", fontSize: 10, color: "var(--text-muted)" }}>
                💡 Clic izquierdo → ir al momento • Clic derecho → activar/desactivar segmento
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </>
  );
}
