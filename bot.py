"""
@alenassisttbot — Универсальный помощник Алёны Прасоловой
SMM + Копирайтер + Дизайнер + Фотограф + Бизнес-консультант
"""
import logging
import asyncio
import json
import os
from datetime import datetime, date, timedelta
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

# === НАСТРОЙКИ ===
BOT_TOKEN    = "8872835678:AAGDEE3BjFu4DfXj9_pWZs6JjoTVTdOA3aI"
CHANNEL_ID   = "@kontentdesignn"
OWNER_ID     = 196603219          # Telegram ID Алёны — для напоминаний
CLAUDE_BIN   = "/usr/bin/claude"
SCHEDULE_FILE = "/home/agent/projects/telegram-assistant/schedule.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════
# ЕДИНЫЙ МОЗГ — все специалисты в одном
# ═══════════════════════════════════════════════════════════
SYSTEM_PROMPT = """Ты — Макс, персональный помощник Алёны Прасоловой.

Ты не переключаешься между ролями — ты один человек, у которого в голове живут все эти навыки одновременно. Ты мыслишь как профессионал, который всю жизнь работал на стыке творчества и бизнеса.

═══ ТВОИ НАВЫКИ ═══

📱 SMM и Telegram-маркетинг:
— 10+ лет работы с каналами, знаешь алгоритмы вдоль и поперёк
— Понимаешь как строится контент-воронка: незнакомец → читатель → клиент
— Знаешь когда публиковать, как писать заголовки, что цепляет аудиторию
— Умеешь анализировать конкурентов и находить незанятые ниши

✍️ Копирайтинг:
— Пишешь продающие тексты, которые не давят, а убеждают
— Умеешь писать письма клиентам, коммерческие предложения, ответы на возражения
— Знаешь формулы: AIDA, PAS, ХПВ, сторителлинг
— Пишешь живым языком, как будто Алёна сама рассказывает — без шаблонов

🎨 Дизайн и визуал:
— Разбираешься в композиции, цветовых сочетаниях, типографике
— Знаешь как работать в Canva, что делает макет "дешёвым" или "дорогим"
— Понимаешь разницу между афишей, баннером, сторис — и что нужно каждому формату
— Даёшь конкретные советы: "возьми шрифт такой, фон такой, отступы вот столько"

📸 Фотография:
— Знаешь как снимать на телефон чтобы было как с камеры
— Понимаешь свет, ракурсы, постановку для предметной, портретной, репортажной съёмки
— Умеешь объяснить обработку в Lightroom, VSCO, телефонных приложениях
— Знаешь специфику фото для соцсетей: размеры, кадрирование, что цепляет в ленте

💼 Бизнес и работа с клиентами:
— Помогаешь с ценообразованием: как не продешевить и не напугать
— Знаешь как позиционировать услуги, чем отличаться от конкурентов
— Умеешь составить бриф, договор, ответить на сложный запрос клиента
— Понимаешь воронку продаж и как превратить подписчика в клиента

═══ ОБ АЛЁНЕ ═══
— Дизайнер и фотограф
— Канал @kontentdesignn (контент-дизайн для бизнеса)
— Услуги: афиши, сторис, баннеры, реставрация фото, объявления
— Аудитория: малый бизнес, бьюти-мастера, эксперты, организаторы
— Стиль канала: тёмный фон, неоново-фиолетовый акцент, тёплый голос

═══ КАК ТЫ ОТВЕЧАЕШЬ ═══
— Говоришь как живой человек, не как справочник
— Применяешь сразу несколько навыков в ответе если нужно
— Не спрашиваешь лишнего — предлагаешь лучшее решение сразу
— Иногда говоришь прямо: "Это не работает, вот почему"
— Используешь эмодзи только где они усиливают смысл
— Отвечаешь на русском языке"""


# ═══════════════════════════════════════════════════════════
# ПЛАНИРОВЩИК — работа с расписанием
# ═══════════════════════════════════════════════════════════

def load_schedule() -> dict:
    if os.path.exists(SCHEDULE_FILE):
        try:
            with open(SCHEDULE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"posts": []}


