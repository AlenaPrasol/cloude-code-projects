'use strict';
const TelegramBot        = require('node-telegram-bot-api');
const Anthropic          = require('@anthropic-ai/sdk');
const fs                 = require('fs');
const path               = require('path');
const https              = require('https');
const { toCanonical, toGenitive } = require('./names');

// ─── ТОКЕН И КЛИЕНТЫ ────────────────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN || '8410719025:AAHj4wrCJrGDllMKpC8sVc4V_fL_qwnwlNs';
const bot   = new TelegramBot(TOKEN, { polling: true });
let anthropic = null;

// ─── ФАЙЛЫ ──────────────────────────────────────────────────────────────────
const CONFIG_FILE   = path.join(__dirname, 'config.json');
const SCHEDULE_FILE = path.join(__dirname, 'schedule.json');
const NOTES_FILE    = path.join(__dirname, 'notes.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json');
const KEY_FILE      = path.join(__dirname, '.env_key');

// ─── КОНСТАНТЫ ХРАМА ────────────────────────────────────────────────────────
const CHURCH       = 'Храм свв. равноапп. Кирилла и Мефодия в Дегунине, г. Москва';
const CHURCH_SHORT = 'Храм свв. равноапп.\nКирилла и Мефодия\nв Дегунине, г. Москва';
const PHONE        = '+7 (924) 174-45-92';
const EMAIL        = 'hram_bazovskaya@mail.ru';
const COPYRIGHT    = '© Религиозная организация «Подворье Патриарха Московского и Всея Руси при Храме Святых Равноапостольных Кирилла и Мефодия учителей словенских в Дегунине г. Москвы Русской Православной Церкви (Московский Патриархат)» Москва 2024';
const CROSS_PATH   = 'M153,34v60H93V147h60v59H34v54H153V430.5L97,404v54l56 27V598h59V513l56,27V485L212,458V260H331V206H212V147H272V93H212V34z';

// ─── КОНФИГ ─────────────────────────────────────────────────────────────────
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
    return { adminIds: [], channelId: '', password: 'Дегунино2025' };
}
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
function isAdmin(id)   { return loadConfig().adminIds.includes(String(id)); }

// ─── ХРАНИЛИЩЕ ──────────────────────────────────────────────────────────────
function load(file)       { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function loadSchedule()   { try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); } catch { return { month: '', days: [] }; } }
function saveSchedule(s)  { fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(s, null, 2)); }

// ─── СОСТОЯНИЯ ПОЛЬЗОВАТЕЛЕЙ ─────────────────────────────────────────────────
const states = {};
function getState(id)              { return states[id] || { step: 'NONE', data: {} }; }
function setState(id, step, data)  { states[id] = { step, data: data || {} }; }
function clearState(id)            { delete states[id]; }

// ─── СОСТОЯНИЯ ВВОДА РАСПИСАНИЯ (ADMIN) ──────────────────────────────────────
const scheduleInput = {}; // adminId → { month, days }

// ─── SVG КРЕСТ ───────────────────────────────────────────────────────────────
function svgCross(w, h, gid, fid) {
    return `<svg viewBox="0 0 365 648" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="${gid}" x1="20%" y1="0%" x2="80%" y2="100%">
                <stop offset="0%" stop-color="#edd458"/>
                <stop offset="30%" stop-color="#c9a020"/>
                <stop offset="65%" stop-color="#8B6508"/>
                <stop offset="100%" stop-color="#d0aa38"/>
            </linearGradient>
            <filter id="${fid}"><feDropShadow dx="2" dy="3" stdDeviation="4" flood-color="rgba(0,0,0,0.38)"/></filter>
        </defs>
        <path fill="url(#${gid})" filter="url(#${fid})" d="${CROSS_PATH}"/>
    </svg>`;
}

// ─── ПАРСИНГ ДНЯ РАСПИСАНИЯ ──────────────────────────────────────────────────
function parseDay(line) {
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const m = parts[0].match(/^(\d{1,2})\s+(\S+)\s+(\S+)(.*)?$/);
    if (!m) return null;
    const num = m[1], month = m[2], dowRaw = m[3].toLowerCase(), flags = (m[4]||'').toUpperCase();
    const isFeast = flags.includes('ПРАЗДНИК'), isSpec = flags.includes('ОСОБЫЙ');
    const dowMap = {пн:'Понедельник',вт:'Вторник',ср:'Среда',чт:'Четверг',пт:'Пятница',сб:'Суббота',вс:'Воскресенье'};
    const dayOfWeek = dowMap[dowRaw] || dowRaw;
    let type = isFeast ? 'feast' : isSpec ? 'special' : dowRaw==='вс' ? 'sunday' : dowRaw==='сб' ? 'saturday' : 'weekday';
    const rem = parts.slice(1);
    let feastName = '', saintsIdx = 0;
    if (isFeast && rem.length && rem[0] === rem[0].toUpperCase() && rem[0].length > 2) { feastName = rem[0]; saintsIdx = 1; }
    const saints = rem[saintsIdx] || '';
    const services = [];
    for (let i = saintsIdx + 1; i < rem.length; i++) {
        const sm = rem[i].match(/^(\d{1,2}[:.]\d{2})\s+(.+)$/);
        if (sm) services.push({ time: sm[1].replace('.', ':'), desc: sm[2] });
        else if (rem[i]) services.push({ time: '', desc: rem[i] });
    }
    return { num, month, dayOfWeek, type, feastName, saints, services };
}

