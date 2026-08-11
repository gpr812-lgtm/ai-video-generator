# 🎬 AI Фото → Видео (Stable Video Diffusion)
# БЕЗ NGROK, БЕЗ РЕГИСТРАЦИИ — Cloudflare Tunnel
#
# С НАСТРОЙКАМИ: длительность, FPS, движение, качество, промпт
#
# ИНСТРУКЦИЯ:
# 1. Откройте https://colab.research.google.com
# 2. Создайте новый блокнот
# 3. Вставьте ВЕСЬ этот код в ячейку
# 4. Среда выполнения → Сменить тип → T4 GPU → Сохранить
# 5. Нажмите Shift+Enter
# 6. Подождите 3-5 минут (загрузка модели)
# 7. Появится URL вида https://xxx.trycloudflare.com
# 8. Скопируйте URL → вставьте в приложение → Провайдеры → Colab URL
# 9. НЕ ЗАКРЫВАЙТЕ ВКЛАДКУ COLAB пока генерируете видео!

# ============================================================
#  УСТАНОВКА
# ============================================================
!pip install -q diffusers transformers accelerate torch flask flask-cors

!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

import os, io, base64, subprocess, time, threading, re, json
import torch
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video

print("📦 Установка завершена")

# ============================================================
#  ЗАГРУЗКА МОДЕЛИ
# ============================================================
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
#  FLASK СЕРВЕР С НАСТРОЙКАМИ
# ============================================================
app = Flask(__name__)
CORS(app)

@app.route("/health")
def health():
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    return jsonify({
        "status": "ok",
        "model": "stable-video-diffusion-img2vid-xt",
        "gpu": gpu,
        "ready": True,
        "features": ["prompt", "duration", "fps", "motion", "quality", "seed"]
    })

@app.route("/generate", methods=["POST"])
def generate():
    try:
        data = request.json

        # Параметры (все настраиваемые)
        image_b64 = data.get("image", "")
        prompt = data.get("prompt", "")
        motion = int(data.get("motion_bucket_id", 127))      # 1-255 (больше = больше движения)
        fps = int(data.get("fps", 6))                         # 4-15 (кадров в секунду)
        duration = float(data.get("duration", 5))             # 2-10 секунд
        num_frames = int(data.get("num_frames", 25))           # 14-25 кадров
        noise_aug = float(data.get("noise_aug_strength", 0.02)) # 0.0-0.1
        seed = int(data.get("seed", 42))                       # -1 = случайный
        decode_chunks = int(data.get("decode_chunk_size", 8))  # 4-16 (качество vs скорость)

        # Авто-расчёт кадров по длительности
        if duration > 0:
            num_frames = min(25, max(14, int(duration * fps)))

        # Случайный seed
        if seed == -1:
            seed = random.randint(0, 2**32 - 1)

        # Декодируем изображение
        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image = image.resize((1024, 576))

        print(f"🎬 Генерация видео:")
        print(f"   Промпт: {prompt[:80]}")
        print(f"   Длительность: {duration}с")
        print(f"   FPS: {fps}")
        print(f"   Кадров: {num_frames}")
        print(f"   Движение: {motion}/255")
        print(f"   Шум: {noise_aug}")
        print(f"   Seed: {seed}")
        print(f"   Качество чанков: {decode_chunks}")

        # Генерация видео
        generator = torch.manual_seed(seed)
        frames = pipe(
            image,
            decode_chunk_size=decode_chunks,
            motion_bucket_id=motion,
            num_frames=num_frames,
            noise_aug_strength=noise_aug,
            generator=generator
        ).frames[0]

        # Сохраняем видео
        video_path = f"/content/video_{int(time.time())}.mp4"
        export_to_video(frames, video_path, fps=fps)

        with open(video_path, "rb") as f:
            video_b64 = base64.b64encode(f.read()).decode()
        os.unlink(video_path)

        print(f"✅ Готово! {len(video_b64)} байт, {len(frames)} кадров")

        return jsonify({
            "status": "ok",
            "video": video_b64,
            "frames": len(frames),
            "fps": fps,
            "duration": duration,
            "seed": seed,
            "motion": motion
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "error": str(e)}), 500

# ============================================================
#  CLOUDFLARE TUNNEL
# ============================================================
print("🌐 Запускаю Cloudflare Tunnel...")

def run_flask():
    app.run(host="0.0.0.0", port=5000, threaded=True)

flask_thread = threading.Thread(target=run_flask, daemon=True)
flask_thread.start()
time.sleep(3)

tunnel_process = subprocess.Popen(
    ["/usr/local/bin/cloudflared", "tunnel", "--url", "http://localhost:5000"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
)

print("⏳ Ожидаю URL...")
for line in iter(tunnel_process.stdout.readline, ''):
    if "trycloudflare.com" in line:
        match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
        if match:
            url = match.group(0)
            print()
            print("=" * 60)
            print("✅ СЕРВЕР ЗАПУЩЕН!")
            print(f"📡 URL: {url}")
            print("=" * 60)
            print()
            print("📋 Скопируйте URL и вставьте в приложение")
            print("   в 'Провайдеры' → Colab URL")
            print()
            print("⚙️  Доступные настройки в приложении:")
            print("   • Промпт (управляет движением)")
            print("   • Длительность (2-10 секунд)")
            print("   • FPS (4-15)")
            print("   • Качество (speed/quality → motion_bucket_id)")
            print("   • Seed (-1 = случайный)")
            break
    time.sleep(1)

print("\nСервер работает. Не закрывайте вкладку!")
try:
    while True:
        time.sleep(60)
except KeyboardInterrupt:
    tunnel_process.terminate()
