"""
@FotoRestavraciyaBot — Реставрация старых фотографий
v2.0 — полная версия с AI-анализом, новыми услугами и системой отзывов
"""

import os
import io
import json
import logging
import base64
from datetime import datetime
from PIL import Image
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, InputMediaPhoto
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)
from openai import OpenAI

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
#  НАСТРОЙКИ
# ─────────────────────────────────────────────────────────
BOT_TOKEN      = os.getenv("BOT_TOKEN")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ADMIN_ID       = int(os.getenv("ADMIN_ID", "196603219"))
SBP_LINK       = os.getenv("SBP_LINK", "")
CARD_NUMBER    = os.getenv("CARD_NUMBER", "")
BOT_USERNAME   = "FotoRestavraciyaBot"

# ─────────────────────────────────────────────────────────
#  УСЛУГИ
# ─────────────────────────────────────────────────────────
SERVICES = {
    "restore": {
        "name": "🤖 Авто-реставрация",
        "desc": "Царапины, трещины, разрывы, пятна — убираем всё",
        "price": 99,
        "auto": True,
        "time": "2–5 мин",
    },
    "colorize": {
        "name": "🎨 Раскраска ч/б фото",
        "desc": "Превращаем чёрно-белое в живое цветное",
        "price": 99,
        "auto": True,
        "time": "2–5 мин",
    },
    "restore_colorize": {
        "name": "✨ Реставрация + раскраска",
        "desc": "Полное восстановление + натуральные цвета",
        "price": 149,
        "auto": True,
        "time": "3–7 мин",
    },
    "enhance_face": {
        "name": "🔍 Улучшение лиц",
        "desc": "Размытые, нечёткие лица → чёткие и живые",
        "price": 99,
        "auto": True,
        "time": "2–5 мин",
    },
    "upscale_print": {
        "name": "🖨 Подготовка к печати",
        "desc": "Увеличиваем качество для печати 20×30 и больше",
        "price": 99,
        "auto": True,
        "time": "2–5 мин",
    },
    "animate": {
        "name": "🎬 Оживление фото",
        "desc": "Фото → короткое видео: лицо моргает, чуть улыбается",
        "price": 299,
        "auto": False,
        "time": "до 3 часов",
    },
    "manual": {
        "name": "👑 Сложный случай",
        "desc": "Сильно повреждённые — Алёна обрабатывает лично",
        "price": 299,
        "auto": False,
        "time": "до 24 часов",
    },
}

# ─────────────────────────────────────────────────────────
#  ПРОМТЫ ДЛЯ OPENAI
# ─────────────────────────────────────────────────────────
PROMPTS = {
    "restore": """You are a CONSERVATIVE photo restoration specialist.
Your ONLY job is to remove physical damage from this photograph.

CRITICAL RULES — DO NOT VIOLATE:
→ DO NOT change the background — preserve EVERY element exactly as it is
→ DO NOT remove or replace objects, furniture, decorations, candles, icons, walls
→ DO NOT change the composition, framing, or any part of the scene
→ DO NOT make people look younger, smoother, or more attractive
→ DO NOT add new lighting, shadows, or atmospheric effects
→ DO NOT "improve" anything that isn't visibly damaged
→ The output must look like the SAME photograph, just cleaned

ONLY FIX THESE SPECIFIC PROBLEMS if visibly present:
→ Scratches, cracks, tears — fill in using surrounding pixels only
→ Dust spots, stains — remove only the spot itself
→ Faded/yellowed overall tone — subtle colour balance correction only
→ Noise/grain in very dark areas only

PRESERVE COMPLETELY:
→ Every person — exact face, age, skin, clothing, posture
→ Every background element — walls, objects, lighting, atmosphere
→ Original photographic style and era
→ All edges and borders

Result: the SAME photo, with ONLY the damage removed. Nothing else changed.""",

    "colorize": """You are a professional photo colorization specialist.
Add natural, realistic colors to this black-and-white photograph.

ABSOLUTE PRIORITY — PRESERVE IDENTITY:
→ Every person MUST remain identical — do NOT beautify
→ Age, face, features — unchanged

COLORIZE:
→ Skin tones: warm, natural, realistic — not orange, not pale
→ Eyes: natural color (soft brown or grey if unknown)
→ Clothing: era-appropriate, natural fabric tones
→ Background: realistic environmental colors
→ Preserve original photographic style of the era

QUALITY: Sharp focus, natural skin texture, no over-smoothing, photorealistic.""",

    "restore_colorize": """You are a professional photo restoration AND colorization specialist.

STEP 1 — RESTORE: Remove all damage (scratches, cracks, stains, tears).
STEP 2 — COLORIZE: Add natural, era-appropriate colors.

ABSOLUTE PRIORITY — PRESERVE IDENTITY:
→ Face, age, features — preserve exactly, do NOT beautify
→ Clothing style — preserve faithfully

QUALITY: Sharp focus, natural skin texture, no plastic skin, photorealistic.""",

    "enhance_face": """You are a professional photo face enhancement specialist.

TASK: Enhance and clarify all faces in this photograph.

FACE ENHANCEMENT:
→ Restore blurry, unclear, damaged faces to sharp and clear
→ Reconstruct missing facial features using surrounding context
→ PRESERVE THE EXACT IDENTITY — same person, same age, same expression
→ Enhance skin texture naturally — real pores, no plastic skin
→ Sharpen eyes, lips, nose details
→ Keep original expression and emotion intact

DO NOT change appearance, age, or attractiveness.
QUALITY: Studio-quality face detail, natural skin, sharp focus on faces.""",

    "upscale_print": """You are a professional photo enhancement specialist for print preparation.

TASK: Enhance this photograph for high-quality large format printing.

ENHANCEMENT:
→ Maximize apparent sharpness and clarity throughout
→ Restore fine details: textures, fabrics, backgrounds, faces
→ Remove noise, grain, compression artifacts
→ Enhance tonal range for print reproduction
→ Preserve ALL original colors, composition, and proportions exactly
→ Optimize for 20×30 cm and larger print format

QUALITY: Maximum sharpness, clean edges, rich tonal range, print-ready.""",
}

