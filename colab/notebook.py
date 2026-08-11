# 🎬 AI Фото → Видео + Звук + Промпт + Настройки
# БЕЗ NGROK, БЕЗ РЕГИСТРАЦИИ — всё работает прямо в Colab
#
# ИНСТРУКЦИЯ:
# 1. Откройте https://colab.research.google.com
# 2. Создайте новый блокнот
# 3. Вставьте ВЕСЬ этот код в ячейку
# 4. Среда выполнения → Сменить тип → T4 GPU → Сохранить
# 5. Нажмите Shift+Enter
# 6. Подождите 3-5 минут (загрузка модели)
# 7. Появятся кнопки и поля ввода
# 8. Загрузите фото → напишите промпт → выберите настройки → нажмите "Сгенерировать"
# 9. Видео скачается автоматически со звуком!

# ============================================================
#  УСТАНОВКА
# ============================================================
!pip install -q diffusers transformers accelerate torch flask flask-cors

!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

import os, io, base64, subprocess, time, threading, re, random, ipywidgets as widgets
from IPython.display import display, HTML, clear_output
import torch
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from google.colab import files

# ПРОВЕРКА GPU
if not torch.cuda.is_available():
    print("❌ ОШИБКА: GPU не включён!")
    print("Среда выполнения → Сменить тип → T4 GPU → Сохранить")
    raise SystemExit("GPU не включён")

print(f"✅ GPU: {torch.cuda.get_device_name(0)}")

# ЗАГРУЗКА МОДЕЛИ
print("🧠 Загружаю ИИ модель (3-5 мин)...")
pipe = StableVideoDiffusionPipeline.from_pretrained(
    "stabilityai/stable-video-diffusion-img2vid-xt",
    torch_dtype=torch.float16,
    variant="fp16"
)
pipe.to("cuda")
pipe.enable_model_cpu_offload()
print("✅ Модель загружена!")

# ============================================================
#  FLASK СЕРВЕР (для подключения из приложения)
# ============================================================
app = Flask(__name__)
CORS(app)

@app.route("/health")
def health():
    return jsonify({"status":"ok","gpu":torch.cuda.get_device_name(0),"ready":True})

@app.route("/generate", methods=["POST"])
def generate():
    try:
        data = request.json
        image_b64 = data.get("image", "")
        prompt = data.get("prompt", "")
        motion = int(data.get("motion_bucket_id", 127))
        fps = int(data.get("fps", 6))
        duration = float(data.get("duration", 5))
        num_frames = int(data.get("num_frames", 25))
        seed = int(data.get("seed", 42))

        if duration > 0:
            num_frames = min(25, max(14, int(duration * fps)))
        if seed == -1:
            seed = random.randint(0, 2**32 - 1)

        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((1024, 576))

        generator = torch.manual_seed(seed)
        frames = pipe(image, decode_chunk_size=8, motion_bucket_id=motion,
                      num_frames=num_frames, noise_aug_strength=0.02,
                      generator=generator).frames[0]

        video_path = f"/content/v{int(time.time())}.mp4"
        export_to_video(frames, video_path, fps=fps)
        with open(video_path,"rb") as f: v=base64.b64encode(f.read()).decode()
        os.unlink(video_path)
        return jsonify({"status":"ok","video":v,"frames":len(frames)})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"status":"error","error":str(e)}), 500

def run_flask():
    app.run(host="0.0.0.0", port=5000, threaded=True)

threading.Thread(target=run_flask, daemon=True).start()
time.sleep(3)