def save_schedule(data: dict):
    with open(SCHEDULE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_posts_for_date(target_date: str) -> list:
    data = load_schedule()
    return [p for p in data["posts"] if p.get("date") == target_date]


def add_post_to_schedule(post_date: str, post_time: str, topic: str, text: str = "") -> bool:
    data = load_schedule()
    data["posts"].append({
        "date": post_date,
        "time": post_time,
        "topic": topic,
        "text": text,
        "done": False,
        "id": int(datetime.now().timestamp())
    })
    data["posts"].sort(key=lambda x: (x["date"], x["time"]))
    save_schedule(data)
    return True


def mark_post_done(post_id: int):
    data = load_schedule()
    for p in data["posts"]:
        if p.get("id") == post_id:
            p["done"] = True
    save_schedule(data)


def format_schedule_week() -> str:
    data = load_schedule()
    today = date.today()
    lines = ["📅 *Контент-план на неделю:*\n"]
    days_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    has_posts = False
    for i in range(7):
        day = today + timedelta(days=i)
        day_str = day.strftime("%Y-%m-%d")
        day_label = f"{days_ru[day.weekday()]} {day.strftime('%d.%m')}"
        posts = [p for p in data["posts"] if p["date"] == day_str]
        if posts:
            has_posts = True
            lines.append(f"*{day_label}*")
            for p in posts:
                status = "✅" if p.get("done") else "⏳"
                lines.append(f"  {status} {p['time']} — {p['topic']}")
        else:
            lines.append(f"*{day_label}* — свободно")
    if not has_posts:
        lines.append("\n_Расписание пустое. Добавь посты командой /add\\_plan_")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════
# CLAUDE — вызов через CLI
# ═══════════════════════════════════════════════════════════

async def ask_claude(user_message: str, extra_system: str = "") -> str:
    system = SYSTEM_PROMPT
    if extra_system:
        system += f"\n\n{extra_system}"
    try:
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN, "-p", user_message,
            "--output-format", "json",
            "--max-turns", "1",
            "--model", "sonnet",
            "--append-system-prompt", system,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        if proc.returncode != 0:
            log.error(f"Claude CLI stderr: {stderr.decode()}")
            return "❌ Не удалось получить ответ. Попробуй ещё раз."
        data = json.loads(stdout.decode())
        return data.get("result", "❌ Пустой ответ")
    except asyncio.TimeoutError:
        return "⏱ Превышено время ожидания. Попробуй ещё раз."
    except Exception as e:
        log.error(f"Claude error: {e}")
        return f"❌ Ошибка: {e}"


async def ask_claude_with_history(messages: list, extra_system: str = "") -> str:
    history_text = ""
    for m in messages[:-1]:
        role = "Алёна" if m["role"] == "user" else "Макс"
        history_text += f"{role}: {m['content']}\n\n"
    last = messages[-1]["content"] if messages else ""
    if history_text:
        full_prompt = f"[История диалога:]\n{history_text}[Текущее сообщение Алёны:]\n{last}"
    else:
        full_prompt = last
    return await ask_claude(full_prompt, extra_system)


# ═══════════════════════════════════════════════════════════
# НАПОМИНАНИЯ — ежедневная рассылка
# ═══════════════════════════════════════════════════════════

async def daily_reminder(context: ContextTypes.DEFAULT_TYPE):
    today = date.today().strftime("%Y-%m-%d")
    posts = get_posts_for_date(today)
    if not posts:
        return
    lines = ["☀️ *Доброе утро, Алёна!*\n\nСегодня по плану:\n"]
    for p in posts:
        status = "✅" if p.get("done") else "⏰"
        lines.append(f"{status} *{p['time']}* — {p['topic']}")
    lines.append("\nНапиши /plan\\_today чтобы посмотреть детали.")
    try:
        await context.bot.send_message(
            OWNER_ID, "\n".join(lines), parse_mode="Markdown"
        )
    except Exception as e:
        log.error(f"Reminder error: {e}")


# ═══════════════════════════════════════════════════════════
# КОМАНДЫ
# ═══════════════════════════════════════════════════════════

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [
            InlineKeyboardButton("✍️ Написать пост", callback_data="menu_post"),
            InlineKeyboardButton("💡 Идеи контента", callback_data="menu_ideas"),
        ],
        [
            InlineKeyboardButton("📅 Контент-план", callback_data="menu_plan"),
            InlineKeyboardButton("📊 Стратегия канала", callback_data="menu_strategy"),
        ],
        [
            InlineKeyboardButton("🔥 Вирусный пост", callback_data="menu_viral"),
            InlineKeyboardButton("💰 Продающий пост", callback_data="menu_sell"),
        ],
        [
            InlineKeyboardButton("🗓 Моё расписание", callback_data="menu_schedule"),
            InlineKeyboardButton("🎨 Совет по дизайну", callback_data="menu_design"),
        ],
        [
            InlineKeyboardButton("📸 Совет по фото", callback_data="menu_photo"),
            InlineKeyboardButton("💼 Вопрос по бизнесу", callback_data="menu_biz"),
        ],
    ]
    await update.message.reply_text(
        "👋 Привет, Алёна!\n\n"
        "Я Макс — твой универсальный помощник.\n"
        "В голове держу всё: SMM, копирайтинг, дизайн, фото, бизнес.\n"
        "Применяю сразу несколько навыков — смотря что нужно.\n\n"
        "Что делаем? 👇",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📋 *Команды:*\n\n"
        "*Контент:*\n"
        "✍️ /post — написать пост\n"
        "💡 /ideas — идеи для постов\n"
        "📊 /strategy — стратегия канала\n"
        "🔥 /viral — вирусный пост\n"
        "💰 /sell — продающий пост\n"
        "🎯 /hook — цепляющий заголовок\n"
        "📤 /publish — опубликовать в канал\n\n"
        "*Планировщик:*\n"
        "🗓 /my\\_plan — расписание на неделю\n"
        "📌 /plan\\_today — посты на сегодня\n"
        "➕ /add\\_plan — добавить пост в план\n\n"
        "*Экспертиза:*\n"
        "🎨 /design — совет по визуалу\n"
        "📸 /photo — совет по фото\n"
        "✉️ /letter — написать письмо клиенту\n"
        "💰 /price — помощь с ценами\n\n"
        "Или просто напиши что нужно — разберёмся! 💜",
        parse_mode="Markdown"
    )


