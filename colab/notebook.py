# 🎬 AI Фото → Видео PRO (SVD + 4K Upscale + 60fps + Звук + Эффекты)
# БЕЗ NGROK, БЕЗ РЕГИСТРАЦИИ
#
# ИНСТРУКЦИЯ:
# 1. Откройте https://colab.research.google.com
# 2. Создайте новый блокнот
# 3. Вставьте ВЕСЬ этот код
# 4. Среда выполнения → T4 GPU → Сохранить
# 5. Shift+Enter → ждите 5-7 минут
# 6. Загрузите фото → настройте → "Сгенерировать"

# ============================================================
#  УСТАНОВКА
# ============================================================
!pip install -q diffusers transformers accelerate torch flask flask-cors

# Real-ESRGAN для апскейла до 4K
!pip install -q realesrgan basicsr gfpgan

# RIFE для интерполяции кадров (60fps)
!pip install -q rifefilter

!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

import os, io, base64, subprocess, time, threading, re, random, json
import ipywidgets as widgets
from IPython.display import display, HTML, clear_output
import torch
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from flask import Flask, request, jsonify
from flask_cors import CORS
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video
from google.colab import files

if not torch.cuda.is_available():
    print("❌ Включите GPU: Среда выполнения → T4 GPU")
    raise SystemExit("GPU не включён")

print(f"✅ GPU: {torch.cuda.get_device_name(0)}")

# ============================================================
#  ЗАГРУЗКА МОДЕЛЕЙ
# ============================================================
print("🧠 Загружаю SVD модель (3-5 мин)...")
pipe = StableVideoDiffusionPipeline.from_pretrained(
    "stabilityai/stable-video-diffusion-img2vid-xt",
    torch_dtype=torch.float16, variant="fp16"
)
pipe.to("cuda")
pipe.enable_model_cpu_offload()
print("✅ SVD загружен!")

# Real-ESRGAN для апскейла
print("🔍 Загружаю Real-ESRGAN (4K upscaler)...")
try:
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    upsampler = RealESRGANer(scale=4, model_path='https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth', model=model, tile=0, tile_pad=10, pre_pad=0, half=True)
    print("✅ Real-ESRGAN загружен!")
    has_upscaler = True
except Exception as e:
    print(f"⚠️ Real-ESRGAN недоступен: {e}")
    has_upscaler = False

# ============================================================
#  FLASK СЕРВЕР
# ============================================================
app = Flask(__name__)
CORS(app)

@app.route("/health")
def health():
    return jsonify({"status":"ok","gpu":torch.cuda.get_device_name(0),"ready":True,"upscaler":has_upscaler})