# ─────────────────────────────────────────────────────────
#  FAQ
# ─────────────────────────────────────────────────────────
FAQ_ITEMS = [
    ("⏱ Сколько ждать?",
     "🤖 Авто-обработка — 2–5 минут\n🎬 Оживление фото — до 3 часов\n👑 Ручная работа Алёны — до 24 часов"),
    ("😕 Результат не понравился?",
     "Напишите — переделаем! При очевидном браке с нашей стороны — бесплатно."),
    ("📱 Какой формат прислать?",
     "JPG или PNG. Чем выше качество — тем лучше результат. Подойдёт даже фото с телефона."),
    ("🖼 Несколько фото сразу?",
     "Пока каждое фото — отдельный заказ. Скидки на второй и третий заказ — договоримся!"),
    ("💳 Как оплатить?",
     "СБП или перевод на карту. Пришлите скриншот оплаты — подтвердим в течение нескольких минут."),
    ("🎬 Как работает оживление?",
     "Алёна обрабатывает фото через нейросеть Kling AI — лицо начинает моргать, чуть поворачиваться, улыбаться. Получается 3–5 секунд живого видео. Идеально для соцсетей и памятных роликов."),
    ("🎁 Есть ли скидки?",
     "Да! Сейчас действуют стартовые цены от 99₽.\nПромокод для подписчиков @kontentdesignn — ДИЗАЙН50 (−50%).\nВведите /promo"),
]

# ─────────────────────────────────────────────────────────
#  ДАННЫЕ ПОЛЬЗОВАТЕЛЕЙ (в памяти)
# ─────────────────────────────────────────────────────────
user_data       = {}          # {user_id: {photo_id, joined}}
pending_payments = {}         # {user_id: {service, photo_id, amount, ...}}
used_promos     = set()       # {user_id} — кто уже применял промокод
user_promo      = {}          # {user_id: discount_pct} — активный промокод
awaiting_promo  = set()       # {user_id} — ждём ввода промокода
test_mode_users = set()       # {user_id} — тест без оплаты
stats           = {"orders": 0, "revenue": 0, "users": set()}

PROMO_CODES = {
    "ДИЗАЙН50": 50,
    "СТАРТ30":  30,
}

# ─────────────────────────────────────────────────────────
#  OPENAI — АНАЛИЗ ФОТО
# ─────────────────────────────────────────────────────────
async def analyze_photo(photo_bytes: bytes) -> dict | None:
    """GPT-4o смотрит на фото и рекомендует лучшую услугу"""
    if not OPENAI_API_KEY:
        return None
    try:
        client = OpenAI(api_key=OPENAI_API_KEY)
        b64 = base64.b64encode(photo_bytes).decode()
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
                    },
                    {
                        "type": "text",
                        "text": (
                            "Ты ассистент мастера по реставрации фотографий. "
                            "Проанализируй это фото и ответь строго в формате JSON без лишнего текста:\n"
                            '{"is_bw": bool, "has_damage": bool, '
                            '"damage_level": "none|light|medium|heavy", '
                            '"face_quality": "good|blurry|missing", '
                            '"recommend": "restore|colorize|restore_colorize|enhance_face|upscale_print|manual", '
                            '"comment": "одно предложение на русском — что именно видишь"}'
                        )
                    }
                ]
            }],
            max_tokens=200,
            temperature=0,
        )
        text = resp.choices[0].message.content.strip()
        start, end = text.find('{'), text.rfind('}') + 1
        return json.loads(text[start:end])
    except Exception as e:
        logger.warning(f"Photo analysis skipped: {e}")
        return None


