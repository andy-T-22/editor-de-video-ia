import sys
import json
import os

def run_semantic_analysis(data_path):
    print("[IA Semántica] Iniciando análisis...")
    with open(data_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    guion = data.get("guion", "").strip()
    segments = data.get("active_segments", [])
    words = data.get("words", [])

    if not guion or not segments:
        print("[IA Semántica] Guion vacío o sin segmentos. Saltando.")
        return

    # Construir el texto de cada segmento para enviarlo al modelo
    # Esto es heurístico basado en tiempos
    for i, seg in enumerate(segments):
        # Encontrar las palabras que caen dentro de este segmento
        seg_words = [w["word"] for w in words if w["start"] >= seg["start"] - 0.2 and w["end"] <= seg["end"] + 0.2]
        seg["text"] = " ".join(seg_words).strip()

    import torch
    from transformers import pipeline

    print("[IA Semántica] Cargando modelo (esto puede tardar la primera vez)...")
    # Usamos Qwen2.5-0.5B-Instruct, muy rápido y excelente en español
    pipe = pipeline("text-generation", model="Qwen/Qwen2.5-0.5B-Instruct", device_map="auto")

    # Armar el prompt
    prompt = f"Eres un editor de video inteligente. Se te da la idea original (guion) y los segmentos transcritos de un video.\n"
    prompt += f"Tu tarea es identificar qué segmentos son errores, tartamudeos o divagaciones que NO aportan a la idea original.\n\n"
    prompt += f"GUION/IDEA ORIGINAL:\n{guion}\n\n"
    prompt += f"SEGMENTOS:\n"
    
    # Para no saturar el contexto, filtramos los que tienen texto muy corto que podrían ser silencios
    valid_indices = []
    for i, seg in enumerate(segments):
        if len(seg.get("text", "")) > 3:
            prompt += f"ID: {i} | Texto: {seg['text']}\n"
            valid_indices.append(i)

    prompt += "\nBasado en lo anterior, devuelve ÚNICAMENTE una lista JSON con los IDs de los segmentos que deben ser ELIMINADOS por ser irrelevantes o errores. Por ejemplo: [1, 4]. Si todos son relevantes, devuelve []."

    messages = [
        {"role": "system", "content": "Eres un asistente estricto que responde solo con arreglos JSON."},
        {"role": "user", "content": prompt}
    ]

    print("[IA Semántica] Generando respuesta...")
    try:
        response = pipe(messages, max_new_tokens=50, do_sample=False)
        output_text = response[0]['generated_text'][-1]['content'].strip()
        print(f"[IA Semántica] Respuesta cruda: {output_text}")
        
        # Intentar parsear el JSON
        start_idx = output_text.find('[')
        end_idx = output_text.rfind(']') + 1
        if start_idx != -1 and end_idx != -1:
            json_str = output_text[start_idx:end_idx]
            to_remove = json.loads(json_str)
            if isinstance(to_remove, list):
                print(f"[IA Semántica] Segmentos a desactivar: {to_remove}")
                # Desactivar en data.json
                for i in to_remove:
                    if isinstance(i, int) and 0 <= i < len(segments):
                        segments[i]["enabled"] = False
                        segments[i]["ai_reason"] = "Descartado por IA según el guion."
            
                # Guardar cambios
                with open(data_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print("[IA Semántica] data.json actualizado exitosamente.")
            else:
                print("[IA Semántica] Formato JSON no es una lista.")
        else:
            print("[IA Semántica] No se encontró un arreglo JSON en la respuesta.")
    except Exception as e:
        print(f"[IA Semántica] Error al inferir: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_semantic_analysis(sys.argv[1])