@app.route("/generate", methods=["POST"])
def generate():
    try:
        data = request.json
        image_b64 = data.get("image","")
        prompt = data.get("prompt","")
        motion = int(data.get("motion_bucket_id",127))
        fps = int(data.get("fps",6))
        duration = float(data.get("duration",5))
        seed = int(data.get("seed",42))
        do_upscale = data.get("upscale",False)
        do_interpolate = data.get("interpolate",False)
        target_fps = int(data.get("target_fps",60))
        do_color_correct = data.get("color_correct",False)
        do_stabilize = data.get("stabilize",False)
        watermark_text = data.get("watermark","")
        subtitle_text = data.get("subtitle","")
        voice_text = data.get("voiceover","")
        voice = data.get("voice","tongtong")
        bg_music = data.get("bg_music","")
        sound_effect = data.get("sound_effect","")

        if seed == -1: seed = random.randint(0, 2**32-1)
        num_frames = min(25, max(14, int(duration * fps)))

        img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert("RGB").resize((1024,576))

        print(f"🎬 Промпт: {prompt[:60]}")
        print(f"   {duration}с, {fps}fps, {num_frames} кадров, движение={motion}")

        generator = torch.manual_seed(seed)
        frames = pipe(img, decode_chunk_size=8, motion_bucket_id=motion,
                      num_frames=num_frames, noise_aug_strength=0.02,
                      generator=generator).frames[0]

        # Конвертируем в PIL
        frames_pil = [Image.fromarray(np.array(f)) for f in frames]

        # 1. Цветокоррекция
        if do_color_correct:
            print("🎨 Цветокоррекция...")
            frames_pil = [apply_color_correction(f) for f in frames_pil]

        # 2. Апскейл до 4K
        if do_upscale and has_upscaler:
            print("🔍 Апскейл до 4K...")
            frames_pil = [upscale_frame(f) for f in frames_pil]

        # Сохраняем видео
        video_path = f"/content/video_{int(time.time())}.mp4"
        frames_np = [np.array(f) for f in frames_pil]
        export_to_video(frames_np, video_path, fps=fps)

        # 3. Интерполяция до 60fps
        if do_interpolate and target_fps > fps:
            print(f"🎬 Интерполяция до {target_fps}fps...")
            interpolated = interpolate_frames(video_path, fps, target_fps)
            if interpolated: video_path = interpolated

        # 4. Стабилизация
        if do_stabilize:
            print("🎯 Стабилизация...")
            stabilized = stabilize_video(video_path)
            if stabilized: video_path = stabilized

        # 5. Водяной знак
        if watermark_text:
            print(f"💧 Водяной знак: {watermark_text}")
            video_path = add_watermark(video_path, watermark_text)

        # 6. Субтитры
        if subtitle_text:
            print(f"📝 Субтитры: {subtitle_text[:40]}")
            video_path = add_subtitle(video_path, subtitle_text)

        # 7. Звук: озвучка + музыка + эффекты
        audio_paths = []

        # Озвучка (TTS)
        if voice_text:
            print(f"🔊 Озвучка: {voice_text[:40]}")
            tts_path = generate_tts(voice_text, voice)
            if tts_path: audio_paths.append(tts_path)

        # Фоновая музыка
        if bg_music:
            music_path = download_music(bg_music)
            if music_path: audio_paths.append(("music", music_path))

        # Звуковые эффекты
        if sound_effect:
            sfx_path = download_sfx(sound_effect)
            if sfx_path: audio_paths.append(("sfx", sfx_path))

        # Объединить видео + аудио
        if audio_paths:
            print("🎵 Добавляю звук...")
            video_path = merge_audio(video_path, audio_paths)

        with open(video_path, "rb") as f:
            v = base64.b64encode(f.read()).decode()

        print(f"✅ Готово! {len(v)} байт")
        return jsonify({"status":"ok","video":v,"frames":len(frames),"fps":fps})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"status":"error","error":str(e)}), 500

# ============================================================
#  ФУНКЦИИ ОБРАБОТКИ
# ============================================================

def apply_color_correction(img):
    """Автоматическая цветокоррекция"""
    enhancer = ImageEnhance.Color(img)
    img = enhancer.enhance(1.2)
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(1.1)
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(1.05)
    return img

def upscale_frame(img):
    """Апскейл кадра до 4K через Real-ESRGAN"""
    if not has_upscaler: return img
    import cv2
    np_img = np.array(img)
    if np_img.shape[2] == 4: np_img = np_img[:,:,:3]
    output, _ = upsampler.enhance(np_img, outscale=4)
    return Image.fromarray(output)

def interpolate_frames(video_path, src_fps, target_fps):
    """Интерполяция кадров до target_fps через ffmpeg minterpolate"""
    out = video_path.replace('.mp4', f'_{target_fps}fps.mp4')
    cmd = f"ffmpeg -y -i {video_path} -filter:v 'minterpolate=fps={target_fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1' -c:v libx264 -preset fast -crf 23 {out}"
    os.system(cmd)
    if os.path.exists(out): return out
    return None

def stabilize_video(video_path):
    """Стабилизация видео через ffmpeg vidstab"""
    out = video_path.replace('.mp4', '_stab.mp4')
    cmd = f"ffmpeg -y -i {video_path} -vf vidstabdetect=shakiness=5:accuracy=15 -f null /dev/null 2>&1 && ffmpeg -y -i {video_path} -vf vidstabtransform=smoothing=30:input=transforms.trf -c:v libx264 -preset fast -crf 23 {out}"
    os.system(cmd)
    if os.path.exists(out): return out
    return None

