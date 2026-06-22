/**
 * VideoComposition.tsx
 * Composición principal de Remotion que lee data.json y renderiza el video editado.
 * - Encadena segmentos de voz activa (sin silencios)
 * - Subtítulos sincronizados palabra por palabra (karaoke style)
 * - Overlay de título configurable
 */
import { useEffect, useState } from "react";
import {
  AbsoluteFill, Series, OffthreadVideo,
  useCurrentFrame, useVideoConfig,
  interpolate, spring, staticFile
} from "remotion";
import * as path from "path";
import * as fs from "fs";

// ── Types (compartidos con el frontend) ──────────────────────────────────────
interface Segment { start: number; end: number; duration: number; enabled?: boolean; }
interface Word    { word: string; start: number; end: number; }
interface SubtitleStyle {
  font: string; size: number; color: string; highlight: string;
  stroke: string; words_per_line: number;
}
interface Config {
  title: string; title_start_sec: number; title_end_sec: number;
  music_volume: number; subtitle_style: SubtitleStyle;
}
interface VideoData {
  config: Config; original_duration: number; edited_duration: number;
  active_segments: Segment[]; words: Word[]; full_text: string; language: string;
}

// ── Leer data.json desde la raíz del proyecto ────────────────────────────────
function loadData(): VideoData | null {
  try {
    const dataPath = path.resolve(__dirname, "../../data.json");
    const raw = fs.readFileSync(dataPath, "utf-8");
    return JSON.parse(raw) as VideoData;
  } catch { return null; }
}

// ── Subtitle Component ────────────────────────────────────────────────────────
function SubtitleLayer({ words, style, fps }: { words: Word[]; style: SubtitleStyle; fps: number }) {
  const frame = useCurrentFrame();
  const currentSec = frame / fps;

  // Encontrar la palabra activa
  const activeIdx = words.findIndex(w => currentSec >= w.start && currentSec < w.end);
  const activeWord = activeIdx >= 0 ? words[activeIdx] : null;

  // Agrupar palabras en grupos de N para subtítulos de bloque
  const n = style.words_per_line || 2;
  const groupIdx = activeIdx >= 0 ? Math.floor(activeIdx / n) : -1;
  const groupStart = groupIdx * n;
  const groupWords = groupIdx >= 0 ? words.slice(groupStart, groupStart + n) : [];

  if (groupWords.length === 0) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 80 }}>
      <div style={{
        display: "flex", gap: 8, alignItems: "center", justifyContent: "center",
        flexWrap: "wrap", padding: "8px 20px",
        background: "rgba(0,0,0,0.55)", borderRadius: 12,
        maxWidth: "85%",
      }}>
        {groupWords.map((w, i) => {
          const isActive = w === activeWord;
          return (
            <span key={i} style={{
              fontFamily: `${style.font || "Montserrat"}, sans-serif`,
              fontSize: style.size || 70,
              fontWeight: 900,
              color: isActive ? (style.highlight || "#FFDD00") : (style.color || "#FFFFFF"),
              textShadow: `
                -3px -3px 0 ${style.stroke || "#000"},
                3px -3px 0 ${style.stroke || "#000"},
                -3px 3px 0 ${style.stroke || "#000"},
                3px 3px 0 ${style.stroke || "#000"}
              `,
              transition: "color 0.1s",
              display: "inline-block",
              transform: isActive ? "scale(1.08)" : "scale(1)",
            }}>
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// ── Title Overlay Component ───────────────────────────────────────────────────
function TitleOverlay({ config, fps }: { config: Config; fps: number }) {
  const frame = useCurrentFrame();
  const currentSec = frame / fps;
  const { title, title_start_sec, title_end_sec } = config;

  if (!title) return null;
  if (currentSec < title_start_sec || currentSec > title_end_sec) return null;

  const fadeIn = interpolate(currentSec, [title_start_sec, title_start_sec + 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(currentSec, [title_end_sec - 0.4, title_end_sec], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "center", paddingTop: 60, opacity }}>
      <div style={{
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(8px)",
        padding: "10px 24px",
        borderRadius: 12,
        borderLeft: "4px solid #6c63ff",
      }}>
        <span style={{
          fontFamily: "Montserrat, sans-serif",
          fontSize: 52,
          fontWeight: 900,
          color: "#fff",
          textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
          lineHeight: 1.2,
        }}>
          {title}
        </span>
      </div>
    </AbsoluteFill>
  );
}

// ── Main Composition ──────────────────────────────────────────────────────────
export function VideoComposition() {
  const { fps } = useVideoConfig();
  const data = loadData();

  if (!data) {
    return (
      <AbsoluteFill style={{ background: "#0a0b0f", justifyContent: "center", alignItems: "center" }}>
        <p style={{ color: "red", fontFamily: "sans-serif", fontSize: 32 }}>
          ❌ No se encontró data.json. Procesá un video desde el editor web.
        </p>
      </AbsoluteFill>
    );
  }

  const { config, active_segments, words } = data;
  const enabledSegments = active_segments.filter(s => s.enabled !== false);

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Video: encadenar segmentos activos */}
      <Series>
        {enabledSegments.map((seg, i) => {
          const durationFrames = Math.round(seg.duration * fps);
          return (
            <Series.Sequence key={i} durationInFrames={Math.max(durationFrames, 1)}>
              <AbsoluteFill>
                <OffthreadVideo
                  src={staticFile("video.mp4")}
                  startFrom={Math.round(seg.start * fps)}
                  endAt={Math.round(seg.end * fps)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </AbsoluteFill>
            </Series.Sequence>
          );
        })}
      </Series>

      {/* Subtítulos */}
      <SubtitleLayer words={words} style={config.subtitle_style} fps={fps} />

      {/* Título */}
      <TitleOverlay config={config} fps={fps} />
    </AbsoluteFill>
  );
}