# ─────────────────────────────────────────────────────────
#  OPENAI — ОБРАБОТКА ФОТО
# ─────────────────────────────────────────────────────────
def _choose_size(photo_bytes: bytes) -> str:
    """Выбираем размер вывода под пропорции оригинала."""
    try:
        img = Image.open(io.BytesIO(photo_bytes))
        w, h = img.size
        ratio = w / h
        if ratio > 1.2:
            return "1536x1024"   # горизонталь
        elif ratio < 0.83:
            return "1024x1536"   # вертикаль
        else:
            return "1024x1024"   # квадрат / близко к нему
    except Exception:
        return "1024x1024"


async def process_photo(photo_bytes: bytes, service: str) -> bytes | None:
    if not OPENAI_API_KEY:
        return None
    try:
        client = OpenAI(api_key=OPENAI_API_KEY)
        prompt = PROMPTS.get(service, PROMPTS["restore"])
        size = _choose_size(photo_bytes)
        logger.info(f"OpenAI edit: model=gpt-image-2, size={size}, service={service}")

        response = client.images.edit(
            model="gpt-image-2",
            image=("photo.jpg", photo_bytes, "image/jpeg"),
            prompt=prompt,
            size=size,
            quality="high",
        )
        return base64.b64decode(response.data[0].b64_json)
    except Exception as e:
        logger.error(f"OpenAI processing error: {e}")
        return None


