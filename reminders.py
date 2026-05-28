"""
Система напоминаний для Алёны
Запускается по cron каждый день в 9:00
Когда Алёна напишет /start боту — автоматически находит её chat_id и начинает слать напоминания
"""

import json
import requests
import datetime
from pathlib import Path

BOT_TOKEN = "8872835678:AAGDEE3BjFu4DfXj9_pWZs6JjoTVTdOA3aI"
CHANNEL = "@kontentdesignn"
CONFIG_FILE = Path("/home/agent/projects/telegram-assistant/chat_ids.json")

# ── Контент-план июня ────────────────────────────────────
POSTS_JUNE = {
    1:  ("С+П", "День детей 🎈 — пост про детские мероприятия и афиши"),
    2:  ("К",   "Кейс: любая свежая работа — задача → результат"),
    3:  ("О",   "Почему у одних афиша продаёт, у других — нет (5 причин)"),
    4:  ("Л",   "Как я работаю с клиентом — от первого сообщения до файла"),
    5:  ("П",   "Выпускной сезон — последний шанс заказать без спешки"),
    6:  ("К",   "Кейс: реставрация фото — старое → восстановленное"),
    8:  ("О",   "Чек-лист: что прислать дизайнеру для крутого результата"),
    9:  ("К",   "Кейс: серия сторис для бизнеса"),
    10: ("П",   "Пакет «Старт для бизнеса» — что входит, цена, сроки"),
    11: ("О",   "Как выбрать цвет для афиши — шпаргалка"),
    12: ("С",   "День России 🇷🇺 — поздравление + кейс"),
    13: ("К",   "Кейс: меню для кафе или визуал для ресторана"),
    14: ("Л",   "Мой любимый тип заказов — честно"),
    15: ("П",   "Реставрация фото: верни память к жизни (от 300₽)"),
    16: ("О",   "Чем дизайнер отличается от «сделаю в Canva»"),
    17: ("К",   "Кейс: событийный пакет (арт-вечер, мастер-класс)"),
    18: ("Л",   "Самый необычный заказ — история"),
    19: ("О",   "Почему визуал важнее, чем ты думаешь: цифры"),
    20: ("П",   "Видео-поздравления и слайд-шоу — идеальный подарок"),
    21: ("С+П", "Лето — время событий. Ты уже с афишей?"),
    22: ("О",   "Как написать текст для афиши самому — 4 вопроса"),
    23: ("К",   "Кейс: упаковка для handmade мастера"),
    24: ("Л",   "Месяц канала — итоги и планы 🎉"),
    25: ("П",   "Акция «Июньский старт» — ограниченное предложение"),
    26: ("О",   "3 типа клиентов и что каждому нужно"),
    27: ("К",   "Кейс: логотип и фирменный стиль — процесс"),
    28: ("Л+П", "Июнь закрываю — что дальше"),
}


def load_chat_ids():
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {}


def save_chat_ids(data):
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def send_message(chat_id, text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    resp = requests.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    })
    return resp.json().get("ok", False)


def check_new_users():
    """Ищем новых пользователей написавших боту."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    resp = requests.get(url, params={"limit": 50}).json()

    ids = load_chat_ids()
    new_users = []

    for u in resp.get("result", []):
        msg = u.get("message", {})
        text = msg.get("text", "")
        chat = msg.get("chat", {})
        chat_id = str(chat.get("id", ""))
        name = chat.get("first_name", "")

        if chat_id and chat_id not in ids:
            ids[chat_id] = {"name": name, "registered": str(datetime.date.today())}
            new_users.append((chat_id, name))

    if new_users:
        save_chat_ids(ids)
        for chat_id, name in new_users:
            send_message(chat_id,
                f"Привет, {name}! 👋\n\n"
                f"Я буду напоминать тебе о постах для канала каждое утро в 9:00.\n"
                f"И помогу с контентом — просто напиши что нужно 💜"
            )

    return ids


def send_daily_reminder():
    """Утреннее напоминание о посте."""
    ids = check_new_users()
    if not ids:
        print("Нет подписчиков для напоминаний")
        return

    today = datetime.date.today()
    day = today.day
    month = today.month

    if month == 6 and day in POSTS_JUNE:
        post_type, topic = POSTS_JUNE[day]
        msg = (
            f"☀️ Доброе утро, Алёна!\n\n"
            f"Сегодня {today.strftime('%d %B')} — день поста:\n\n"
            f"<b>[{post_type}] {topic}</b>\n\n"
            f"Напиши мне тему — помогу написать текст 💜"
        )
    else:
        msg = (
            f"☀️ Доброе утро!\n\n"
            f"Не забудь про пост сегодня 📝\n"
            f"Напиши мне тему — помогу написать 💜"
        )

    for chat_id in ids:
        ok = send_message(chat_id, msg)
        name = ids[chat_id].get("name", "")
        print(f"Напоминание → {name} ({chat_id}): {'✅' if ok else '❌'}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        # Только проверяем новых пользователей
        ids = check_new_users()
        print(f"Зарегистрировано: {len(ids)} пользователей")
    else:
        # Отправляем утреннее напоминание
        send_daily_reminder()
