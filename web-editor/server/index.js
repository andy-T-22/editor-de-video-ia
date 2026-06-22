/**
 * index.js - Servidor API local para AutoEditor IA
 * Multi-clip: concatena varios clips con FFmpeg antes de transcribir.
 * Render final: FFmpeg (no Remotion), sin necesidad de Chromium.
 */
const express   = require("express");
const cors      = require("cors");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const { execSync, spawnSync } = require("child_process");

const app  = express();
const PORT = 3001;

// ── Rutas absolutas ───────────────────────────────────────────────────────────
const ROOT         = path.resolve(__dirname, "../..");
const INPUT_DIR    = path.join(ROOT, "input");
const OUTPUT_DIR   = path.join(ROOT, "output");
const SCRIPTS_DIR  = path.join(ROOT, "scripts");
const BIN_DIR      = path.join(ROOT, "bin");
const DATA_PATH    = path.join(ROOT, "data.json");
const CONCAT_VIDEO = path.join(ROOT, "concat_video.mp4");  // Video concatenado temporal

const FFMPEG_BIN  = path.join(BIN_DIR, "ffmpeg.exe");
const FFPROBE_BIN = path.join(BIN_DIR, "ffprobe.exe");
const FFMPEG_PATH = fs.existsSync(FFMPEG_BIN) ? FFMPEG_BIN : "ffmpeg";
const FFPROBE_PATH = fs.existsSync(FFPROBE_BIN) ? FFPROBE_BIN : "ffprobe";

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/input",  express.static(INPUT_DIR));
app.use("/output", express.static(OUTPUT_DIR));

// ── Upload ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INPUT_DIR),
  filename:    (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.post("/api/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo" });
  res.json({ ok: true, filename: req.file.filename });
});

// ── Listar videos ─────────────────────────────────────────────────────────────
app.get("/api/files", (req, res) => {
  const exts = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
  try {
    const files = fs.readdirSync(INPUT_DIR)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(INPUT_DIR, f));
        return { name: f, url: `/input/${encodeURIComponent(f)}`, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => new Date(a.mtime) - new Date(b.mtime)); // más antiguos primero
    res.json({ files });
  } catch { res.json({ files: [] }); }
});