# ─────────────────────────────────────────────────────────
#  ХЕЛПЕР — ТЕКСТ ОПЛАТЫ
# ─────────────────────────────────────────────────────────
def payment_message(service_key: str, amount: int, discount: int) -> str:
    svc = SERVICES[service_key]
    original = svc["price"]

    if discount:
        price_line = f"~~{original}₽~~ → *{amount}₽*  _(скидка {discount}%)_"
    else:
        price_line = f"*{amount}₽*"

    lines = [
        f"💰 *{svc['name']}* — {price_line}",
        f"_{svc['desc']}_",
        f"⏱ Готово за: {svc['time']}",
        "─────────────────",
        "📲 *Как оплатить:*",
        "",
    ]

    if SBP_LINK:
        lines.append(f"1️⃣ Переведите *{amount}₽* по СБП:\n{SBP_LINK}")
    elif CARD_NUMBER:
        lines.append(f"1️⃣ Переведите *{amount}₽* на карту:\n`{CARD_NUMBER}`")
    else:
        lines.append(f"1️⃣ Переведите *{amount}₽*\nРеквизиты: напишите @alenaprasol")

    lines += [
        "",
        "2️⃣ Пришлите сюда *скриншот* оплаты",
        "",
        "✅ После проверки — обработаем фото в течение нескольких минут",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────
#  /start
# ─────────────────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user_id = update.effective_user.id
    stats["users"].add(user_id)

    # Пара до/после
    examples_dir = os.path.join(os.path.dirname(__file__), "examples")
    before = os.path.join(examples_dir, "01_couple_before.jpg")
    after  = os.path.join(examples_dir, "01_couple_after.png")

    if os.path.exists(before) and os.path.exists(after):
        with open(before, "rb") as b, open(after, "rb") as a:
            await context.bot.send_media_group(chat_id, media=[
                InputMediaPhoto(b, caption="⬅️ *До* — разрыв на пол-фотографии", parse_mode="Markdown"),
                InputMediaPhoto(a, caption="➡️ *После* — ни следа разрыва ✨", parse_mode="Markdown"),
            ])

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🖼 Ещё примеры", callback_data="examples"),
         InlineKeyboardButton("💰 Цены", callback_data="price")],
        [InlineKeyboardButton("❓ Частые вопросы", callback_data="faq"),
         InlineKeyboardButton("🎁 Промокод", callback_data="promo_info")],
    ])

    await context.bot.send_message(
        chat_id,
        "✨ *Реставрация старых фотографий*\n\n"
        "Возвращаю жизнь семейным снимкам — даже самым повреждённым.\n\n"
        "Что умею:\n"
        "📸 Убираю царапины, трещины, разрывы\n"
        "🎨 Раскрашиваю чёрно-белые фото\n"
        "🔍 Восстанавливаю лица и детали\n"
        "🎬 Оживляю фото — делаю живые видео\n"
        "🖨 Готовлю к печати в большом формате\n"
        "👑 Сложные случаи — беру в работу лично\n\n"
        "⚡️ Авто-результат за 2–5 мин · От 99 ₽\n\n"
        "👇 *Просто пришлите фото* — ИИ сам оценит что нужно сделать",
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ─────────────────────────────────────────────────────────
#  /help — FAQ
# ─────────────────────────────────────────────────────────
async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
        send = query.message.reply_text
    else:
        send = update.message.reply_text

    keyboard = []
    for i, (q, _) in enumerate(FAQ_ITEMS):
        keyboard.append([InlineKeyboardButton(q, callback_data=f"faq:{i}")])

    await send(
        "❓ *Часто задаваемые вопросы*\n\nВыберите вопрос:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def handle_faq_question(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    idx = int(query.data.split(":")[1])
    q, a = FAQ_ITEMS[idx]

    keyboard = [
        [InlineKeyboardButton("◀️ Назад к вопросам", callback_data="faq")],
        [InlineKeyboardButton("📸 Отправить фото", callback_data="send_photo_hint")],
    ]
    await query.edit_message_text(
        f"*{q}*\n\n{a}",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def handle_faq_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    keyboard = []
    for i, (q, _) in enumerate(FAQ_ITEMS):
        keyboard.append([InlineKeyboardButton(q, callback_data=f"faq:{i}")])
    await query.edit_message_text(
        "❓ *Часто задаваемые вопросы*\n\nВыберите вопрос:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ─────────────────────────────────────────────────────────
#  ПРИМЕРЫ РАБОТ
# ─────────────────────────────────────────────────────────
async def show_examples(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
        chat_id = query.message.chat_id
    else:
        chat_id = update.message.chat_id

    await context.bot.send_message(
        chat_id,
        "🖼 *Примеры работ*\n\n"
        "Слева — оригинал, справа — после реставрации.\n"
        "Пришлите своё фото — сделаем так же! 👇",
        parse_mode="Markdown",
    )

    examples_dir = os.path.join(os.path.dirname(__file__), "examples")
    if os.path.exists(examples_dir):
        pairs = []
        files = sorted(f for f in os.listdir(examples_dir) if f.endswith((".jpg", ".jpeg", ".png")))
        # Группируем попарно (before/after)
        seen = set()
        for fname in files:
            prefix = fname[:2]
            if prefix not in seen:
                seen.add(prefix)
                before = next((f for f in files if f.startswith(prefix) and "before" in f), None)
                after  = next((f for f in files if f.startswith(prefix) and "after" in f), None)
                if before and after:
                    pairs.append((before, after))

        for before_name, after_name in pairs:
            bp = os.path.join(examples_dir, before_name)
            ap = os.path.join(examples_dir, after_name)
            with open(bp, "rb") as b, open(ap, "rb") as a:
                await context.bot.send_media_group(chat_id, media=[
                    InputMediaPhoto(b, caption="⬅️ До"),
                    InputMediaPhoto(a, caption="➡️ После"),
                ])


# ─────────────────────────────────────────────────────────
#  ЦЕНЫ
# ─────────────────────────────────────────────────────────
async def show_price(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
        chat_id = query.message.chat_id
    else:
        chat_id = update.message.chat_id

    lines = ["💰 *Услуги и цены:*\n"]
    for svc in SERVICES.values():
        lines.append(f"{svc['name']} — *{svc['price']}₽*")
        lines.append(f"_{svc['desc']}_ · {svc['time']}\n")

    lines.append("─────────────────")
    lines.append("🎁 Есть промокод? Введите /promo")
    lines.append("📸 Пришлите фото — начнём!")

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📸 Отправить фото", callback_data="send_photo_hint")],
        [InlineKeyboardButton("❓ Вопросы", callback_data="faq")],
    ])

    await context.bot.send_message(
        chat_id,
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ─────────────────────────────────────────────────────────
#  ПРОМОКОД
# ─────────────────────────────────────────────────────────
async def cmd_promo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id in used_promos:
        await update.message.reply_text(
            "ℹ️ Вы уже использовали промокод — он работает один раз на первый заказ."
        )
        return
    awaiting_promo.add(user_id)
    await update.message.reply_text(
        "🎁 *Введите промокод:*\n\n_Каждый промокод — один раз на первый заказ._",
        parse_mode="Markdown",
    )


async def handle_promo_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.message.reply_text(
        "🎁 *Промокоды на скидку*\n\n"
        "Подписчики канала @kontentdesignn получают *−50%* на первый заказ!\n\n"
        "Введите команду /promo и напишите промокод.",
        parse_mode="Markdown",
    )


async def handle_promo_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    code = update.message.text.strip().upper()
    awaiting_promo.discard(user_id)

    if code in PROMO_CODES:
        discount = PROMO_CODES[code]
        user_promo[user_id] = discount
        await update.message.reply_text(
            f"✅ Промокод *{code}* активирован!\n"
            f"Скидка *{discount}%* применится к следующему заказу.\n\n"
            "Теперь пришлите фото 📸",
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text(
            "❌ Промокод не найден. Проверьте написание.\n\n/promo — попробовать снова"
        )


# ─────────────────────────────────────────────────────────
#  ПОЛУЧЕНИЕ ФОТО
# ─────────────────────────────────────────────────────────
async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    # Если есть активная заявка — это скриншот оплаты
    if user_id in pending_payments:
        await handle_payment_screenshot(update, context)
        return

    # Скачиваем фото для анализа
    photo_file = update.message.photo[-1] if update.message.photo else None
    if not photo_file:
        await update.message.reply_text("Пришлите фотографию (не файл).")
        return

    msg = await update.message.reply_text("🔍 Анализирую ваше фото...")

    # Скачиваем и анализируем через GPT-4o
    file = await context.bot.get_file(photo_file.file_id)
    photo_bytes = bytes(await file.download_as_bytearray())
    analysis = await analyze_photo(photo_bytes)

    user_data[user_id] = {"photo_id": photo_file.file_id}
    discount = user_promo.get(user_id, 0)

    # Строим клавиатуру услуг
    keyboard = []
    recommend = analysis.get("recommend") if analysis else None

    for key, svc in SERVICES.items():
        original = svc["price"]
        final = round(original * (1 - discount / 100)) if discount else original

        if discount:
            label = f"{svc['name']} — {final}₽  (-{discount}%)"
        else:
            label = f"{svc['name']} — {final}₽"

        # Рекомендованную услугу выделяем звёздочкой
        if key == recommend:
            label = "⭐ " + label + " ← рекомендую"

        keyboard.append([InlineKeyboardButton(label, callback_data=f"service:{key}")])

    # Формируем текст с анализом
    if analysis:
        issues = []
        if analysis.get("is_bw"):
            issues.append("чёрно-белое фото")
        if analysis.get("has_damage"):
            lvl = {"light": "лёгкие", "medium": "средние", "heavy": "сильные"}.get(
                analysis.get("damage_level", ""), "")
            if lvl:
                issues.append(f"{lvl} повреждения")
        if analysis.get("face_quality") == "blurry":
            issues.append("размытые лица")

        analysis_text = "✅ *Фото получено!*\n\n"
        if issues:
            analysis_text += f"🔍 Вижу: {', '.join(issues)}\n"
        if analysis.get("comment"):
            analysis_text += f"_{analysis['comment']}_\n"
        if recommend and recommend in SERVICES:
            analysis_text += f"\n💡 Рекомендую: *{SERVICES[recommend]['name']}*\n"
        if discount:
            analysis_text += f"\n🎁 Активна скидка {discount}%\n"
        analysis_text += "\n👇 Выберите услугу:"
    else:
        promo_hint = f"\n🎁 Скидка {discount}% активна!" if discount else ""
        analysis_text = f"✅ Фото получено!{promo_hint}\n\n👇 Выберите услугу:"

    await msg.edit_text(
        analysis_text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ─────────────────────────────────────────────────────────
#  ВЫБОР УСЛУГИ
# ─────────────────────────────────────────────────────────
async def handle_service_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    service_key = query.data.split(":")[1]
    service = SERVICES[service_key]

    # Применяем промокод
    discount = user_promo.pop(user_id, 0)
    original = service["price"]
    final_price = round(original * (1 - discount / 100)) if discount else original
    if discount:
        used_promos.add(user_id)

    pending_payments[user_id] = {
        "service": service_key,
        "photo_id": user_data.get(user_id, {}).get("photo_id"),
        "amount": final_price,
        "discount": discount,
        "username": query.from_user.username or str(user_id),
        "created_at": datetime.now().isoformat(),
    }

    # Тест-режим для Алёны — без оплаты
    if user_id in test_mode_users:
        test_mode_users.discard(user_id)
        await query.edit_message_text(
            f"🧪 *Тест:* {service['name']}\n⏳ Обрабатываю...",
            parse_mode="Markdown",
        )
        await context.bot.send_message(user_id, "⏳ Начинаю обработку...")
        await process_and_send(context.bot, user_id, service_key)
        return

    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Отмена", callback_data="cancel")]])

    await query.edit_message_text(
        payment_message(service_key, final_price, discount),
        parse_mode="Markdown",
        reply_markup=keyboard,
    )


# ─────────────────────────────────────────────────────────
#  СКРИНШОТ ОПЛАТЫ
# ─────────────────────────────────────────────────────────
async def handle_payment_screenshot(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    payment = pending_payments.get(user_id)

    if not payment:
        await update.message.reply_text(
            "Пожалуйста, сначала пришлите фото и выберите услугу."
        )
        return

    await update.message.reply_text(
        "⏳ Скриншот получен! Проверяем оплату...\n"
        "Обычно это занимает несколько минут."
    )

    svc = SERVICES[payment["service"]]
    caption = (
        f"💳 *Новая оплата на проверке*\n\n"
        f"👤 @{payment['username']} (ID: `{user_id}`)\n"
        f"🎨 {svc['name']}\n"
        f"💰 {payment['amount']}₽"
        + (f" (−{payment.get('discount', 0)}%)" if payment.get("discount") else "")
    )

    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Подтвердить", callback_data=f"confirm:{user_id}"),
        InlineKeyboardButton("❌ Отклонить",   callback_data=f"reject:{user_id}"),
    ]])

    if update.message.photo:
        await context.bot.send_photo(
            ADMIN_ID, photo=update.message.photo[-1].file_id,
            caption=caption, parse_mode="Markdown", reply_markup=keyboard
        )
    elif update.message.document:
        await context.bot.send_document(
            ADMIN_ID, document=update.message.document.file_id,
            caption=caption, parse_mode="Markdown", reply_markup=keyboard
        )


# ─────────────────────────────────────────────────────────
#  ПОДТВЕРЖДЕНИЕ ОПЛАТЫ (АЛЁНА)
# ─────────────────────────────────────────────────────────
async def handle_admin_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query

    if query.from_user.id != ADMIN_ID:
        await query.answer("Нет доступа", show_alert=True)
        return

    await query.answer()
    action, client_id_str = query.data.split(":")
    client_id = int(client_id_str)
    payment = pending_payments.get(client_id)

    if not payment:
        await query.edit_message_caption("⚠️ Заявка не найдена или уже обработана")
        return

    if action == "confirm":
        await query.edit_message_caption(
            (query.message.caption or "") + "\n\n⏳ *Подтверждено — обрабатываю...*",
            parse_mode="Markdown",
        )
        await context.bot.send_message(
            client_id,
            "✅ Оплата подтверждена! Начинаю работу...\n⏳ Подождите немного.",
        )
        await process_and_send(context.bot, client_id, payment["service"], query)

    elif action == "reject":
        await query.edit_message_caption(
            (query.message.caption or "") + "\n\n❌ *Отклонено*",
            parse_mode="Markdown",
        )
        await context.bot.send_message(
            client_id,
            "❌ Оплата не подтверждена.\n"
            "Если ошибка — напишите @alenaprasol, разберёмся!",
        )
        pending_payments.pop(client_id, None)


# ─────────────────────────────────────────────────────────
#  ОБРАБОТКА ФОТО ЧЕРЕЗ OPENAI
# ─────────────────────────────────────────────────────────
async def process_and_send(bot, user_id: int, service_key: str, query=None):
    try:
        payment = pending_payments.get(user_id)
        if not payment or not payment.get("photo_id"):
            await bot.send_message(user_id, "❌ Фото не найдено. Пришлите снова.")
            return

        svc = SERVICES[service_key]

        # Ручные услуги — передаём Алёне
        if not svc["auto"]:
            await bot.send_photo(
                ADMIN_ID,
                photo=payment["photo_id"],
                caption=(
                    f"🖼 *Заказ для ручной обработки*\n"
                    f"Услуга: {svc['name']}\n"
                    f"Клиент: {user_id} (@{payment.get('username', '?')})\n"
                    f"Сумма: {payment['amount']}₽"
                ),
                parse_mode="Markdown",
            )
            time_hint = svc["time"]
            await bot.send_message(
                user_id,
                f"📸 *Заказ принят!*\n\n"
                f"Алёна уже работает над вашим фото.\n"
                f"⏱ Ожидайте результат: {time_hint}",
                parse_mode="Markdown",
            )
            pending_payments.pop(user_id, None)
            return

        # Авто-обработка через OpenAI
        if not OPENAI_API_KEY:
            await bot.send_photo(
                ADMIN_ID, photo=payment["photo_id"],
                caption=f"🖼 Авто-обработка недоступна (нет ключа)\nКлиент: {user_id}"
            )
            await bot.send_message(
                user_id,
                "📸 Передала фото Алёне!\nРезультат пришлём в течение 24 часов."
            )
            pending_payments.pop(user_id, None)
            return

        file = await bot.get_file(payment["photo_id"])
        photo_bytes = bytes(await file.download_as_bytearray())
        result = await process_photo(photo_bytes, service_key)

        if result:
            await bot.send_photo(
                user_id,
                photo=result,
                caption=(
                    "✅ *Готово!*\n\n"
                    "Понравился результат? Напишите @alenaprasol — "
                    "передам слова благодарности 🙏\n\n"
                    "Хотите улучшить ещё — пришлите фото снова."
                ),
                parse_mode="Markdown",
            )
            # Обновляем статус у Алёны
            if query:
                try:
                    await query.edit_message_caption(
                        (query.message.caption or "") + "\n\n✅ *Готово — результат отправлен клиенту*",
                        parse_mode="Markdown",
                    )
                except Exception:
                    pass

            # Статистика
            stats["orders"] += 1
            stats["revenue"] += payment.get("amount", 0)

            # Просим оценку через 10 секунд
            context_data = {"user_id": user_id}
            await bot.send_message(
                user_id,
                "⭐ Оцените работу — это важно для нас:",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("⭐", callback_data=f"rate:1:{user_id}"),
                    InlineKeyboardButton("⭐⭐", callback_data=f"rate:2:{user_id}"),
                    InlineKeyboardButton("⭐⭐⭐", callback_data=f"rate:3:{user_id}"),
                    InlineKeyboardButton("⭐⭐⭐⭐", callback_data=f"rate:4:{user_id}"),
                    InlineKeyboardButton("⭐⭐⭐⭐⭐", callback_data=f"rate:5:{user_id}"),
                ]]),
            )
        else:
            await bot.send_message(
                user_id,
                "😔 Автоматическая обработка не удалась.\n"
                "Передаю Алёне — результат в течение 24 часов.",
            )
            await bot.send_photo(
                ADMIN_ID, photo=payment["photo_id"],
                caption=f"⚠️ Ошибка авто-обработки\nУслуга: {svc['name']}\nКлиент: {user_id}"
            )

        pending_payments.pop(user_id, None)

    except Exception as e:
        logger.error(f"process_and_send error: {e}")
        await bot.send_message(user_id, "❌ Ошибка. Напишите @alenaprasol — разберёмся!")


# ─────────────────────────────────────────────────────────
#  ОЦЕНКА РАБОТЫ
# ─────────────────────────────────────────────────────────
async def handle_rating(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    parts = query.data.split(":")
    rating = int(parts[1])
    stars = "⭐" * rating

    await query.edit_message_text(
        f"Спасибо! Вы поставили {stars}\n\n"
        "Буду рада видеть вас снова! 🙂\n"
        "Пришлите следующее фото — обработаем."
    )

    # Уведомляем Алёну об оценке
    await context.bot.send_message(
        ADMIN_ID,
        f"⭐ Новая оценка: {stars} от @{query.from_user.username or query.from_user.id}",
    )


# ─────────────────────────────────────────────────────────
#  ОТМЕНА
# ─────────────────────────────────────────────────────────
async def handle_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pending_payments.pop(query.from_user.id, None)
    await query.edit_message_text(
        "Заказ отменён. Пришлите фото снова — когда будете готовы 🙂"
    )


# ─────────────────────────────────────────────────────────
#  ПОДСКАЗКА "ОТПРАВЬТЕ ФОТО"
# ─────────────────────────────────────────────────────────
async def handle_send_photo_hint(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.message.reply_text(
        "📸 Прикрепите фото кнопкой 📎 или просто перетащите — и начнём!"
    )


# ─────────────────────────────────────────────────────────
#  ТЕКСТОВЫЕ СООБЩЕНИЯ
# ─────────────────────────────────────────────────────────
async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text.strip().lower()

    # Ввод промокода
    if user_id in awaiting_promo:
        await handle_promo_input(update, context)
        return

    # Тест-режим для Алёны
    if user_id == ADMIN_ID and text in ("тест", "test", "тест!", "test!", "/тест"):
        await cmd_test(update, context)
        return

    await update.message.reply_text(
        "📸 Пришлите фото для реставрации!\n\n"
        "/start — главное меню\n"
        "/price — цены\n"
        "/examples — примеры работ\n"
        "/help — вопросы и ответы\n"
        "/promo — ввести промокод",
    )


# ─────────────────────────────────────────────────────────
#  КОМАНДЫ АДМИНИСТРАТОРА
# ─────────────────────────────────────────────────────────
async def cmd_test(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Тест для Алёны — реставрация без оплаты. Пришлите /test и потом фото."""
    if update.effective_user.id != ADMIN_ID:
        return
    test_mode_users.add(update.effective_user.id)
    await update.message.reply_text(
        "🧪 *Тестовый режим*\n\n"
        "Пришлите фото — выберите услугу — обработаю без оплаты.",
        parse_mode="Markdown",
    )

async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return
    await update.message.reply_text(
        f"📊 *Статистика бота*\n\n"
        f"👥 Всего пользователей: {len(stats['users'])}\n"
        f"✅ Выполнено заказов: {stats['orders']}\n"
        f"💰 Выручка: {stats['revenue']}₽\n"
        f"⏳ Ожидают оплаты: {len(pending_payments)}\n"
        f"🔑 OpenAI: {'✅ подключён' if OPENAI_API_KEY else '❌ нет — ручной режим'}\n"
        f"💳 СБП: {'✅' if SBP_LINK else '❌ не задан'}",
        parse_mode="Markdown",
    )


async def cmd_sendresult(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Алёна отправляет результат клиенту: /sendresult <user_id>"""
    if update.effective_user.id != ADMIN_ID:
        return

    args = context.args
    if not args:
        await update.message.reply_text(
            "Использование: /sendresult <user_id>\n"
            "Затем пришлите фото или видео — оно уйдёт клиенту."
        )
        return

    try:
        target_id = int(args[0])
        context.user_data["send_to"] = target_id
        await update.message.reply_text(
            f"✅ Следующее фото/видео отправлю клиенту {target_id}."
        )
    except ValueError:
        await update.message.reply_text("❌ Неверный ID пользователя.")


async def handle_admin_media(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Алёна прислала медиа для пересылки клиенту"""
    if update.effective_user.id != ADMIN_ID:
        return

    target_id = context.user_data.get("send_to")
    if not target_id:
        return  # Не в режиме пересылки — обычное фото Алёны, игнорируем

    try:
        if update.message.photo:
            await context.bot.send_photo(
                target_id,
                photo=update.message.photo[-1].file_id,
                caption="✅ *Ваш заказ готов!*\n\nЕсли понравилось — поделитесь с друзьями 🙂",
                parse_mode="Markdown",
            )
        elif update.message.video:
            await context.bot.send_video(
                target_id,
                video=update.message.video.file_id,
                caption="✅ *Ваше оживлённое фото готово!* 🎬\n\nПоделитесь с близкими 🙂",
                parse_mode="Markdown",
            )
        elif update.message.document:
            await context.bot.send_document(
                target_id,
                document=update.message.document.file_id,
                caption="✅ *Ваш заказ готов!*",
                parse_mode="Markdown",
            )
        await update.message.reply_text(f"✅ Отправлено клиенту {target_id}!")
        context.user_data.pop("send_to", None)
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка отправки: {e}")


async def cmd_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Рассылка всем пользователям: /broadcast Текст сообщения"""
    if update.effective_user.id != ADMIN_ID:
        return

    if not context.args:
        await update.message.reply_text("Использование: /broadcast Текст сообщения")
        return

    text = " ".join(context.args)
    success, fail = 0, 0
    for uid in stats["users"]:
        try:
            await context.bot.send_message(uid, text)
            success += 1
        except Exception:
            fail += 1

    await update.message.reply_text(
        f"📢 Рассылка завершена:\n✅ Отправлено: {success}\n❌ Ошибок: {fail}"
    )


# ─────────────────────────────────────────────────────────
#  ЗАПУСК
# ─────────────────────────────────────────────────────────
def main():
    app = Application.builder().token(BOT_TOKEN).build()

    # Команды
    app.add_handler(CommandHandler("start",       cmd_start))
    app.add_handler(CommandHandler("help",        cmd_help))
    app.add_handler(CommandHandler("price",       show_price))
    app.add_handler(CommandHandler("examples",    show_examples))
    app.add_handler(CommandHandler("promo",       cmd_promo))
    app.add_handler(CommandHandler("stats",       cmd_stats))
    app.add_handler(CommandHandler("test",        cmd_test))
    app.add_handler(CommandHandler("sendresult",  cmd_sendresult))
    app.add_handler(CommandHandler("broadcast",   cmd_broadcast))

    # Callback кнопки
    app.add_handler(CallbackQueryHandler(show_examples,        pattern="^examples$"))
    app.add_handler(CallbackQueryHandler(show_price,           pattern="^price$"))
    app.add_handler(CallbackQueryHandler(handle_faq_menu,      pattern="^faq$"))
    app.add_handler(CallbackQueryHandler(handle_faq_question,  pattern="^faq:\\d+$"))
    app.add_handler(CallbackQueryHandler(handle_promo_info,    pattern="^promo_info$"))
    app.add_handler(CallbackQueryHandler(handle_service_choice,pattern="^service:"))
    app.add_handler(CallbackQueryHandler(handle_admin_confirm, pattern="^(confirm|reject):"))
    app.add_handler(CallbackQueryHandler(handle_cancel,        pattern="^cancel$"))
    app.add_handler(CallbackQueryHandler(handle_rating,        pattern="^rate:"))
    app.add_handler(CallbackQueryHandler(handle_send_photo_hint, pattern="^send_photo_hint$"))

    # Медиа — фото и документы
    app.add_handler(MessageHandler(
        (filters.PHOTO | filters.Document.IMAGE | filters.VIDEO) & ~filters.COMMAND,
        lambda u, c: handle_admin_media(u, c)
        if u.effective_user.id == ADMIN_ID and c.user_data.get("send_to")
        else handle_photo(u, c),
    ))

    # Текстовые сообщения
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    logger.info("🎨 @FotoRestavraciyaBot v2.0 запущен")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