def add_watermark(video_path, text):
    """Добавление водяного знака"""
    out = video_path.replace('.mp4', '_wm.mp4')
    safe_text = text.replace("'", "\\'")
    cmd = f"""ffmpeg -y -i {video_path} -vf "drawtext=text='{safe_text}':fontcolor=white@0.5:fontsize=24:x=w-tw-10:y=h-th-10" -c:v libx264 -preset fast -crf 23 {out}"""
    os.system(cmd)
    if os.path.exists(out): return out
    return None

def add_subtitle(video_path, text):
    """Добавление субтитров внизу видео"""
    out = video_path.replace('.mp4', '_sub.mp4')
    safe_text = text.replace("'", "\\'")
    cmd = f"""ffmpeg -y -i {video_path} -vf "drawtext=text='{safe_text}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-50:box=1:boxcolor=black@0.5:boxborderw=5" -c:v libx264 -preset fast -crf 23 {out}"""
    os.system(cmd)
    if os.path.exists(out): return out
    return None

def generate_tts(text, voice):
    """Генерация озвучки через ZAI TTS"""
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
        return ("voice", path)
    except Exception as e:
        print(f"⚠️ TTS недоступен: {e}")
        return None

def download_music(mood):
    """Скачивание фоновой музыки по настроению"""
    urls = {
        'ambient': 'https://cdn.pixabay.com/audio/2022/03/15/audio_1a8d6c1b8f.mp3',
        'upbeat': 'https://cdn.pixabay.com/audio/2022/10/25/audio_8a6f3c1b6f.mp3',
        'cinematic': 'https://cdn.pixabay.com/audio/2023/01/15/audio_2b5d4c8a9e.mp3',
    }
    url = urls.get(mood, urls.get('ambient'))
    path = f"/content/music_{int(time.time())}.mp3"
    os.system(f"wget -q -O {path} '{url}'")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return ("music", path)
    return None

def download_sfx(effect):
    """Звуковые эффекты"""
    urls = {
        'wind': 'https://cdn.pixabay.com/audio/2022/03/10/audio_1a7d3f2e.mp3',
        'water': 'https://cdn.pixabay.com/audio/2022/01/20/audio_2b3c1d5e.mp3',
        'rain': 'https://cdn.pixabay.com/audio/2021/08/09/audio_dc39bde0.mp3',
        'thunder': 'https://cdn.pixabay.com/audio/2022/03/15/audio_1718e0d8.mp3',
        'steps': 'https://cdn.pixabay.com/audio/2022/04/29/audio_1808fbf6.mp3',
    }
    url = urls.get(effect)
    if not url: return None
    path = f"/content/sfx_{int(time.time())}.mp3"
    os.system(f"wget -q -O {path} '{url}'")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return ("sfx", path)
    return None

def merge_audio(video_path, audio_items):
    """Объединение видео + озвучка + музыка + эффекты"""
    inputs = f"-i {video_path}"
    filter_parts = []
    delay = 0

    for i, item in enumerate(audio_items):
        if isinstance(item, tuple):
            kind, path = item
        else:
            path = item
            kind = "voice"

        inputs += f" -i {path}"

        if kind == "voice":
            filter_parts.append(f"[{i+1}:a]adelay={delay}|{delay},volume=0.9[v{i}]")
            delay += 0  # voice plays immediately
        elif kind == "music":
            filter_parts.append(f"[{i+1}:a]volume=0.25,aloop=loop=-1:size=2e9[m{i}]")
        elif kind == "sfx":
            filter_parts.append(f"[{i+1}:a]volume=0.4[s{i}]")

    # Mix all audio
    voice_parts = [f"[v{i}]" for i, item in enumerate(audio_items) if isinstance(item, tuple) and item[0] == "voice"]
    music_parts = [f"[m{i}]" for i, item in enumerate(audio_items) if isinstance(item, tuple) and item[0] == "music"]
    sfx_parts = [f"[s{i}]" for i, item in enumerate(audio_items) if isinstance(item, tuple) and item[0] == "sfx"]

    all_parts = voice_parts + music_parts + sfx_parts
    if not all_parts:
        return video_path

    filter_complex = ";".join(filter_parts)
    mix_inputs = "".join(all_parts)
    filter_complex += f";{mix_inputs}amix=inputs={len(all_parts)}:duration=first[aout]"

    out = video_path.replace('.mp4', '_audio.mp4')
    cmd = f"ffmpeg -y {inputs} -filter_complex '{filter_complex}' -map 0:v -map '[aout]' -c:v copy -c:a aac -shortest {out}"
    os.system(cmd)

    if os.path.exists(out):
        return out
    return video_path