async def cmd_post(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if ctx.args:
        topic = " ".join(ctx.args)
        await update.message.reply_text(f"✍️ Пишу пост на тему «{topic}»...")
        text = await ask_claude(
            f"Напиши пост для Telegram-канала @kontentdesignn на тему: {topic}\n"
            "Требования: цепляющий заголовок, живой язык от первого лица Алёны, "
            "конкретика, призыв к действию, 3-5 хэштегов, 800-1500 знаков."
        )
        ctx.user_data["last_post"] = text
        keyboard = [
            [InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last"),
             InlineKeyboardButton("🔄 Переписать", callback_data=f"rewrite|{topic}")],
            [InlineKeyboardButton("🎭 Другой формат", callback_data=f"format|{topic}"),
             InlineKeyboardButton("✂️ Короче", callback_data=f"shorter|{topic}")],
            [InlineKeyboardButton("📌 Добавить в план", callback_data=f"plan_this|{topic}")],
        ]
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        ctx.user_data["waiting_for"] = "post_topic"
        await update.message.reply_text(
            "✍️ На какую тему написать пост?\n\n"
            "Примеры:\n"
            "• Почему дешёвый дизайн стоит дорого\n"
            "• Как я за 2 часа сделала афишу которую все репостят\n"
            "• 3 ошибки в объявлениях которые убивают продажи\n"
            "• Кейс: реставрация свадебного фото"
        )


async def cmd_ideas(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("💡 Генерирую идеи...")
    text = await ask_claude(
        "Придумай 7 сильных идей для постов в канал @kontentdesignn. "
        "Для каждой: заголовок, формат (кейс/обучалка/личное/продающий), почему сработает. "
        "Разнообразие: не все продающие. Учитывай SMM, дизайн, фото, работу с клиентами."
    )
    keyboard = [[InlineKeyboardButton("✍️ Написать любой из этих постов", callback_data="menu_post")]]
    await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


async def cmd_strategy(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📊 Разрабатываю стратегию...")
    today = date.today()
    text = await ask_claude(
        f"Разработай стратегию развития @kontentdesignn на 3 месяца. Сегодня {today.strftime('%d.%m.%Y')}.\n"
        "О канале: Алёна — дизайнер и фотограф, услуги: афиши, сторис, баннеры, реставрация фото.\n"
        "Аудитория: малый бизнес, бьюти, эксперты. Канал молодой.\n"
        "Включи: цели по месяцам, контент-микс, способы роста, воронку продаж, топ-5 действий сейчас."
    )
    await update.message.reply_text(text)


async def cmd_viral(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    topic = " ".join(ctx.args) if ctx.args else "контент-дизайн для бизнеса"
    await update.message.reply_text("🔥 Пишу вирусный пост...")
    text = await ask_claude(
        f"Напиши вирусный пост для @kontentdesignn на тему: {topic}. "
        "Мощный крючок в первых 2 строках, вызывает реакцию, хочется репостнуть. "
        "500-900 знаков. 2 варианта: провокационный и вдохновляющий."
    )
    ctx.user_data["last_post"] = text
    keyboard = [
        [InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")],
        [InlineKeyboardButton("🔄 Другой вариант", callback_data=f"rewrite_viral|{topic}")],
    ]
    await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


async def cmd_sell(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("💰 Пишу продающий пост...")
    text = await ask_claude(
        "Напиши сильный продающий пост для @kontentdesignn. "
        "Услуги: афиши, сторис, баннеры, реставрация фото, объявления. "
        "Структура: боль → решение → результат → призыв. Тон тёплый, уверенный, без давления."
    )
    ctx.user_data["last_post"] = text
    keyboard = [
        [InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")],
        [InlineKeyboardButton("🔄 Другой вариант", callback_data="rewrite_sell")],
    ]
    await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


async def cmd_hook(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if ctx.args:
        topic = " ".join(ctx.args)
        await update.message.reply_text(f"🎯 Придумываю заголовки для «{topic}»...")
        text = await ask_claude(
            f"Напиши 7 цепляющих заголовков для поста на тему: {topic}. "
            "Канал @kontentdesignn. Техники: вопрос, провокация, цифра, история, боль, любопытство, польза. "
            "После каждого — какую эмоцию вызывает."
        )
        await update.message.reply_text(text)
    else:
        ctx.user_data["waiting_for"] = "hook_topic"
        await update.message.reply_text("🎯 Напиши тему — придумаю 7 цепляющих заголовков.")


async def cmd_design(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if ctx.args:
        question = " ".join(ctx.args)
        await update.message.reply_text("🎨 Думаю...")
        text = await ask_claude(f"Вопрос по дизайну: {question}\nДай конкретный практический совет.")
        await update.message.reply_text(text)
    else:
        ctx.user_data["waiting_for"] = "design_question"
        await update.message.reply_text(
            "🎨 Задай вопрос по дизайну:\n\n"
            "Примеры:\n"
            "• Какие шрифты подойдут для афиши в тёмном стиле?\n"
            "• Как сделать сторис красиво в Canva?\n"
            "• Какие цвета использовать для баннера бьюти-мастера?\n"
            "• Почему мой макет выглядит дёшево?"
        )


async def cmd_photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if ctx.args:
        question = " ".join(ctx.args)
        await update.message.reply_text("📸 Думаю...")
        text = await ask_claude(f"Вопрос по фотографии: {question}\nДай конкретный практический совет.")
        await update.message.reply_text(text)
    else:
        ctx.user_data["waiting_for"] = "photo_question"
        await update.message.reply_text(
            "📸 Задай вопрос по фотографии:\n\n"
            "Примеры:\n"
            "• Как снять красиво на телефон в помещении без студии?\n"
            "• Как обработать фото для Telegram-канала?\n"
            "• Какой пресет в Lightroom для тёплых тонов?\n"
            "• Как сфотографировать работы для портфолио?"
        )


async def cmd_letter(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data["waiting_for"] = "letter_request"
    await update.message.reply_text(
        "✉️ Напиши что нужно написать клиенту:\n\n"
        "Примеры:\n"
        "• Ответить на запрос цены (клиент спросил сколько стоит афиша)\n"
        "• Вежливо отказать клиенту с маленьким бюджетом\n"
        "• Напомнить что клиент не оплатил\n"
        "• Попросить отзыв после выполненного заказа"
    )


async def cmd_price(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if ctx.args:
        question = " ".join(ctx.args)
        await update.message.reply_text("💰 Думаю...")
        text = await ask_claude(
            f"Вопрос по ценообразованию/бизнесу: {question}\n"
            "Контекст: Алёна — дизайнер и фотограф, работает с малым бизнесом. "
            "Дай конкретный практический совет."
        )
        await update.message.reply_text(text)
    else:
        ctx.user_data["waiting_for"] = "price_question"
        await update.message.reply_text(
            "💰 Задай вопрос по ценам или бизнесу:\n\n"
            "Примеры:\n"
            "• Сколько брать за афишу?\n"
            "• Клиент торгуется — как ответить?\n"
            "• Как поднять цены и не потерять клиентов?\n"
            "• Как составить прайс-лист?"
        )


async def cmd_publish(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    post = ctx.user_data.get("last_post")
    if post:
        try:
            await ctx.bot.send_message(CHANNEL_ID, post)
            await update.message.reply_text("✅ Опубликовано в @kontentdesignn!")
        except Exception as e:
            await update.message.reply_text(
                f"❌ Не могу опубликовать.\n"
                f"Убедись что @alenassisttbot — администратор @kontentdesignn\n\nОшибка: {e}"
            )
    else:
        await update.message.reply_text("Нет поста. Сначала создай через /post [тема]")


# ═══════════════════════════════════════════════════════════
# ПЛАНИРОВЩИК — команды
# ═══════════════════════════════════════════════════════════

async def cmd_my_plan(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = format_schedule_week()
    keyboard = [
        [InlineKeyboardButton("➕ Добавить пост", callback_data="add_plan_start")],
        [InlineKeyboardButton("💡 Предложи темы на неделю", callback_data="suggest_week")],
    ]
    await update.message.reply_text(text, parse_mode="Markdown",
                                     reply_markup=InlineKeyboardMarkup(keyboard))


async def cmd_plan_today(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    today = date.today().strftime("%Y-%m-%d")
    posts = get_posts_for_date(today)
    if not posts:
        await update.message.reply_text(
            f"📅 На сегодня ({date.today().strftime('%d.%m')}) постов нет.\n\n"
            "Добавить? /add_plan",
        )
        return
    lines = [f"📅 *Сегодня, {date.today().strftime('%d.%m')}:*\n"]
    for p in posts:
        status = "✅ Готово" if p.get("done") else "⏰ Запланировано"
        lines.append(f"*{p['time']}* — {p['topic']}\n_{status}_\n")
    keyboard = [[InlineKeyboardButton("➕ Добавить ещё", callback_data="add_plan_start")]]
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown",
                                     reply_markup=InlineKeyboardMarkup(keyboard))


async def cmd_add_plan(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data["waiting_for"] = "add_plan_date"
    days_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    today = date.today()
    keyboard = []
    row = []
    for i in range(7):
        d = today + timedelta(days=i)
        label = f"{days_ru[d.weekday()]} {d.strftime('%d.%m')}"
        row.append(InlineKeyboardButton(label, callback_data=f"plan_date|{d.strftime('%Y-%m-%d')}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    await update.message.reply_text(
        "📌 Выбери день для поста:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


# ═══════════════════════════════════════════════════════════
# ОБРАБОТКА КНОПОК
# ═══════════════════════════════════════════════════════════

async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    # ── МЕНЮ ──
    if data == "menu_post":
        ctx.user_data["waiting_for"] = "post_topic"
        await query.message.reply_text(
            "✍️ Напиши тему поста:\n\n"
            "• Реставрация свадебного фото\n"
            "• Почему дешёвый дизайн стоит дорого\n"
            "• Как я делаю афишу за 2 часа"
        )

    elif data == "menu_ideas":
        await query.message.reply_text("💡 Генерирую идеи...")
        text = await ask_claude(
            "Придумай 7 идей для постов в @kontentdesignn. "
            "Для каждой: заголовок, формат, почему сработает. Разные темы: дизайн, фото, бизнес, личное."
        )
        await query.message.reply_text(text)

    elif data == "menu_plan":
        await query.message.reply_text("📅 Составляю контент-план...")
        today = date.today()
        text = await ask_claude(
            f"Составь контент-план на неделю для @kontentdesignn. Сегодня {today.strftime('%d.%m.%Y')}. "
            "4-5 постов в неделю. Для каждого: день, время, тема, формат, цель."
        )
        keyboard = [[InlineKeyboardButton("📌 Сохранить в расписание", callback_data="save_plan_ask")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data == "menu_strategy":
        await query.message.reply_text("📊 Разрабатываю стратегию...")
        text = await ask_claude(
            "Стратегия @kontentdesignn на 3 месяца: цели, контент-микс, рост, воронка продаж, топ-5 действий."
        )
        await query.message.reply_text(text)

    elif data == "menu_viral":
        ctx.user_data["waiting_for"] = "viral_topic"
        await query.message.reply_text("🔥 На какую тему вирусный пост?")

    elif data == "menu_sell":
        await query.message.reply_text("💰 Пишу продающий пост...")
        text = await ask_claude(
            "Продающий пост для @kontentdesignn. Услуги: афиши, сторис, баннеры, реставрация фото. "
            "Боль → решение → результат → призыв. Тёплый тон."
        )
        ctx.user_data["last_post"] = text
        keyboard = [[InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data == "menu_schedule":
        text = format_schedule_week()
        keyboard = [
            [InlineKeyboardButton("➕ Добавить пост", callback_data="add_plan_start")],
            [InlineKeyboardButton("💡 Предложи темы на неделю", callback_data="suggest_week")],
        ]
        await query.message.reply_text(text, parse_mode="Markdown",
                                        reply_markup=InlineKeyboardMarkup(keyboard))

    elif data == "menu_design":
        ctx.user_data["waiting_for"] = "design_question"
        await query.message.reply_text(
            "🎨 Задай вопрос по дизайну:\n\n"
            "• Какие шрифты для тёмного стиля?\n"
            "• Как красиво сделать сторис в Canva?\n"
            "• Почему макет выглядит дёшево?"
        )

    elif data == "menu_photo":
        ctx.user_data["waiting_for"] = "photo_question"
        await query.message.reply_text(
            "📸 Задай вопрос по фото:\n\n"
            "• Как снять красиво на телефон?\n"
            "• Как обработать для Telegram-канала?\n"
            "• Пресет для тёплых тонов?"
        )

    elif data == "menu_biz":
        ctx.user_data["waiting_for"] = "price_question"
        await query.message.reply_text(
            "💼 Задай вопрос по бизнесу:\n\n"
            "• Сколько брать за афишу?\n"
            "• Как ответить на торг?\n"
            "• Как поднять цены?"
        )

    # ── ДЕЙСТВИЯ С ПОСТОМ ──
    elif data == "publish_last":
        post = ctx.user_data.get("last_post")
        if post:
            try:
                await ctx.bot.send_message(CHANNEL_ID, post)
                await query.message.reply_text("✅ Опубликовано в @kontentdesignn!")
            except Exception as e:
                await query.message.reply_text(f"❌ Ошибка: {e}\nДобавь бота администратором канала.")
        else:
            await query.message.reply_text("Нет поста для публикации.")

    elif data.startswith("rewrite|"):
        topic = data.split("|", 1)[1]
        await query.message.reply_text("🔄 Переписываю иначе...")
        text = await ask_claude(
            f"Напиши другой вариант поста для @kontentdesignn на тему: {topic}. "
            "Другой заголовок, другой угол. Более личный и живой."
        )
        ctx.user_data["last_post"] = text
        keyboard = [
            [InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last"),
             InlineKeyboardButton("🔄 Ещё раз", callback_data=f"rewrite|{topic}")],
        ]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith("format|"):
        topic = data.split("|", 1)[1]
        keyboard = [
            [InlineKeyboardButton("📖 Кейс до/после", callback_data=f"fmt_case|{topic}")],
            [InlineKeyboardButton("📚 Обучалка (5 ошибок)", callback_data=f"fmt_edu|{topic}")],
            [InlineKeyboardButton("❤️ Личная история", callback_data=f"fmt_personal|{topic}")],
            [InlineKeyboardButton("🎭 Провокация", callback_data=f"fmt_provoke|{topic}")],
        ]
        await query.message.reply_text("Выбери формат:", reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith("fmt_"):
        parts = data.split("|", 1)
        fmt = parts[0].replace("fmt_", "")
        topic = parts[1] if len(parts) > 1 else "контент-дизайн"
        fmts = {
            "case": "кейс до/после с результатом и цифрами",
            "edu": "обучающий пост '5 ошибок' или '3 способа'",
            "personal": "личная история от первого лица",
            "provoke": "провокационное мнение которое вызывает реакцию"
        }
        fmt_desc = fmts.get(fmt, "пост")
        await query.message.reply_text(f"✍️ Пишу {fmt_desc}...")
        text = await ask_claude(
            f"Напиши {fmt_desc} для @kontentdesignn на тему: {topic}. "
            "Цепляющий заголовок, живой язык, призыв к действию."
        )
        ctx.user_data["last_post"] = text
        keyboard = [[InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith("shorter|"):
        last = ctx.user_data.get("last_post", "")
        await query.message.reply_text("✂️ Сокращаю...")
        text = await ask_claude(f"Сократи этот пост до 500-700 знаков, сохранив главное:\n\n{last}")
        ctx.user_data["last_post"] = text
        keyboard = [[InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith("rewrite_viral|"):
        topic = data.split("|", 1)[1]
        await query.message.reply_text("🔥 Пишу другой вариант...")
        text = await ask_claude(
            f"Другой вирусный пост для @kontentdesignn на тему: {topic}. Другой крючок, другая эмоция."
        )
        ctx.user_data["last_post"] = text
        keyboard = [[InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data == "rewrite_sell":
        await query.message.reply_text("💰 Пишу другой вариант...")
        text = await ask_claude(
            "Другой продающий пост для @kontentdesignn. Другой угол: акцент на результат клиента."
        )
        ctx.user_data["last_post"] = text
        keyboard = [[InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    # ── ПЛАНИРОВЩИК ──
    elif data == "add_plan_start":
        days_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
        today = date.today()
        keyboard = []
        row = []
        for i in range(7):
            d = today + timedelta(days=i)
            label = f"{days_ru[d.weekday()]} {d.strftime('%d.%m')}"
            row.append(InlineKeyboardButton(label, callback_data=f"plan_date|{d.strftime('%Y-%m-%d')}"))
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
        await query.message.reply_text("📌 Выбери день:", reply_markup=InlineKeyboardMarkup(keyboard))

    elif data.startswith("plan_date|"):
        chosen_date = data.split("|", 1)[1]
        ctx.user_data["plan_date"] = chosen_date
        keyboard = [
            [InlineKeyboardButton("☀️ 9:00", callback_data=f"plan_time|09:00"),
             InlineKeyboardButton("🕐 13:00", callback_data=f"plan_time|13:00")],
            [InlineKeyboardButton("🌆 18:00", callback_data=f"plan_time|18:00"),
             InlineKeyboardButton("🌙 20:00", callback_data=f"plan_time|20:00")],
        ]
        d = datetime.strptime(chosen_date, "%Y-%m-%d")
        await query.message.reply_text(
            f"📌 {d.strftime('%d.%m')} — выбери время публикации:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

    elif data.startswith("plan_time|"):
        chosen_time = data.split("|", 1)[1]
        ctx.user_data["plan_time"] = chosen_time
        ctx.user_data["waiting_for"] = "plan_topic"
        await query.message.reply_text(
            f"✅ {ctx.user_data.get('plan_date', '')} в {chosen_time}\n\n"
            "Напиши тему поста:"
        )

    elif data.startswith("plan_this|"):
        topic = data.split("|", 1)[1]
        ctx.user_data["plan_topic_ready"] = topic
        days_ru = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
        today = date.today()
        keyboard = []
        row = []
        for i in range(7):
            d = today + timedelta(days=i)
            label = f"{days_ru[d.weekday()]} {d.strftime('%d.%m')}"
            row.append(InlineKeyboardButton(label, callback_data=f"plan_date_save|{d.strftime('%Y-%m-%d')}"))
            if len(row) == 2:
                keyboard.append(row)
                row = []
        if row:
            keyboard.append(row)
        await query.message.reply_text(
            f"📌 Когда публикуем «{topic}»?\nВыбери день:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

    elif data.startswith("plan_date_save|"):
        chosen_date = data.split("|", 1)[1]
        topic = ctx.user_data.pop("plan_topic_ready", "Пост")
        post_text = ctx.user_data.get("last_post", "")
        add_post_to_schedule(chosen_date, "12:00", topic, post_text)
        d = datetime.strptime(chosen_date, "%Y-%m-%d")
        await query.message.reply_text(
            f"✅ Добавлено в расписание!\n\n"
            f"📅 {d.strftime('%d.%m')} в 12:00 — {topic}\n\n"
            f"Посмотреть план: /my_plan"
        )

    elif data == "suggest_week":
        await query.message.reply_text("💡 Подбираю темы на неделю...")
        today = date.today()
        text = await ask_claude(
            f"Предложи 5 тем для постов в @kontentdesignn на неделю начиная с {today.strftime('%d.%m.%Y')}. "
            "Для каждой: день недели, тема, формат, лучшее время публикации. "
            "Разнообразно: дизайн, фото, личное, продающее, полезное."
        )
        keyboard = [[InlineKeyboardButton("➕ Добавить пост в план", callback_data="add_plan_start")]]
        await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif data == "save_plan_ask":
        await query.message.reply_text(
            "📌 Чтобы добавить посты в расписание — нажми /add_plan\n"
            "Или напиши мне дату и тему, я добавлю сам."
        )


# ═══════════════════════════════════════════════════════════
# ОБЫЧНЫЕ СООБЩЕНИЯ
# ═══════════════════════════════════════════════════════════

async def on_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.text:
        return

    text = msg.text
    waiting = ctx.user_data.get("waiting_for")

    if waiting == "post_topic":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text(f"✍️ Пишу пост на тему «{text}»...")
        post = await ask_claude(
            f"Напиши пост для @kontentdesignn на тему: {text}. "
            "Цепляющий заголовок, живой язык, конкретика, призыв к действию, 3-5 хэштегов, 800-1500 знаков."
        )
        ctx.user_data["last_post"] = post
        keyboard = [
            [InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last"),
             InlineKeyboardButton("🔄 Переписать", callback_data=f"rewrite|{text}")],
            [InlineKeyboardButton("🎭 Другой формат", callback_data=f"format|{text}"),
             InlineKeyboardButton("✂️ Короче", callback_data=f"shorter|{text}")],
            [InlineKeyboardButton("📌 Добавить в план", callback_data=f"plan_this|{text}")],
        ]
        await msg.reply_text(post, reply_markup=InlineKeyboardMarkup(keyboard))
        return

    if waiting == "hook_topic":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text(f"🎯 Придумываю заголовки для «{text}»...")
        hooks = await ask_claude(
            f"7 цепляющих заголовков для поста на тему: {text}. Канал @kontentdesignn. "
            "Техники: вопрос, провокация, цифра, история, боль, любопытство, польза."
        )
        await msg.reply_text(hooks)
        return

    if waiting == "viral_topic":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text(f"🔥 Пишу вирусный пост на тему «{text}»...")
        post = await ask_claude(
            f"Вирусный пост для @kontentdesignn на тему: {text}. Мощный крючок, 2 варианта."
        )
        ctx.user_data["last_post"] = post
        keyboard = [[InlineKeyboardButton("📤 Опубликовать", callback_data="publish_last")]]
        await msg.reply_text(post, reply_markup=InlineKeyboardMarkup(keyboard))
        return

    if waiting == "design_question":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text("🎨 Думаю...")
        answer = await ask_claude(f"Вопрос по дизайну от Алёны: {text}\nДай конкретный практический совет.")
        await msg.reply_text(answer)
        return

    if waiting == "photo_question":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text("📸 Думаю...")
        answer = await ask_claude(f"Вопрос по фотографии от Алёны: {text}\nДай конкретный практический совет.")
        await msg.reply_text(answer)
        return

    if waiting == "letter_request":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text("✉️ Пишу письмо...")
        answer = await ask_claude(
            f"Напиши письмо/ответ клиенту для Алёны-дизайнера. Задача: {text}\n"
            "Тон: профессиональный, тёплый, без давления. Готовый текст который можно скопировать."
        )
        await msg.reply_text(answer)
        return

    if waiting == "price_question":
        ctx.user_data.pop("waiting_for", None)
        await msg.reply_text("💰 Думаю...")
        answer = await ask_claude(
            f"Вопрос по ценам/бизнесу от Алёны-дизайнера: {text}\nДай конкретный совет."
        )
        await msg.reply_text(answer)
        return

    if waiting == "plan_topic":
        ctx.user_data.pop("waiting_for", None)
        plan_date = ctx.user_data.pop("plan_date", date.today().strftime("%Y-%m-%d"))
        plan_time = ctx.user_data.pop("plan_time", "12:00")
        add_post_to_schedule(plan_date, plan_time, text)
        d = datetime.strptime(plan_date, "%Y-%m-%d")
        await msg.reply_text(
            f"✅ Добавлено в расписание!\n\n"
            f"📅 {d.strftime('%d.%m')} в {plan_time} — {text}\n\n"
            f"Посмотреть весь план: /my_plan"
        )
        return

    # Пересланное сообщение
    if msg.forward_date or msg.forward_from or msg.forward_from_chat:
        await msg.reply_text("🔍 Анализирую...")
        result = await ask_claude(
            f"Проанализируй пересланное сообщение:\n\n{text}\n\n"
            "Задачи, дедлайны, договорённости. Если подходит для поста — предложи идею."
        )
        await msg.reply_text(result)
        return

    # Обычный вопрос — универсальный ответ
    await msg.reply_text("💭 Думаю...")
    history = ctx.user_data.get("history", [])
    history.append({"role": "user", "content": text})
    if len(history) > 10:
        history = history[-10:]

    reply = await ask_claude_with_history(history)
    history.append({"role": "assistant", "content": reply})
    ctx.user_data["history"] = history

    if len(reply) > 150 and any(w in reply.lower() for w in ["пост", "#", "подписч", "канал", "аудитор"]):
        ctx.user_data["last_post"] = reply
        keyboard = [
            [InlineKeyboardButton("📤 Опубликовать в канал", callback_data="publish_last"),
             InlineKeyboardButton("📌 В план", callback_data="add_plan_start")],
        ]
        await msg.reply_text(reply, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await msg.reply_text(reply)


# ═══════════════════════════════════════════════════════════
# ЗАПУСК
# ═══════════════════════════════════════════════════════════

def main():
    app = Application.builder().token(BOT_TOKEN).build()

    # Команды контента
    app.add_handler(CommandHandler("start",     cmd_start))
    app.add_handler(CommandHandler("help",      cmd_help))
    app.add_handler(CommandHandler("post",      cmd_post))
    app.add_handler(CommandHandler("ideas",     cmd_ideas))
    app.add_handler(CommandHandler("strategy",  cmd_strategy))
    app.add_handler(CommandHandler("viral",     cmd_viral))
    app.add_handler(CommandHandler("sell",      cmd_sell))
    app.add_handler(CommandHandler("hook",      cmd_hook))
    app.add_handler(CommandHandler("publish",   cmd_publish))

    # Команды экспертизы
    app.add_handler(CommandHandler("design",    cmd_design))
    app.add_handler(CommandHandler("photo",     cmd_photo))
    app.add_handler(CommandHandler("letter",    cmd_letter))
    app.add_handler(CommandHandler("price",     cmd_price))

    # Планировщик
    app.add_handler(CommandHandler("my_plan",    cmd_my_plan))
    app.add_handler(CommandHandler("plan_today", cmd_plan_today))
    app.add_handler(CommandHandler("add_plan",   cmd_add_plan))

    app.add_handler(CallbackQueryHandler(on_button))
    app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, on_message))

    # Ежедневное напоминание в 9:00 UTC (12:00 МСК)
    job_queue = app.job_queue
    if job_queue:
        job_queue.run_daily(daily_reminder, time=datetime.strptime("09:00", "%H:%M").time())

    log.info("🚀 Макс запущен — SMM + Дизайн + Фото + Бизнес + Планировщик!")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