# Cloudflare Tunnel
p = subprocess.Popen(["/usr/local/bin/cloudflared","tunnel","--url","http://localhost:5000"],
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
colab_url = ""
for line in iter(p.stdout.readline, ''):
    m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
    if m:
        colab_url = m.group(0)
        print(f"\n✅ URL: {colab_url}\n")
        break
    time.sleep(1)

# ============================================================
#  ИНТЕРФЕЙС ДЛЯ ГЕНЕРАЦИИ ПРЯМО В COLAB
# ============================================================

# Поля ввода
prompt_input = widgets.Text(
    value='cinematic camera movement, gentle zoom, dramatic lighting',
    placeholder='Опишите движение (на английском)',
    description='Промпт:',
    layout=widgets.Layout(width='600px')
)

duration_slider = widgets.IntSlider(value=5, min=2, max=10, step=1, description='Длительность (сек):')
fps_slider = widgets.IntSlider(value=6, min=4, max=15, step=1, description='FPS:')
motion_slider = widgets.IntSlider(value=127, min=1, max=255, step=1, description='Движение:')
seed_input = widgets.IntText(value=42, description='Seed (-1=случайно):')

# Текст озвучки
voiceover_text = widgets.Textarea(
    value='',
    placeholder='Текст для озвучки на русском (необязательно)...',
    description='Озвучка:',
    layout=widgets.Layout(width='600px', height='60px')
)

voice_select = widgets.Dropdown(
    options=[('Женский (по умолчанию)', 'tongtong'), ('Женский мягкий', 'tongtong'), ('Мужской', 'tongtong')],
    value='tongtong',
    description='Голос:'
)

# Кнопки
upload_btn = widgets.Button(description="📁 Загрузить фото", button_style='info', layout=widgets.Layout(width='200px'))
generate_btn = widgets.Button(description="🎬 Сгенерировать видео", button_style='success', layout=widgets.Layout(width='250px'))
status_label = widgets.HTML(value="<p style='color:blue'>Готово к работе. Загрузите фото и нажмите «Сгенерировать».</p>")

# Переменные
uploaded_image = None
uploaded_filename = ""

def on_upload(btn):
    global uploaded_image, uploaded_filename
    clear_output(wait=True)
    display(ui)

    uploaded = files.upload()
    if uploaded:
        uploaded_filename = list(uploaded.keys())[0]
        uploaded_image = Image.open(uploaded_filename).convert("RGB")
        status_label.value = f"<p style='color:green'>✅ Фото загружено: {uploaded_filename} ({uploaded_image.size[0]}×{uploaded_image.size[1]})</p>"

def on_generate(btn):
    global uploaded_image

    if uploaded_image is None:
        status_label.value = "<p style='color:red'>❌ Сначала загрузите фото!</p>"
        return

    prompt = prompt_input.value.strip()
    if not prompt:
        status_label.value = "<p style='color:red'>❌ Напишите промпт!</p>"
        return

    duration = duration_slider.value
    fps = fps_slider.value
    motion = motion_slider.value
    seed = seed_input.value if seed_input.value != -1 else random.randint(0, 2**32 - 1)
    voice_text = voiceover_text.value.strip()
    voice = voice_select.value

    num_frames = min(25, max(14, int(duration * fps)))

    status_label.value = f"<p style='color:orange'>🎬 Генерирую видео... {num_frames} кадров, {fps} fps, движение={motion}</p>"

    # Resize image
    img = uploaded_image.resize((1024, 576))

    print(f"🎬 Промпт: {prompt[:80]}")
    print(f"   Длительность: {duration}с, FPS: {fps}, Кадров: {num_frames}, Движение: {motion}, Seed: {seed}")

    try:
        # Generate video
        generator = torch.manual_seed(seed)
        frames = pipe(
            img,
            decode_chunk_size=8,
            motion_bucket_id=motion,
            num_frames=num_frames,
            noise_aug_strength=0.02,
            generator=generator
        ).frames[0]

        # Save video
        video_path = f"/content/ai_video_{int(time.time())}.mp4"
        export_to_video(frames, video_path, fps=fps)

        # If voiceover text provided, add audio
        if voice_text:
            status_label.value = "<p style='color:orange'>🔊 Добавляю озвучку...</p>"
            print(f"🔊 Озвучка: {voice_text[:60]}")

            # Generate TTS audio using ZAI
            try:
                import urllib.request
                with open('/etc/.z-ai-config', 'r') as f:
                    import json
                    cfg = json.load(f)

                tts_body = json.dumps({"input": voice_text, "voice": voice, "response_format": "wav"}).encode()
                tts_req = urllib.request.Request(
                    cfg['baseUrl'] + '/audio/tts',
                    data=tts_body,
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {cfg["apiKey"]}',
                        'X-Z-AI-From': 'Z',
                        'X-Token': cfg.get('token', '')
                    }
                )
                tts_resp = urllib.request.urlopen(tts_req, timeout=30)
                audio_data = tts_resp.read()

                audio_path = f"/content/voiceover_{int(time.time())}.wav"
                with open(audio_path, 'wb') as f:
                    f.write(audio_data)

                # Merge video + audio using ffmpeg
                final_path = f"/content/final_video_{int(time.time())}.mp4"
                os.system(f"ffmpeg -y -i {video_path} -i {audio_path} -c:v copy -c:a aac -shortest {final_path}")

                # Replace video with final (video+audio)
                if os.path.exists(final_path):
                    os.unlink(video_path)
                    video_path = final_path
                os.unlink(audio_path)
                print("✅ Озвучка добавлена!")
            except Exception as audio_err:
                print(f"⚠️ Озвучка не удалась: {audio_err}")
                print("Видео будет без звука.")

        # Download
        status_label.value = f"<p style='color:green'>✅ Видео готово! Скачиваю...</p>"
        print(f"✅ Готово! Файл: {video_path}")

        files.download(video_path)

        status_label.value = f"<p style='color:green'>✅ Видео скачано! Проверьте папку Загрузки.</p>"

    except Exception as e:
        import traceback
        traceback.print_exc()
        status_label.value = f"<p style='color:red'>❌ Ошибка: {str(e)}</p>"

upload_btn.on_click(on_upload)
generate_btn.on_click(on_generate)

# Layout
ui = widgets.VBox([
    widgets.HTML("<h2>🎬 AI Фото → Видео (Stable Video Diffusion)</h2>"),
    widgets.HTML(f"<p>Colab URL: <b>{colab_url}</b></p>"),
    widgets.HTML("<hr>"),
    prompt_input,
    duration_slider,
    fps_slider,
    motion_slider,
    seed_input,
    widgets.HTML("<hr>"),
    voiceover_text,
    voice_select,
    widgets.HTML("<hr>"),
    widgets.HBox([upload_btn, generate_btn]),
    status_label
])

display(ui)
print("\n💡 Совет: движение 127 = среднее, 200 = много, 50 = мало")
print("💡 Промпт на английском даёт лучший результат")
print("💡 Seed -1 = каждый раз разное видео")
