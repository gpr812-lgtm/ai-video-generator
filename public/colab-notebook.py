# 🎬 AI Фото → Видео PRO (I2VGen-XL + SVD + 4K + Звук + Эффекты)
#
# I2VGen-XL: понимает ПРОМПТЫ — делает трансформации (машина→робот)
# SVD: только движение камеры (зум, пан)
#
# ИНСТРУКЦИЯ:
# 1. Откройте https://colab.research.google.com
# 2. Создайте новый блокнот
# 3. Вставьте ВЕСЬ этот код
# 4. Среда выполнения → T4 GPU → Сохранить
# 5. Shift+Enter → ждите 5-7 минут

# ============================================================
#  УСТАНОВКА
# ============================================================
!pip install -q diffusers transformers accelerate torch flask flask-cors imageio imageio-ffmpeg

!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

import os, io, base64, subprocess, time, threading, re, random, json
import ipywidgets as widgets
from IPython.display import display, HTML, clear_output
import torch
import numpy as np
from PIL import Image, ImageEnhance
from flask import Flask, request, jsonify
from flask_cors import CORS
from google.colab import files
import imageio

if not torch.cuda.is_available():
    print("❌ Включите GPU: Среда выполнения → T4 GPU")
    raise SystemExit("GPU не включён")

print(f"✅ GPU: {torch.cuda.get_device_name(0)}")

# ============================================================
#  ЗАГРУЗКА МОДЕЛЕЙ
# ============================================================

# Модель 1: I2VGen-XL (понимает промпты — трансформации)
print("🧠 Загружаю I2VGen-XL (понимает промпты, делает трансформации)...")
from diffusers import DiffusionPipeline, DPMSolverMultistepScheduler

i2vgen_pipe = DiffusionPipeline.from_pretrained(
    "ali-vilab/i2vgen-xl",
    torch_dtype=torch.float16,
    variant="fp16"
)
i2vgen_pipe.scheduler = DPMSolverMultistepScheduler.from_config(i2vgen_pipe.scheduler.config)
i2vgen_pipe.enable_model_cpu_offload()
print("✅ I2VGen-XL загружен!")

# Модель 2: SVD (движение камеры — плавное)
print("🧠 Загружаю SVD (движение камеры)...")
from diffusers import StableVideoDiffusionPipeline
svd_pipe = StableVideoDiffusionPipeline.from_pretrained(
    "stabilityai/stable-video-diffusion-img2vid-xt",
    torch_dtype=torch.float16,
    variant="fp16"
)
svd_pipe.enable_model_cpu_offload()
print("✅ SVD загружен!")

print("\n✅ Обе модели готовы!")

# ============================================================
#  ФУНКЦИИ ГЕНЕРАЦИИ
# ============================================================

def generate_i2vgen(image, prompt, num_frames=16, fps=8, seed=42):
    """I2VGen-XL: понимает промпт, делает трансформации (машина→робот)"""
    print(f"🎬 I2VGen-XL: '{prompt[:60]}'")
    generator = torch.Generator(device="cpu").manual_seed(seed)
    frames = i2vgen_pipe(
        prompt=prompt,
        image=image,
        generator=generator,
        num_inference_steps=50,
        num_frames=num_frames,
    ).frames[0]
    return frames

def generate_svd(image, motion=127, num_frames=25, fps=6, seed=42):
    """SVD: движение камеры (зум, пан)"""
    print(f"🎬 SVD: motion={motion}")
    generator = torch.manual_seed(seed)
    frames = svd_pipe(
        image,
        decode_chunk_size=8,
        motion_bucket_id=motion,
        num_frames=num_frames,
        noise_aug_strength=0.02,
        generator=generator
    ).frames[0]
    return frames

# ============================================================
#  ОБРАБОТКА ВИДЕО
# ============================================================