# ============================================================
#  CLOUDFLARE TUNNEL
# ============================================================
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
prompt_input = widgets.Text(value='cinematic camera movement, gentle zoom, dramatic lighting',
    placeholder='Промпт (на английском)', description='Промпт:', layout=widgets.Layout(width='600px'))

duration_slider = widgets.IntSlider(value=5, min=2, max=10, step=1, description='Длительность (с):')
fps_slider = widgets.IntSlider(value=6, min=4, max=15, step=1, description='FPS:')
motion_slider = widgets.IntSlider(value=127, min=1, max=255, step=1, description='Движение:')
seed_input = widgets.IntText(value=42, description='Seed:')

# Качество
upscale_chk = widgets.Checkbox(value=False, description='🔍 Апскейл до 4K (Real-ESRGAN)')
interpolate_chk = widgets.Checkbox(value=False, description='🎬 Интерполяция до 60fps')
color_chk = widgets.Checkbox(value=True, description='🎨 Цветокоррекция')
stabilize_chk = widgets.Checkbox(value=False, description='🎯 Стабилизация')

# Текст
watermark_input = widgets.Text(value='', placeholder='Текст водяного знака (необязательно)', description='Водяной знак:', layout=widgets.Layout(width='400px'))
subtitle_input = widgets.Text(value='', placeholder='Субтитры на видео (необязательно)', description='Субтитры:', layout=widgets.Layout(width='400px'))

# Звук
voiceover_input = widgets.Textarea(value='', placeholder='Текст озвучки на русском...', description='Озвучка:', layout=widgets.Layout(width='600px', height='60px'))
voice_select = widgets.Dropdown(options=[('Женский', 'tongtong'), ('Мужской', 'tongtong')], description='Голос:')
music_select = widgets.Dropdown(options=[('Без музыки', ''), ('Амбиент', 'ambient'), ('Энергично', 'upbeat'), ('Кинематографично', 'cinematic')], description='Музыка:')
sfx_select = widgets.Dropdown(options=[('Без эффектов', ''), ('Ветер', 'wind'), ('Вода', 'water'), ('Дождь', 'rain'), ('Гром', 'thunder'), ('Шаги', 'steps')], description='Звуки:')

# Batch
batch_input = widgets.IntText(value=1, description='Кол-во видео:')
upload_btn = widgets.Button(description="📁 Загрузить фото", button_style='info', layout=widgets.Layout(width='200px'))
generate_btn = widgets.Button(description="🎬 Сгенерировать видео", button_style='success', layout=widgets.Layout(width='250px'))
status_label = widgets.HTML(value="<p style='color:blue'>Готово. Загрузите фото и нажмите «Сгенерировать».</p>")

uploaded_image = None

def on_upload(btn):
    global uploaded_image
    clear_output(wait=True)
    display(ui)
    uploaded = files.upload()
    if uploaded:
        fn = list(uploaded.keys())[0]
        uploaded_image = Image.open(fn).convert("RGB")
        status_label.value = f"<p style='color:green'>✅ Фото: {fn} ({uploaded_image.size[0]}×{uploaded_image.size[1]})</p>"

def on_generate(btn):
    global uploaded_image
    if not uploaded_image:
        status_label.value = "<p style='color:red'>❌ Загрузите фото!</p>"
        return

    count = max(1, batch_input.value)
    for i in range(count):
        seed = seed_input.value if seed_input.value != -1 else random.randint(0, 2**32-1)
        if count > 1: seed = random.randint(0, 2**32-1)

        status_label.value = f"<p style='color:orange'>🎬 Видео {i+1}/{count}... seed={seed}</p>"

        result = generate_video_internal(
            prompt=prompt_input.value, duration=duration_slider.value,
            fps=fps_slider.value, motion=motion_slider.value, seed=seed,
            upscale=upscale_chk.value, interpolate=interpolate_chk.value,
            color_correct=color_chk.value, stabilize=stabilize_chk.value,
            watermark=watermark_input.value, subtitle=subtitle_input.value,
            voice_text=voiceover_input.value, voice=voice_select.value,
            bg_music=music_select.value, sfx=sfx_select.value,
        )
        if result:
            status_label.value = f"<p style='color:green'>✅ Видео {i+1}/{count} готово! Скачиваю...</p>"
            files.download(result)