// ─── HTML РАСПИСАНИЯ ─────────────────────────────────────────────────────────
function rowClass(type) {
    return {feast:'great-feast',special:'special',sunday:'sunday',saturday:'saturday',weekday:'weekday'}[type]||'weekday';
}

function generateRows(days) {
    if (!days.length) return '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">Расписание не загружено</td></tr>';
    return days.map(d => {
        const cls = rowClass(d.type);
        const saintsCell = [
            d.feastName ? `<span class="feast-name">${d.feastName}</span>` : '',
            d.saints    ? `<span class="saints-text">${d.saints}</span>` : ''
        ].filter(Boolean).join('');
        const svcs = d.services.length ? d.services : [{ time:'', desc:'' }];
        let rows = `<tr class="${cls}">
            <td class="col-day" rowspan="${svcs.length}"><span class="day-name">${d.dayOfWeek}</span><span class="day-date">${d.num} ${d.month}</span></td>
            <td class="col-saints" rowspan="${svcs.length}">${saintsCell}</td>
            <td class="col-time">${svcs[0].time}</td>
            <td class="col-service">${svcs[0].desc}</td></tr>`;
        for (let i = 1; i < svcs.length; i++)
            rows += `<tr class="${cls}"><td class="col-time">${svcs[i].time}</td><td class="col-service">${svcs[i].desc}</td></tr>`;
        return rows;
    }).join('\n');
}