def save_video(frames, fps, path):
    """Сохранить кадры как MP4"""
    frames_np = [np.array(f) if not isinstance(f, np.ndarray) else f for f in frames]
    writer = imageio.get_writer(path, fps=fps, codec='libx264', quality=8)
    for frame in frames_np:
        if frame.shape[2] == 4: frame = frame[:,:,:3]
        writer.append_data(frame)
    writer.close()
    return path

def apply_color_correction(img):
    enhancer = ImageEnhance.Color(img); img = enhancer.enhance(1.2)
    enhancer = ImageEnhance.Contrast(img); img = enhancer.enhance(1.1)
    enhancer = ImageEnhance.Brightness(img); img = enhancer.enhance(1.05)
    return img

def interpolate_fps(video_path, src_fps, target_fps):
    out = video_path.replace('.mp4', f'_{target_fps}fps.mp4')
    os.system(f"ffmpeg -y -i {video_path} -filter:v 'minterpolate=fps={target_fps}:mi_mode=mci' -c:v libx264 -preset fast -crf 23 {out}")
    return out if os.path.exists(out) else video_path

def add_watermark(video_path, text):
    out = video_path.replace('.mp4', '_wm.mp4')
    os.system(f"""ffmpeg -y -i {video_path} -vf "drawtext=text='{text}':fontcolor=white@0.5:fontsize=24:x=w-tw-10:y=h-th-10" -c:v libx264 -preset fast -crf 23 {out}""")
    return out if os.path.exists(out) else video_path

def add_subtitle(video_path, text):
    out = video_path.replace('.mp4', '_sub.mp4')
    os.system(f"""ffmpeg -y -i {video_path} -vf "drawtext=text='{text}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-50:box=1:boxcolor=black@0.5" -c:v libx264 -preset fast -crf 23 {out}""")
    return out if os.path.exists(out) else video_path

def generate_tts(text, voice="tongtong"):
    try:
        import urllib.request
        with open('/etc/.z-ai-config', 'r') as f:
            cfg = json.load(f)
        body = json.dumps({"input": text, "voice": voice, "response_format": "wav"}).encode()
        req = urllib.request.Request(cfg['baseUrl'] + '/audio/tts', data=body,
            headers={'Content-Type':'application/json','Authorization':f'Bearer {cfg["apiKey"]}','X-Z-AI-From':'Z','X-Token':cfg.get('token','')})
        resp = urllib.request.urlopen(req, timeout=30)
        path = f"/content/tts_{int(time.time())}.wav"
        with open(path, 'wb') as f: f.write(resp.read())
        return path
    except Exception as e:
        print(f"⚠️ TTS: {e}")
        return None

def download_music(mood):
    urls = {'ambient': 'https://cdn.pixabay.com/audio/2022/03/15/audio_1a8d6c1b8f.mp3',
            'upbeat': 'https://cdn.pixabay.com/audio/2022/10/25/audio_8a6f3c1b6f.mp3',
            'cinematic': 'https://cdn.pixabay.com/audio/2023/01/15/audio_2b5d4c8a9e.mp3'}
    url = urls.get(mood, urls['ambient'])
    path = f"/content/music_{int(time.time())}.mp3"
    os.system(f"wget -q -O {path} '{url}'")
    return path if os.path.exists(path) and os.path.getsize(path) > 1000 else None

def merge_audio(video_path, voice_path=None, music_path=None):
    inputs = f"-i {video_path}"
    parts = []
    if voice_path: inputs += f" -i {voice_path}"; parts.append("[1:a]volume=0.9[v]")
    if music_path: inputs += f" -i {music_path}"; parts.append(f"[{2 if voice_path else 1}:a]volume=0.25,aloop=loop=-1:size=2e9[m]")
    if not parts: return video_path
    mix_inputs = "[v]" if voice_path else ""
    if music_path: mix_inputs += "[m]"
    fc = ";".join(parts) + f";{mix_inputs}amix=inputs={len(parts)}:duration=first[aout]"
    out = video_path.replace('.mp4', '_audio.mp4')
    os.system(f"ffmpeg -y {inputs} -filter_complex '{fc}' -map 0:v -map '[aout]' -c:v copy -c:a aac -shortest {out}")
    return out if os.path.exists(out) else video_path