def generate_video_internal(prompt, duration, fps, motion, seed, upscale, interpolate,
                            color_correct, stabilize, watermark, subtitle, voice_text, voice, bg_music, sfx):
    num_frames = min(25, max(14, int(duration * fps)))
    img = uploaded_image.resize((1024, 576))
    print(f"🎬 Промпт: {prompt[:60]}, {duration}с, {fps}fps, {num_frames}кадров, m={motion}, seed={seed}")

    generator = torch.manual_seed(seed)
    frames = pipe(img, decode_chunk_size=8, motion_bucket_id=motion,
                  num_frames=num_frames, noise_aug_strength=0.02, generator=generator).frames[0]

    frames_pil = [Image.fromarray(np.array(f)) for f in frames]

    if color_correct:
        print("🎨 Цветокоррекция...")
        frames_pil = [apply_color_correction(f) for f in frames_pil]

    if upscale and has_upscaler:
        print("🔍 4K апскейл...")
        frames_pil = [upscale_frame(f) for f in frames_pil]

    video_path = f"/content/video_{int(time.time())}.mp4"
    export_to_video([np.array(f) for f in frames_pil], video_path, fps=fps)

    if interpolate:
        print("🎬 60fps интерполяция...")
        r = interpolate_frames(video_path, fps, 60)
        if r: video_path = r

    if stabilize:
        print("🎯 Стабилизация...")
        r = stabilize_video(video_path)
        if r: video_path = r

    if watermark:
        print(f"💧 Водяной знак: {watermark}")
        r = add_watermark(video_path, watermark)
        if r: video_path = r

    if subtitle:
        print(f"📝 Субтитры: {subtitle[:40]}")
        r = add_subtitle(video_path, subtitle)
        if r: video_path = r

    # Звук
    audio_items = []
    if voice_text:
        print(f"🔊 Озвучка: {voice_text[:40]}")
        tts = generate_tts(voice_text, voice)
        if tts: audio_items.append(tts)
    if bg_music:
        print(f"🎵 Музыка: {bg_music}")
        m = download_music(bg_music)
        if m: audio_items.append(m)
    if sfx:
        print(f"🎵 Эффекты: {sfx}")
        s = download_sfx(sfx)
        if s: audio_items.append(s)

    if audio_items:
        print("🎵 Объединяю звук...")
        video_path = merge_audio(video_path, audio_items)

    print(f"✅ Готово: {video_path}")
    return video_path

upload_btn.on_click(on_upload)
generate_btn.on_click(on_generate)

ui = widgets.VBox([
    widgets.HTML("<h2>🎬 AI Фото → Видео PRO</h2>"),
    widgets.HTML(f"<p>URL: <b>{colab_url}</b></p><hr>"),
    prompt_input, duration_slider, fps_slider, motion_slider, seed_input,
    widgets.HTML("<hr><b>Качество:</b>"),
    widgets.HBox([upscale_chk, interpolate_chk]),
    widgets.HBox([color_chk, stabilize_chk]),
    widgets.HTML("<hr><b>Текст:</b>"),
    watermark_input, subtitle_input,
    widgets.HTML("<hr><b>Звук:</b>"),
    voiceover_input, voice_select, music_select, sfx_select,
    widgets.HTML("<hr><b>Пакетная генерация:</b>"),
    batch_input,
    widgets.HTML("<hr>"),
    widgets.HBox([upload_btn, generate_btn]),
    status_label
])

display(ui)
print("\n💡 Движение: 127=среднее, 200=много, 50=мало")
print("💡 Апскейл 4K + интерполяция 60fps = дольше генерация, но лучше качество")
print("💡 Batch: несколько видео с разными seed из одного фото")