// ── Borrar todos los videos ───────────────────────────────────────────────────
app.delete("/api/files", (req, res) => {
  try {
    const files = fs.readdirSync(INPUT_DIR);
    for (const f of files) fs.unlinkSync(path.join(INPUT_DIR, f));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CONCATENAR múltiples clips con FFmpeg ─────────────────────────────────────
function concatClips(clipPaths, outputPath) {
  let boundaries = [];
  let currentStart = 0;

  for (const p of clipPaths) {
    try {
      const durStr = execSync(`"${FFPROBE_PATH}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}"`).toString().trim();
      const dur = parseFloat(durStr) || 0;
      boundaries.push({ name: path.basename(p), start: currentStart, end: currentStart + dur, duration: dur });
      currentStart += dur;
    } catch (e) {
      boundaries.push({ name: path.basename(p), start: currentStart, end: currentStart, duration: 0 });
    }
  }

  if (clipPaths.length === 1) {
    // Un solo clip: solo re-encodear para normalizar
    execSync(
      `"${FFMPEG_PATH}" -y -i "${clipPaths[0]}" -c:v libx264 -c:a aac -preset fast "${outputPath}"`,
      { timeout: 300000 }
    );
    return boundaries;
  }

  // Crear archivo de lista para ffmpeg concat
  const listPath = path.join(ROOT, "concat_list.txt");
  const listContent = clipPaths.map(p => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");

  // Concatenar con re-encode para garantizar compatibilidad entre clips de distintos orígenes
  execSync(
    `"${FFMPEG_PATH}" -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -c:a aac -preset fast -movflags +faststart "${outputPath}"`,
    { timeout: 600000 }
  );
  fs.unlinkSync(listPath);
  return boundaries;
}

// ── PROCESAR: detectar silencios + transcribir + construir data.json ──────────
app.post("/api/process", (req, res) => {
  const { filenames, title, model_size, language, guion } = req.body;

  if (!filenames || !Array.isArray(filenames) || filenames.length === 0)
    return res.status(400).json({ error: "Falta la lista de filenames" });

  const clipPaths = filenames.map(f => path.join(INPUT_DIR, f));
  for (const p of clipPaths) {
    if (!fs.existsSync(p)) return res.status(404).json({ error: `Archivo no encontrado: ${path.basename(p)}` });
  }

  const modelSize = model_size || "base";
  const lang      = language   || "es";
  const silenceJson = path.join(ROOT, "silence.json");
  const transcJson  = path.join(ROOT, "transcription.json");

  try {
    // 1. Concatenar clips → un único video temporal
    console.log(`[Server] Concatenando ${clipPaths.length} clip(s)...`);
    const clip_boundaries = concatClips(clipPaths, CONCAT_VIDEO);
    console.log("[Server] Concatenación OK →", CONCAT_VIDEO);

    // Guardar metadata de clips originales en data.json (para info de UI)
    const clipsMeta = filenames.map((f, i) => ({ name: f, index: i }));

    // 2. Detectar silencios en el video concatenado
    console.log("[Server] Detectando silencios...");
    const silenceOut = execSync(
      `python "${path.join(SCRIPTS_DIR, "silence_detect.py")}" "${CONCAT_VIDEO}" "${FFMPEG_PATH}"`,
      { cwd: ROOT, timeout: 120000 }
    ).toString();
    fs.writeFileSync(silenceJson, silenceOut);

    // 3. Transcribir con faster-whisper local
    console.log("[Server] Transcribiendo con faster-whisper local...");
    const transcOut = execSync(
      `python "${path.join(SCRIPTS_DIR, "transcribe.py")}" "${CONCAT_VIDEO}" "${modelSize}" "${lang}"`,
      { cwd: ROOT, timeout: 600000 }
    ).toString();
    fs.writeFileSync(transcJson, transcOut);

    // 4. Construir data.json con info de guion y clips
    console.log("[Server] Construyendo data.json...");
    const guionEscaped = (guion || "").replace(/"/g, '\\"');
    execSync(
      `python "${path.join(SCRIPTS_DIR, "build_data.py")}" "${silenceJson}" "${transcJson}" "${DATA_PATH}" "${title || ""}" "${guionEscaped}"`,
      { cwd: ROOT, timeout: 30000 }
    );

    // Añadir info de clips al data.json
    let data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
    data.clips = clipsMeta;
    data.clip_boundaries = clip_boundaries;
    data.guion = guion || "";
    data.concat_video = "concat_video.mp4";
    data.active_segments = data.active_segments.map(s => ({ ...s, enabled: true }));
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");

    // 5. Análisis semántico con IA (Opcional, si hay guion)
    if (guion && guion.trim() !== "") {
      console.log("[Server] Ejecutando análisis semántico con IA local...");
      try {
        execSync(
          `python "${path.join(SCRIPTS_DIR, "semantic_ai.py")}" "${DATA_PATH}"`,
          { cwd: ROOT, timeout: 300000 }
        );
        // Recargar data.json porque semantic_ai.py lo modificó
        data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
      } catch (e) {
        console.error("[Server] Error en IA Semántica (ignorando):", e.message);
      }
    }

    console.log("[Server] ✅ Proceso completo.");
    res.json({ ok: true, data });

  } catch (e) {
    console.error("[Server] ❌ Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Leer data.json ─────────────────────────────────────────────────────────────
app.get("/api/data", (req, res) => {
  if (!fs.existsSync(DATA_PATH)) return res.json(null); // null en vez de 404
  try {
    res.json(JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")));
  } catch { res.json(null); }
});

// ── Guardar data.json editado ──────────────────────────────────────────────────
app.put("/api/data", (req, res) => {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RENDER FINAL con FFmpeg (sin Chromium, sin Remotion) ──────────────────────
app.post("/api/render", (req, res) => {
  if (!fs.existsSync(DATA_PATH))
    return res.status(400).json({ error: "No hay data.json. Procesá un video primero." });
  if (!fs.existsSync(CONCAT_VIDEO))
    return res.status(400).json({ error: "No hay video concatenado. Procesá los clips primero." });

  let data;
  try { data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")); }
  catch { return res.status(500).json({ error: "data.json inválido." }); }

  const { config, active_segments, words } = data;
  const enabledSegs = active_segments.filter(s => s.enabled !== false);

  if (enabledSegs.length === 0)
    return res.status(400).json({ error: "No hay segmentos activos. Activá al menos uno en la timeline." });

  try {
    // 1. Generar archivo de subtítulos .ass (Advanced SubStation Alpha)
    //    Este formato soporta colores por palabra, posición y fuente personalizada
    const assPath = path.join(ROOT, "subtitles.ass");
    generateASS(words, config.subtitle_style, assPath);

    // 2. Generar archivo de cortes: filter_complex para concatenar segmentos activos
    const outputName = `edited_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);

    // Construir filtro de trim+concat para FFmpeg
    const filterParts = [];
    const concatInputs = [];
    enabledSegs.forEach((seg, i) => {
      filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
      filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
      concatInputs.push(`[v${i}][a${i}]`);
    });
    filterParts.push(`${concatInputs.join("")}concat=n=${enabledSegs.length}:v=1:a=1[vout][aout]`);

    // Añadir subtítulos al vout
    const assPathEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    filterParts.push(`[vout]ass='${assPathEscaped}'[vfinal]`);

    const filterComplex = filterParts.join(";");

    console.log("[Server] Iniciando render FFmpeg...");
    execSync(
      `"${FFMPEG_PATH}" -y -i "${CONCAT_VIDEO}" -filter_complex "${filterComplex}" -map "[vfinal]" -map "[aout]" -c:v libx264 -c:a aac -preset fast -crf 23 -movflags +faststart "${outputPath}"`,
      { timeout: 1200000, maxBuffer: 10 * 1024 * 1024 }
    );

    console.log("[Server] ✅ Render completo:", outputPath);
    res.json({ ok: true, output: `/output/${outputName}`, filename: outputName });

  } catch (e) {
    console.error("[Server] ❌ Error render:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Generar archivo .ass de subtítulos ────────────────────────────────────────
function generateASS(words, style, outputPath) {
  const font   = (style && style.font)      || "Arial";
  const size   = (style && style.size)      || 60;
  const color  = hexToAssColor((style && style.color)     || "#FFFFFF");
  const stroke = hexToAssColor((style && style.stroke)    || "#000000");
  const highlight = hexToAssColor((style && style.highlight) || "#FFDD00");
  const n      = (style && style.words_per_line) || 2;

  // Header .ass
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${size},${color},${color},${stroke},&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  // Agrupar palabras en grupos de N
  const groups = [];
  for (let i = 0; i < words.length; i += n) {
    const group = words.slice(i, i + n);
    if (group.length > 0) {
      groups.push({
        start: group[0].start,
        end:   group[group.length - 1].end,
        words: group
      });
    }
  }

  // Generar eventos: un evento por grupo, con karaoke por palabra
  for (const group of groups) {
    if (group.end <= group.start) continue;
    // Construir texto con tags karaoke: {\k<duration>} en centésimas de segundo
    let text = "";
    let prevEnd = group.start;
    for (const w of group.words) {
      const dur = Math.round((w.end - w.start) * 100); // centésimas
      text += `{\\kf${dur}}${w.word} `;
    }
    text = text.trim();
    // Diálogo con karaoke
    ass += `Dialogue: 0,${toASSTime(group.start)},${toASSTime(group.end)},Default,,0,0,0,,{\\k0}${text}\n`;
  }

  fs.writeFileSync(outputPath, ass, "utf-8");
}

function toASSTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${s}`;
}

function hexToAssColor(hex) {
  // ASS usa AABBGGRR
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `&H00${b.toString(16).padStart(2,"0").toUpperCase()}${g.toString(16).padStart(2,"0").toUpperCase()}${r.toString(16).padStart(2,"0").toUpperCase()}`;
}

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, version: "2.0.0", ffmpeg: fs.existsSync(FFMPEG_BIN) ? FFMPEG_BIN : "PATH" });
});

app.listen(PORT, () => {
  console.log(`\n🚀 AutoEditor IA v2.0 — API en http://localhost:${PORT}`);
  console.log(`   FFmpeg:  ${FFMPEG_PATH}`);
  console.log(`   Input:   ${INPUT_DIR}`);
  console.log(`   Output:  ${OUTPUT_DIR}\n`);
});