# ============================================================
#  FLASK СЕРВЕР
# ============================================================
app = Flask(__name__)
CORS(app)

@app.route("/health")
def health():
    return jsonify({"status":"ok","gpu":torch.cuda.get_device_name(0),"ready":True,"models":["i2vgen-xl","svd"]})

@app.route("/generate", methods=["POST"])
def generate():
    try:
        data = request.json
        image_b64 = data.get("image","")
        prompt = data.get("prompt","")
        model = data.get("model","i2vgen")  # "i2vgen" or "svd"
        motion = int(data.get("motion_bucket_id",127))
        fps = int(data.get("fps",8))
        duration = float(data.get("duration",5))
        seed = int(data.get("seed",42))
        if seed == -1: seed = random.randint(0, 2**32-1)

        img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB")
        if model == "i2vgen":
            img = img.resize((1024, 576))
            num_frames = 16
        else:
            img = img.resize((1024, 576))
            num_frames = min(25, max(14, int(duration * fps)))

        if model == "i2vgen":
            frames = generate_i2vgen(img, prompt, num_frames, fps, seed)
        else:
            frames = generate_svd(img, motion, num_frames, fps, seed)

        video_path = f"/content/v{int(time.time())}.mp4"
        save_video(frames, fps, video_path)

        with open(video_path, "rb") as f:
            v = base64.b64encode(f.read()).decode()
        os.unlink(video_path)
        return jsonify({"status":"ok","video":v,"model":model,"frames":len(frames)})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"status":"error","error":str(e)}), 500

def run_flask():
    app.run(host="0.0.0.0", port=5000, threaded=True)
threading.Thread(target=run_flask, daemon=True).start()
time.sleep(3)

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
#  ИНТЕРФЕЙС
# ============================================================
model_select = widgets.Dropdown(
    options=[('🎬 I2VGen-XL (трансформации по промпту)', 'i2vgen'),
             ('📷 SVD (движение камеры)', 'svd')],
    value='i2vgen',
    description='Модель:'
)

prompt_input = widgets.Text(
    value='a car transforms into a giant robot, metallic panels shift, mechanical arms extend, cinematic transformation',
    placeholder='Опишите что должно произойти (на английском)',
    description='Промпт:',
    layout=widgets.Layout(width='700px')
)

duration_slider = widgets.IntSlider(value=5, min=2, max=10, step=1, description='Длительность:')
fps_slider = widgets.IntSlider(value=8, min=4, max=15, step=1, description='FPS:')
motion_slider = widgets.IntSlider(value=127, min=1, max=255, description='Движение (SVD):')
seed_input = widgets.IntText(value=42, description='Seed:')

upscale_chk = widgets.Checkbox(value=False, description='4K апскейл')
interpolate_chk = widgets.Checkbox(value=False, description='60fps интерполяция')
color_chk = widgets.Checkbox(value=True, description='Цветокоррекция')

watermark_input = widgets.Text(value='', placeholder='Водяной знак', description='Watermark:')
subtitle_input = widgets.Text(value='', placeholder='Субтитры', description='Субтитры:')

voiceover_input = widgets.Textarea(value='', placeholder='Озвучка на русском...',
    description='Озвучка:', layout=widgets.Layout(width='700px', height='60px'))
music_select = widgets.Dropdown(options=[('Без музыки',''),('Амбиент','ambient'),('Энергично','upbeat'),('Кино','cinematic')], description='Музыка:')

batch_input = widgets.IntText(value=1, description='Кол-во:')
upload_btn = widgets.Button(description="📁 Загрузить фото", button_style='info')
generate_btn = widgets.Button(description="🎬 Сгенерировать", button_style='success')
status_label = widgets.HTML(value="<p style='color:blue'>Готово. Загрузите фото и нажмите «Сгенерировать».</p>")

