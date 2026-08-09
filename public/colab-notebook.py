# === STABLE VIDEO DIFFUSION С НАСТРОЙКАМИ ===
# Настройте параметры ниже, затем запустите ячейку (Shift+Enter)

# ============================================================
#  ⚙️  НАСТРОЙКИ ВИДЕО (измените значения ниже)
# ============================================================

# Длительность видео в секундах (2-10)
duration_seconds = 5  #@param {type:"slider", min:2, max:10, step:1}

# Количество кадров в секунду (4-15)
# Больше = плавнее, но дольше генерация
fps = 6  #@param {type:"slider", min:4, max:15, step:1}

# Интенсивность движения (1-255)
# Больше = больше движения в видео
motion_bucket_id = 127  #@param {type:"slider", min:1, max:255, step:1}

# Качество (больше шагов = лучше качество, но дольше)
num_inference_steps = 25  #@param {type:"slider", min:10, max:50, step:5}

# Случайное зерно (для разных результатов)
# -1 = случайное зерно каждый раз
seed = 42  #@param {type:"integer"}

# Шум (добавляет вариативность, 0.0-0.1)
noise_aug_strength = 0.02  #@param {type:"slider", min:0, max:0.1, step:0.01}

# ============================================================
#  📦 УСТАНОВКА И ЗАПУСК (не меняйте код ниже)
# ============================================================

!pip install -q diffusers transformers accelerate torch torchvision
!pip install -q pillow

import os
import io
import random
import torch
from PIL import Image
from google.colab import files

print("📦 Установка завершена")

# === ЗАГРУЗКА МОДЕЛИ ===
print("🧠 Загрузка Stable Video Diffusion (~3 минуты)...")

from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video

model_id = "stabilityai/stable-video-diffusion-img2vid-xt"
pipe = StableVideoDiffusionPipeline.from_pretrained(
    model_id,
    torch_dtype=torch.float16,
    variant="fp16",
)
pipe.to("cuda")
pipe.enable_model_cpu_offload()

print("✅ Модель загружена!")

# === РАСЧЁТ КОЛИЧЕСТВА КАДРОВ ===
num_frames = duration_seconds * fps
# SVD поддерживает максимум 25 кадров
if num_frames > 25:
    num_frames = 25
    print(f"⚠️ Ограничение SVD: используется {num_frames} кадров (макс. 25)")
else:
    print(f"📊 Параметры: {duration_seconds}с, {fps} fps, {num_frames} кадров, motion={motion_bucket_id}")

# === ВЫВОД ПАРАМЕТРОВ ===
print("\n" + "="*50)
print("📋 ПАРАМЕТРЫ ГЕНЕРАЦИИ:")
print(f"   Длительность: {duration_seconds} сек")
print(f"   FPS: {fps}")
print(f"   Кадров: {num_frames}")
print(f"   Движение: {motion_bucket_id}/255")
print(f"   Качество: {num_inference_steps} шагов")
print(f"   Зерно: {seed}")
print(f"   Шум: {noise_aug_strength}")
print("="*50)
print("\n📁 Загрузите изображение (нажмите Choose Files):")

# === ЗАГРУЗКА ИЗОБРАЖЕНИЯ ===
uploaded = files.upload()
image_name = list(uploaded.keys())[0]
image = Image.open(image_name).convert("RGB")
image = image.resize((1024, 576))  # SVD expects 1024x576

print(f"\n✅ Изображение загружено: {image_name}")
print(f"🎬 Генерация видео (~{num_frames * 2} секунд)...")

# === ГЕНЕРАЦИЯ ВИДЕО ===
if seed == -1:
    seed = random.randint(0, 2**32 - 1)
    print(f"🎲 Случайное зерно: {seed}")

generator = torch.manual_seed(seed)
frames = pipe(
    image,
    decode_chunk_size=8,
    motion_bucket_id=motion_bucket_id,
    num_frames=num_frames,
    num_inference_steps=num_inference_steps,
    noise_aug_strength=noise_aug_strength,
    generator=generator,
).frames[0]

# === СОХРАНЕНИЕ ВИДЕО ===
output_path = f"/content/svd_video_{duration_seconds}s_{fps}fps.mp4"
export_to_video(frames, output_path, fps=fps)

# Получить размер файла
file_size = os.path.getsize(output_path) / (1024 * 1024)  # MB

print("\n" + "="*50)
print("✅ ВИДЕО ГОТОВО!")
print(f"📁 Файл: {output_path}")
print(f"💾 Размер: {file_size:.1f} MB")
print(f"📊 {num_frames} кадров, {fps} fps, {duration_seconds} сек")
print("="*50)
print("\n⬇️ Скачивание видео...")

# Скачивание
files.download(output_path)

print("\n🎉 Готово! Видео скачано на ваш компьютер.")
print("\n" + "="*50)
print("💡 Чтобы изменить параметры:")
print("   1. Измените значения в блоке настроек сверху")
print("   2. Перезапустите ячейку (Shift+Enter)")
print("   3. Загрузите новое изображение")
print("="*50)