function generateScheduleHTML(schedule) {
    const rows  = generateRows(schedule.days || []);
    const month = schedule.month || 'Расписание богослужений';
    return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Расписание — Храм Кирилла и Мефодия, Дегунино</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#c8a45a;font-family:Georgia,'Times New Roman',serif;display:flex;justify-content:center;padding:20px;min-height:100vh}
.page{background:#f5e6c0;width:860px;max-width:100%;border:5px solid #8B6914;box-shadow:0 0 40px rgba(0,0,0,.5)}
.inner{border:2px solid #c9a84c;margin:8px;padding:24px 20px 20px}
.header{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
.photo-box{width:150px;min-width:150px;height:175px;border:3px solid #8B6914;border-radius:50% 50% 8px 8px/55% 55% 8px 8px;overflow:hidden;background:#e0c88a}
.photo-box img{width:100%;height:100%;object-fit:cover;object-position:center top;display:block}
.header-center{flex:1;text-align:center;padding-top:4px}
.cross-top{line-height:1;margin-bottom:10px;display:flex;justify-content:center}
.church-name{font-size:26px;font-weight:bold;color:#2c1400;line-height:1.35;margin-bottom:10px}
.month-label{font-size:17px;color:#8B1A1A;font-style:italic;margin-bottom:4px}
.year-label{font-size:14px;color:#6b4c00}
.deco-right{width:130px;min-width:130px;text-align:center;padding-top:6px;display:flex;align-items:flex-start;justify-content:center}
.divider{display:flex;align-items:center;gap:10px;margin:14px 0;color:#8B6914}
.divider::before,.divider::after{content:'';flex:1;height:2px;background:linear-gradient(to right,transparent,#c9a84c,transparent)}
.schedule{width:100%;border-collapse:collapse;font-size:14px}
.schedule td{border:1px solid #dcc97a;padding:7px 8px;vertical-align:top}
.col-day{width:115px;min-width:115px}.col-saints{width:38%}
.col-time{width:60px;text-align:center;font-weight:bold;color:#5a3800;white-space:nowrap}
.day-name{display:block;font-weight:bold;color:#2c1400;font-size:13px}
.day-date{display:block;color:#888;font-size:12px;margin-top:2px}
.feast-name{display:block;font-weight:bold;color:#8B1A1A;margin-bottom:3px}
.saints-text{display:block;font-style:italic;color:#4a2e00;line-height:1.4}
tr.weekday{background:#fdf6e0}tr.saturday{background:#f7edd0}tr.sunday{background:#fff4c8}
tr.sunday .day-name,tr.sunday .saints-text,tr.sunday .col-time{color:#8B1A1A}
tr.great-feast{background:#ffe4b0}
tr.great-feast .day-name,tr.great-feast .saints-text,tr.great-feast .col-time,tr.great-feast .col-service{color:#8B1A1A;font-weight:bold}
tr.special{background:#fff0d8}tr.special .saints-text{color:#8B1A1A}
.footer-section{margin-top:20px;border-top:2px solid #c9a84c;padding-top:12px;text-align:center}
.contacts{font-size:13px;color:#5a3800;line-height:2;margin-bottom:10px}
.copyright{font-size:10px;color:#999;line-height:1.6}
@media(max-width:600px){.church-name{font-size:18px}.photo-box,.deco-right{display:none}}
</style></head><body>
<div class="page"><div class="inner">
<div class="header">
    <div class="photo-box"><img src="church1.jpg" alt="Храм" onerror="this.parentElement.style.background='#e0c88a'"></div>
    <div class="header-center">
        <div class="cross-top">${svgCross(38,68,'gs','fs')}</div>
        <div class="church-name">${CHURCH_SHORT.replace(/\n/g,'<br>')}</div>
        <div class="month-label">Расписание богослужений</div>
        <div class="year-label">${month}</div>
    </div>
    <div class="deco-right">${svgCross(62,110,'gb','fb')}</div>
</div>
<div class="divider"><span>☩</span></div>
<table class="schedule">${rows}</table>
<div class="footer-section">
    <div class="contacts">☎ ${PHONE} &nbsp;|&nbsp; ✉ ${EMAIL}</div>
    <div class="copyright">${COPYRIGHT}</div>
</div>
</div></div></body></html>`;
}

// ─── КЛАВИАТУРЫ ─────────────────────────────────────────────────────────────
const KB_MAIN_USER = {
    reply_markup: {
        keyboard: [
            ['📝 Подать записку', '⛪ Заказать требу'],
            ['📅 Расписание',     'ℹ️ О храме'],
        ],
        resize_keyboard: true
    }
};

const KB_MAIN_ADMIN = {
    reply_markup: {
        keyboard: [
            ['📋 Новое расписание', '📄 HTML расписания'],
            ['📝 Записки',          '📋 Требы'],
            ['📢 Объявление',       '⚙️ Настройки'],
        ],
        resize_keyboard: true
    }
};

function inlineKb(buttons) {
    return { reply_markup: { inline_keyboard: buttons } };
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ─────────────────────────────────────────────────
function downloadBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function processNames(raw) {
    return raw.split('\n')
        .map(n => n.trim()).filter(Boolean)
        .map(n => {
            const canonical = toCanonical(n);
            const gen       = toGenitive(canonical);
            const changed   = canonical.toLowerCase() !== n.toLowerCase();
            return { original: n, canonical, gen, changed };
        });
}

function formatNamesForPriest(names, type) {
    const label = type === 'health' ? '🙏 О здравии' : '✝️ Об упокоении';
    const list  = names.map(n => n.changed ? `${n.gen} (было: ${n.original})` : n.gen).join('\n');
    return `${label}:\n${list}`;
}

async function notifyAdmins(text, opts) {
    const cfg = loadConfig();
    for (const id of cfg.adminIds) {
        await bot.sendMessage(id, text, opts || {}).catch(() => {});
    }
}

async function postToChannel(text, opts) {
    const cfg = loadConfig();
    if (!cfg.channelId) return false;
    await bot.sendMessage(cfg.channelId, text, opts || {});
    return true;
}

// ─── РАЗБОР РАСПИСАНИЯ ЧЕРЕЗ CLAUDE ──────────────────────────────────────────
async function parseScheduleWithClaude(textOrImage) {
    if (!anthropic) return null;
    const prompt = `Это расписание богослужений православного храма. Текст может содержать OCR-ошибки (c6=сб, BC=вс, MaR=мая, латинские вместо русских). Исправляй ошибки.
Верни ТОЛЬКО строки в формате (одна строка = один день):
[число] [месяц] [день_нед] | [святые] | [время] [служба] | [время] [служба]
Праздник: [число] [месяц] [день_нед] ПРАЗДНИК | [НАЗВАНИЕ] | [святые] | [время] [служба]
Дни: пн вт ср чт пт сб вс. Без пояснений.`;

    let content;
    if (typeof textOrImage === 'string') {
        content = [{ type:'text', text: prompt + '\n\nТекст:\n' + textOrImage }];
    } else {
        content = [
            { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: textOrImage.toString('base64') } },
            { type:'text',  text: prompt }
        ];
    }
    const resp = await anthropic.messages.create({ model:'claude-sonnet-4-6', max_tokens:2048, messages:[{ role:'user', content }] });
    return resp.content[0].text.trim().split('\n').map(l => l.trim()).filter(Boolean);
}

// ════════════════════════════════════════════════════════════
//  КОМАНДЫ
// ════════════════════════════════════════════════════════════

// ─── /start ─────────────────────────────────────────────────────────────────
bot.onText(/\/start/, msg => {
    const id   = msg.chat.id;
    const name = msg.from.first_name || 'Добрый человек';
    clearState(id);
    if (isAdmin(id)) {
        bot.sendMessage(id,
            `✝ Добро пожаловать, батюшка!\n\nВы вошли как *администратор*.\nВыберите действие на клавиатуре ниже:`,
            { parse_mode:'Markdown', ...KB_MAIN_ADMIN });
    } else {
        bot.sendMessage(id,
            `✝ Добро пожаловать, ${name}!\n\n*${CHURCH}*\n\nЧем могу помочь?`,
            { parse_mode:'Markdown', ...KB_MAIN_USER });
    }
});

// ─── /admin ─────────────────────────────────────────────────────────────────
bot.onText(/\/admin(?:\s+(.+))?/, (msg, match) => {
    const id  = msg.chat.id;
    const pwd = (match[1] || '').trim();
    if (isAdmin(id)) { bot.sendMessage(id, '✅ Вы уже администратор.'); return; }
    const cfg = loadConfig();
    if (pwd === cfg.password) {
        cfg.adminIds.push(String(id));
        saveConfig(cfg);
        bot.sendMessage(id, '✅ Вы стали администратором!', KB_MAIN_ADMIN);
    } else {
        bot.sendMessage(id, '❌ Неверный пароль.\nИспользуйте: `/admin ПАРОЛЬ`', { parse_mode:'Markdown' });
    }
});

// ─── /get_id ─────────────────────────────────────────────────────────────────
bot.onText(/\/get_id/, msg => {
    bot.sendMessage(msg.chat.id, `Ваш Telegram ID: \`${msg.chat.id}\``, { parse_mode:'Markdown' });
});

// ─── /api_key ────────────────────────────────────────────────────────────────
bot.onText(/\/api_key (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const key = match[1].trim();
    if (!key.startsWith('sk-ant-')) { bot.sendMessage(msg.chat.id, '❌ Ключ должен начинаться с sk-ant-'); return; }
    fs.writeFileSync(KEY_FILE, key);
    anthropic = new Anthropic({ apiKey: key });
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    bot.sendMessage(msg.chat.id, '✅ API ключ сохранён! Теперь можно отправлять фото расписания.');
});

// ─── /set_channel ────────────────────────────────────────────────────────────
bot.onText(/\/set_channel (.+)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const cfg = loadConfig();
    cfg.channelId = match[1].trim();
    saveConfig(cfg);
    bot.sendMessage(msg.chat.id, `✅ Канал для публикаций: ${cfg.channelId}`);
});

// ─── /помощь ─────────────────────────────────────────────────────────────────
bot.onText(/\/помощь|\/help/, msg => {
    const admin = isAdmin(msg.chat.id);
    if (admin) {
        bot.sendMessage(msg.chat.id,
`*Команды администратора:*

📋 *Расписание:*
/новый\\_месяц Май 2025 — начать ввод
/готово — сохранить
/html\\_месяц — получить HTML файл
/статус — info о расписании

📝 *Записки и требы:*
/записки — список поданных записок
/требы — список заявок на требы

📢 *Публикации:*
/анонс — создать объявление для канала
/святой — святой сегодняшнего дня

⚙️ *Настройки:*
/set\\_channel @имя — задать канал
/api\\_key sk-ant-... — API ключ Claude
/get\\_id — узнать свой Telegram ID`,
            { parse_mode:'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id,
`*Что умеет этот бот:*

📝 *Подать записку* — о здравии или об упокоении
⛪ *Заказать требу* — крещение, венчание, панихида и др.
📅 *Расписание* — богослужения на текущий месяц
ℹ️ *О храме* — адрес, телефон, email`,
            { parse_mode:'Markdown' });
    }
});

// ════════════════════════════════════════════════════════════
//  ЗАПИСКИ (для прихожан)
// ════════════════════════════════════════════════════════════

function startNotes(chatId) {
    setState(chatId, 'NOTE_TYPE', {});
    bot.sendMessage(chatId, '📝 *Подать записку*\n\nКакую записку хотите подать?',
        { parse_mode:'Markdown', ...inlineKb([
            [{ text:'🙏 О здравии',    callback_data:'note_health' }],
            [{ text:'✝️ Об упокоении', callback_data:'note_repose' }],
            [{ text:'❌ Отмена',        callback_data:'cancel' }]
        ])});
}

// ════════════════════════════════════════════════════════════
//  ТРЕБЫ (для прихожан)
// ════════════════════════════════════════════════════════════

const TREBA_TYPES = {
    'treba_baptism':  '💧 Крещение',
    'treba_wedding':  '💍 Венчание',
    'treba_panihida': '🕯️ Панихида',
    'treba_moleben':  '🙏 Молебен',
    'treba_funeral':  '✝️ Отпевание',
    'treba_sobor':    '🕯️ Соборование',
    'treba_confess':  '📖 Исповедь',
};

function startTreba(chatId) {
    setState(chatId, 'TREBA_TYPE', {});
    bot.sendMessage(chatId, '⛪ *Заказать требу*\n\nВыберите вид требы:',
        { parse_mode:'Markdown', ...inlineKb([
            [{ text:'💧 Крещение',    callback_data:'treba_baptism'  },
             { text:'💍 Венчание',    callback_data:'treba_wedding'  }],
            [{ text:'🕯️ Панихида',   callback_data:'treba_panihida' },
             { text:'🙏 Молебен',    callback_data:'treba_moleben'  }],
            [{ text:'✝️ Отпевание',  callback_data:'treba_funeral'  },
             { text:'🕯️ Соборование',callback_data:'treba_sobor'   }],
            [{ text:'📖 Исповедь',   callback_data:'treba_confess'  }],
            [{ text:'❌ Отмена',      callback_data:'cancel'         }]
        ])});
}

// ════════════════════════════════════════════════════════════
//  РАСПИСАНИЕ — КОМАНДЫ ADMIN
// ════════════════════════════════════════════════════════════

bot.onText(/\/новый_месяц(.*)/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const month = (match[1]||'').trim();
    scheduleInput[msg.chat.id] = { month, days: [] };
    clearState(msg.chat.id);
    bot.sendMessage(msg.chat.id,
        `📅 Расписание${month ? ': *'+month+'*':''}\n\n*Три способа добавить дни:*\n\n📷 Отправьте фото расписания\n📋 Вставьте текст в любом виде\n✏️ Строгий формат: \`1 мая пн | Прп. Иоанна | 8:40 Литургия | 17:00 Вечерня\`\n\nКогда закончите — /готово`,
        { parse_mode:'Markdown' });
});

bot.onText(/\/готово/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) return;
    const inp = scheduleInput[id];
    if (!inp) { bot.sendMessage(id, 'Сначала: /новый_месяц'); return; }
    saveSchedule({ month: inp.month, days: inp.days });
    delete scheduleInput[id];
    bot.sendMessage(id,
        `✅ Расписание сохранено! Дней: *${inp.days.length}*\n\n/html\\_месяц — получить HTML\n/карточки — сгенерировать карточки`,
        { parse_mode:'Markdown' });
});

bot.onText(/\/html_месяц/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const s = loadSchedule();
    if (!s.days.length) { bot.sendMessage(msg.chat.id, 'Расписание пустое. Начните с /новый_месяц'); return; }
    const html = generateScheduleHTML(s);
    const file = path.join(__dirname, 'schedule_out.html');
    fs.writeFileSync(file, html);
    await bot.sendDocument(msg.chat.id, file, { caption:`📄 *${s.month}* готово!`, parse_mode:'Markdown' });
});

bot.onText(/\/статус/, msg => {
    if (!isAdmin(msg.chat.id)) return;
    const s = loadSchedule();
    if (!s.days.length) { bot.sendMessage(msg.chat.id, 'Расписание пустое.'); return; }
    bot.sendMessage(msg.chat.id,
        `📋 *${s.month}*\nДней: ${s.days.length}\nПервый: ${s.days[0].num} ${s.days[0].month}\nПоследний: ${s.days[s.days.length-1].num} ${s.days[s.days.length-1].month}`,
        { parse_mode:'Markdown' });
});

// ─── /записки (admin — посмотреть) ──────────────────────────────────────────
bot.onText(/\/записки/, msg => {
    if (!isAdmin(msg.chat.id)) return;
    const notes = load(NOTES_FILE);
    if (!notes.length) { bot.sendMessage(msg.chat.id, '📝 Записок пока нет.'); return; }
    // Показываем последние 20
    const recent = notes.slice(-20).reverse();
    let text = `📝 *Записки (последние ${recent.length}):*\n\n`;
    recent.forEach((n, i) => {
        const dt = new Date(n.date).toLocaleString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        text += `*${i+1}. ${dt}* — от ${n.from}\n${n.type === 'health' ? '🙏 О здравии' : '✝️ Об упокоении'}:\n${n.names.join(', ')}\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode:'Markdown' });
});

// ─── /требы (admin — посмотреть) ─────────────────────────────────────────────
bot.onText(/\/требы/, msg => {
    if (!isAdmin(msg.chat.id)) return;
    const reqs = load(REQUESTS_FILE);
    if (!reqs.length) { bot.sendMessage(msg.chat.id, '📋 Заявок на требы пока нет.'); return; }
    const recent = reqs.slice(-10).reverse();
    let text = `📋 *Требы (последние ${recent.length}):*\n\n`;
    recent.forEach((r, i) => {
        const dt = new Date(r.date).toLocaleString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        text += `*${i+1}. ${dt}*\n${r.trebaType}\nИмена: ${r.names}\nДата: ${r.preferredDate || 'не указана'}\nТел: ${r.phone || 'не указан'}\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode:'Markdown' });
});

// ─── /анонс ──────────────────────────────────────────────────────────────────
bot.onText(/\/анонс(.*)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const text = (match[1]||'').trim();
    if (!text) {
        setState(msg.chat.id, 'ANNOUNCEMENT', {});
        bot.sendMessage(msg.chat.id, '📢 Напишите текст объявления для публикации в канале:');
        return;
    }
    await sendAnnouncement(msg.chat.id, text);
});

async function sendAnnouncement(adminId, text) {
    const cfg = loadConfig();
    const msg = `✝ *${CHURCH}*\n\n${text}\n\n☎ ${PHONE}`;
    if (cfg.channelId) {
        await bot.sendMessage(cfg.channelId, msg, { parse_mode:'Markdown' }).catch(e => {
            bot.sendMessage(adminId, `⚠️ Не удалось отправить в канал: ${e.message}`);
        });
        bot.sendMessage(adminId, '✅ Объявление отправлено в канал!');
    } else {
        bot.sendMessage(adminId, `⚠️ Канал не задан. Используйте /set_channel @имя_канала\n\nТекст объявления:\n${msg}`);
    }
}

// ─── /святой ─────────────────────────────────────────────────────────────────
bot.onText(/\/святой/, async msg => {
    const today = new Date();
    const day   = today.getDate();
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const monthName = months[today.getMonth()];

    // Ищем в расписании
    const s = loadSchedule();
    const todayEntry = s.days.find(d => String(d.num) === String(day) && d.month === monthName);

    if (todayEntry) {
        const feast  = todayEntry.feastName ? `🎉 *${todayEntry.feastName}*\n` : '';
        const saints = todayEntry.saints ? `👼 ${todayEntry.saints}` : '';
        bot.sendMessage(msg.chat.id, `📅 *${day} ${monthName}* — ${todayEntry.dayOfWeek}\n\n${feast}${saints}`, { parse_mode:'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, `📅 *${day} ${monthName}*\n\nДля отображения святого загрузите расписание на текущий месяц командой /новый_месяц.`, { parse_mode:'Markdown' });
    }
});

// ─── Показать расписание пользователю ────────────────────────────────────────
function showSchedule(chatId) {
    const s = loadSchedule();
    if (!s.days.length) {
        bot.sendMessage(chatId, `📅 Расписание пока не загружено.\n\nПозвоните нам: ${PHONE}`);
        return;
    }
    const today = new Date().getDate();
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const monthName = months[new Date().getMonth()];

    // Ближайшие 7 дней
    const upcoming = s.days.filter(d => Number(d.num) >= today).slice(0, 7);
    if (!upcoming.length) {
        bot.sendMessage(chatId, `📅 *${s.month}*\n\nБогослужений в ближайшие дни нет.\n\n☎ ${PHONE}`, { parse_mode:'Markdown' });
        return;
    }
    let text = `📅 *Расписание — ${s.month}*\n\n`;
    upcoming.forEach(d => {
        const feast  = d.feastName ? ` — *${d.feastName}*` : '';
        const saints = d.saints ? `\n   _${d.saints}_` : '';
        const svcs   = d.services.map(s => `   ${s.time} ${s.desc}`).join('\n');
        text += `*${d.num} ${d.month}*, ${d.dayOfWeek}${feast}${saints}\n${svcs}\n\n`;
    });
    bot.sendMessage(chatId, text.trim(), { parse_mode:'Markdown' });
}

// ─── О ХРАМЕ ──────────────────────────────────────────────────────────────────
function showAbout(chatId) {
    bot.sendMessage(chatId,
        `🕍 *${CHURCH}*\n\n📍 Москва, район Дегунино\n☎ ${PHONE}\n✉ ${EMAIL}\n\nРасписание богослужений доступно по кнопке «📅 Расписание»`,
        { parse_mode:'Markdown' });
}

// ════════════════════════════════════════════════════════════
//  ОБРАБОТЧИК ФОТО
// ════════════════════════════════════════════════════════════

bot.on('photo', async msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) { bot.sendMessage(id, 'Фотографии может отправлять только администратор.'); return; }
    if (!anthropic)   { bot.sendMessage(id, '❌ API ключ не задан. Используйте /api_key sk-ant-...'); return; }
    if (!scheduleInput[id]) { bot.sendMessage(id, '⚠️ Сначала начните ввод расписания: /новый_месяц'); return; }

    const status = await bot.sendMessage(id, '🔍 Распознаю расписание с фото...');
    try {
        const photo  = msg.photo[msg.photo.length - 1];
        const file   = await bot.getFile(photo.file_id);
        const imgBuf = await downloadBuffer(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
        const lines  = await parseScheduleWithClaude(imgBuf);
        await bot.deleteMessage(id, status.message_id).catch(()=>{});
        if (!lines) { bot.sendMessage(id, '❌ Ошибка распознавания.'); return; }
        const newDays = lines.map(l => parseDay(l)).filter(Boolean);
        if (!newDays.length) { bot.sendMessage(id, '❌ Не удалось разобрать расписание. Попробуйте другое фото.'); return; }
        scheduleInput[id].days.push(...newDays);
        const preview = newDays.slice(0,5).map(d => `✓ ${d.num} ${d.month} (${d.dayOfWeek})`).join('\n');
        bot.sendMessage(id,
            `✅ Добавлено *${newDays.length} дней*\n\n${preview}${newDays.length>5?`\n...и ещё ${newDays.length-5}`:''}\n\nВсего: ${scheduleInput[id].days.length}\n\nЕщё фото или /готово`,
            { parse_mode:'Markdown' });
    } catch(e) {
        await bot.deleteMessage(id, status.message_id).catch(()=>{});
        bot.sendMessage(id, `❌ Ошибка: ${e.message}`);
    }
});

// ════════════════════════════════════════════════════════════
//  ОБРАБОТЧИК INLINE КНОПОК
// ════════════════════════════════════════════════════════════

bot.on('callback_query', async query => {
    const id   = query.message.chat.id;
    const data = query.data;
    await bot.answerCallbackQuery(query.id);

    if (data === 'cancel') {
        clearState(id);
        const kb = isAdmin(id) ? KB_MAIN_ADMIN : KB_MAIN_USER;
        bot.sendMessage(id, '❌ Отменено.', kb);
        return;
    }

    // Выбор типа записки
    if (data === 'note_health' || data === 'note_repose') {
        setState(id, 'NOTE_NAMES', { type: data === 'note_health' ? 'health' : 'repose' });
        const label = data === 'note_health' ? 'о здравии' : 'об упокоении';
        bot.sendMessage(id, `✏️ Введите имена *${label}* — каждое имя на новой строке:\n\n_Пример:_\nИван\nМария\nБабушка Нина`, { parse_mode:'Markdown' });
        return;
    }

    // Подтверждение записки
    if (data === 'note_confirm') {
        const st    = getState(id);
        const notes = load(NOTES_FILE);
        notes.push({ date: new Date().toISOString(), from: String(id), type: st.data.type, names: st.data.processed.map(n => n.gen) });
        save(NOTES_FILE, notes);
        clearState(id);
        const label = st.data.type === 'health' ? 'о здравии' : 'об упокоении';
        bot.sendMessage(id, `✅ Записка *${label}* подана!\n\nСпаси вас Господь! 🙏`, { parse_mode:'Markdown', ...KB_MAIN_USER });
        await notifyAdmins(`📝 Новая записка!\n\n${formatNamesForPriest(st.data.processed, st.data.type)}`);
        return;
    }

    // Выбор типа требы
    if (data.startsWith('treba_')) {
        const trebaType = TREBA_TYPES[data] || data;
        setState(id, 'TREBA_NAMES', { trebaType });
        bot.sendMessage(id, `*${trebaType}*\n\nВведите имена (на ком/за кого совершается треба):`, { parse_mode:'Markdown' });
        return;
    }

    // Подтверждение требы
    if (data === 'treba_confirm') {
        const st   = getState(id);
        const reqs = load(REQUESTS_FILE);
        reqs.push({ date: new Date().toISOString(), from: String(id), ...st.data });
        save(REQUESTS_FILE, reqs);
        clearState(id);
        bot.sendMessage(id,
            `✅ Заявка принята!\n\n*${st.data.trebaType}*\nИмена: ${st.data.names}\nДата: ${st.data.preferredDate || 'не указана'}\nТел: ${st.data.phone || 'не указан'}\n\nСвяжемся с вами. 🙏`,
            { parse_mode:'Markdown', ...KB_MAIN_USER });
        await notifyAdmins(
            `📋 Новая заявка на требу!\n\n${st.data.trebaType}\nИмена: ${st.data.names}\nДата: ${st.data.preferredDate || '—'}\nТел: ${st.data.phone || '—'}\nОт: tg://user?id=${id}`);
        return;
    }
});

// ════════════════════════════════════════════════════════════
//  ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ
// ════════════════════════════════════════════════════════════

bot.on('message', async msg => {
    const id   = msg.chat.id;
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return;

    // ── Кнопки главного меню пользователя ──
    if (text === '📝 Подать записку')   { startNotes(id); return; }
    if (text === '⛪ Заказать требу')    { startTreba(id); return; }
    if (text === '📅 Расписание')        { showSchedule(id); return; }
    if (text === 'ℹ️ О храме')          { showAbout(id); return; }

    // ── Кнопки главного меню admin ──
    if (isAdmin(id)) {
        if (text === '📋 Новое расписание') { bot.sendMessage(id, 'Используйте /новый_месяц Май 2025'); return; }
        if (text === '📄 HTML расписания')  { bot.emit('text', { ...msg, text:'/html_месяц' }); return; }
        if (text === '📝 Записки')          { bot.emit('text', { ...msg, text:'/записки' }); return; }
        if (text === '📋 Требы')            { bot.emit('text', { ...msg, text:'/требы' }); return; }
        if (text === '⚙️ Настройки')       { bot.sendMessage(id, `*Настройки:*\n/set_channel @канал\n/api_key sk-ant-...\n/get_id`, { parse_mode:'Markdown' }); return; }
        if (text === '📢 Объявление')       { setState(id, 'ANNOUNCEMENT', {}); bot.sendMessage(id, '📢 Напишите текст объявления:'); return; }
    }

    const st = getState(id);

    // ── Состояния прихожанина ──

    if (st.step === 'NOTE_NAMES') {
        const processed = processNames(text);
        if (!processed.length) { bot.sendMessage(id, '⚠️ Введите хотя бы одно имя.'); return; }
        setState(id, 'NOTE_CONFIRM', { ...st.data, processed });
        const label = st.data.type === 'health' ? '🙏 О здравии' : '✝️ Об упокоении';
        const names = processed.map(n => n.changed ? `${n.gen} _(было: ${n.original})_` : n.gen).join('\n');
        bot.sendMessage(id,
            `*${label}:*\n${names}\n\nВсё верно?`,
            { parse_mode:'Markdown', ...inlineKb([
                [{ text:'✅ Подтвердить', callback_data:'note_confirm' }],
                [{ text:'❌ Отменить',    callback_data:'cancel' }]
            ])});
        return;
    }

    if (st.step === 'TREBA_NAMES') {
        setState(id, 'TREBA_DATE', { ...st.data, names: text });
        bot.sendMessage(id, '📅 Укажите желаемую дату (или напишите «любая»):');
        return;
    }

    if (st.step === 'TREBA_DATE') {
        setState(id, 'TREBA_PHONE', { ...st.data, preferredDate: text });
        bot.sendMessage(id, '📱 Укажите номер телефона для связи (или напишите «нет»):');
        return;
    }

    if (st.step === 'TREBA_PHONE') {
        const data = { ...st.data, phone: text === 'нет' ? '' : text };
        setState(id, 'TREBA_CONFIRM', data);
        bot.sendMessage(id,
            `*${data.trebaType}*\nИмена: ${data.names}\nДата: ${data.preferredDate}\nТел: ${data.phone || '—'}\n\nПодтверждаете?`,
            { parse_mode:'Markdown', ...inlineKb([
                [{ text:'✅ Подтвердить', callback_data:'treba_confirm' }],
                [{ text:'❌ Отменить',    callback_data:'cancel' }]
            ])});
        return;
    }

    // ── Состояния администратора ──

    if (st.step === 'ANNOUNCEMENT') {
        clearState(id);
        await sendAnnouncement(id, text);
        return;
    }

    if (scheduleInput[id]) {
        const isMultiline = text.includes('\n');
        const hasPipes    = text.includes('|');

        // Одна строка с палочками — быстрый парсинг
        if (!isMultiline && hasPipes) {
            const day = parseDay(text);
            if (!day) { bot.sendMessage(id, '⚠️ Не распознал строку. Формат:\n`1 мая пн | Святые | 8:40 Литургия`', { parse_mode:'Markdown' }); return; }
            scheduleInput[id].days.push(day);
            bot.sendMessage(id, `✓ ${day.num} ${day.month} (${day.dayOfWeek}) [${scheduleInput[id].days.length}]`);
            return;
        }

        // Свободный текст — через Claude
        if (!anthropic) {
            bot.sendMessage(id, '❌ Для свободного ввода нужен API ключ: /api_key sk-ant-...'); return;
        }
        const status = await bot.sendMessage(id, '🔍 Разбираю текст расписания...');
        try {
            const lines   = await parseScheduleWithClaude(text);
            await bot.deleteMessage(id, status.message_id).catch(()=>{});
            const newDays = (lines||[]).map(l => parseDay(l)).filter(Boolean);
            if (!newDays.length) { bot.sendMessage(id, '❌ Не удалось разобрать. Попробуйте другой формат.'); return; }
            scheduleInput[id].days.push(...newDays);
            const preview = newDays.slice(0,5).map(d => `✓ ${d.num} ${d.month} (${d.dayOfWeek})`).join('\n');
            bot.sendMessage(id,
                `✅ Добавлено *${newDays.length} дней*\n${preview}${newDays.length>5?`\n...и ещё ${newDays.length-5}`:''}\n\nВсего: ${scheduleInput[id].days.length} — /готово`,
                { parse_mode:'Markdown' });
        } catch(e) {
            await bot.deleteMessage(id, status.message_id).catch(()=>{});
            bot.sendMessage(id, `❌ Ошибка: ${e.message}`);
        }
    }
});

// ════════════════════════════════════════════════════════════
//  АВТОМАТИЗАЦИЯ — ежедневная публикация
// ════════════════════════════════════════════════════════════

let lastDailyDate = '';

setInterval(async () => {
    const now    = new Date();
    const hour   = now.getHours();
    const min    = now.getMinutes();
    const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    // В 8:00 утра — публикуем святого дня в канал
    if (hour === 8 && min === 0 && lastDailyDate !== dateKey) {
        lastDailyDate = dateKey;
        const cfg = loadConfig();
        if (!cfg.channelId) return;

        const s = loadSchedule();
        const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
        const day   = now.getDate();
        const monthName = months[now.getMonth()];
        const entry = s.days.find(d => String(d.num) === String(day) && d.month === monthName);
        if (!entry) return;

        const feast  = entry.feastName ? `\n\n🎉 *${entry.feastName}*` : '';
        const saints = entry.saints    ? `\n\n👼 ${entry.saints}` : '';
        const svcs   = entry.services.length
            ? '\n\n📅 *Богослужения:*\n' + entry.services.map(sv => `• ${sv.time} — ${sv.desc}`).join('\n')
            : '';

        const text = `✝ *${day} ${monthName}* — ${entry.dayOfWeek}${feast}${saints}${svcs}\n\n🕍 ${CHURCH}\n☎ ${PHONE}`;
        await bot.sendMessage(cfg.channelId, text, { parse_mode:'Markdown' }).catch(() => {});
    }
}, 60 * 1000);

// ════════════════════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ════════════════════════════════════════════════════════════

(function init() {
    // Загружаем сохранённый API ключ
    if (fs.existsSync(KEY_FILE)) {
        const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
        if (key) anthropic = new Anthropic({ apiKey: key });
    } else if (process.env.ANTHROPIC_KEY) {
        anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
    }

    // Создаём конфиг если нет
    if (!fs.existsSync(CONFIG_FILE)) saveConfig({ adminIds:[], channelId:'', password:'Дегунино2025' });

    console.log('✝ Бот Храма Кирилла и Мефодия, Дегунино — запущен');
    if (anthropic) console.log('  Claude API: подключён');
    else           console.log('  Claude API: не настроен (отправьте /api_key)');
})();

bot.on('polling_error', err => console.error('Polling error:', err.message));