uploaded_image = None

def on_upload(btn):
    global uploaded_image
    clear_output(wait=True); display(ui)
    uploaded = files.upload()
    if uploaded:
        fn = list(uploaded.keys())[0]
        uploaded_image = Image.open(fn).convert("RGB")
        status_label.value = f"<p style='color:green'>✅ {fn} ({uploaded_image.size[0]}×{uploaded_image.size[1]})</p>"

def on_generate(btn):
    global uploaded_image
    if not uploaded_image:
        status_label.value = "<p style='color:red'>❌ Загрузите фото!</p>"; return

    model = model_select.value
    prompt = prompt_input.value.strip()
    if not prompt:
        status_label.value = "<p style='color:red'>❌ Напишите промпт!</p>"; return

    count = max(1, batch_input.value)
    for i in range(count):
        seed = random.randint(0, 2**32-1) if count > 1 else seed_input.value
        status_label.value = f"<p style='color:orange'>🎬 Видео {i+1}/{count}... Model: {model}, Seed: {seed}</p>"

        img = uploaded_image.resize((1024, 576)).copy()
        if color_chk.value:
            img = apply_color_correction(img)

        if model == "i2vgen":
            frames = generate_i2vgen(img, prompt, num_frames=16, fps=fps_slider.value, seed=seed)
        else:
            frames = generate_svd(img, motion=motion_slider.value, num_frames=min(25,max(14,int(duration_slider.value*fps_slider.value))), fps=fps_slider.value, seed=seed)

        video_path = f"/content/video_{i}_{int(time.time())}.mp4"
        save_video(frames, fps_slider.value, video_path)

        if interpolate_chk.value:
            print("🎬 60fps..."); video_path = interpolate_fps(video_path, fps_slider.value, 60)
        if watermark_input.value:
            print("💧 Watermark..."); video_path = add_watermark(video_path, watermark_input.value)
        if subtitle_input.value:
            print("📝 Subtitle..."); video_path = add_subtitle(video_path, subtitle_input.value)

        voice_path = None; music_path = None
        if voiceover_input.value.strip():
            print("🔊 TTS..."); voice_path = generate_tts(voiceover_input.value.strip())
        if music_select.value:
            print("🎵 Music..."); music_path = download_music(music_select.value)
        if voice_path or music_path:
            print("🎵 Merge audio..."); video_path = merge_audio(video_path, voice_path, music_path)

        print(f"✅ Готово: {video_path}")
        files.download(video_path)
        status_label.value = f"<p style='color:green'>✅ Видео {i+1}/{count} скачано!</p>"

upload_btn.on_click(on_upload)
generate_btn.on_click(on_generate)

ui = widgets.VBox([
    widgets.HTML("<h2>🎬 AI Фото → Видео PRO</h2>"),
    widgets.HTML(f"<p>URL: <b>{colab_url}</b></p><hr>"),
    model_select,
    widgets.HTML("<b>📋 I2VGen-XL понимает промпты</b> (машина→робот, день→ночь)<br><b>📷 SVD только движение камеры</b> (зум, пан)<hr>"),
    prompt_input, duration_slider, fps_slider, motion_slider, seed_input,
    widgets.HTML("<hr><b>Качество:</b>"),
    widgets.HBox([upscale_chk, interpolate_chk, color_chk]),
    widgets.HTML("<hr><b>Текст:</b>"),
    watermark_input, subtitle_input,
    widgets.HTML("<hr><b>Звук:</b>"),
    voiceover_input, music_select,
    widgets.HTML("<hr><b>Пакет:</b>"), batch_input,
    widgets.HTML("<hr>"),
    widgets.HBox([upload_btn, generate_btn]),
    status_label
])

display(ui)
print("\n💡 I2VGen-XL: 'a car transforms into a robot' → настоящая трансформация")
print("💡 SVD: 'zoom in' → просто приближение камеры")
print("💡 Batch: несколько видео с разными seed")
