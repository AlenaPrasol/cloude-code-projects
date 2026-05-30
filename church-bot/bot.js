'use strict';
const TelegramBot   = require('node-telegram-bot-api');
const express       = require('express');
const fs            = require('fs');
const path          = require('path');
const https         = require('https');
const { execSync }  = require('child_process');

const TOKEN          = process.env.BOT_TOKEN;
const DATA_FILE      = path.join(__dirname, 'data.json');
const CONFIG_FILE    = path.join(__dirname, 'config.json');
const SCHEDULE_FILE  = path.join(__dirname, 'schedule.json');
const NOTES_FILE     = path.join(__dirname, 'notes.json');
const HTML_OUT       = '/home/agent/khram-site/schedule.html';
const SITE_DIR       = '/home/agent/khram-site';
const PROFILES_FILE  = path.join(__dirname, 'profiles.json');

// ─── САЙТ (GitHub Pages — постоянный бесплатный хостинг) ────────────────────
const NETLIFY_URL = 'https://khram-aikhal.github.io';

function deployToGitHub(message = 'update site') {
    try {
        execSync(`cd ${SITE_DIR} && git add -A && git commit -m "${message}" && git push`, { stdio: 'pipe' });
        console.log('[github] deployed:', message);
    } catch(e) {
        console.error('[github] deploy error:', e.stderr?.toString() || e.message);
    }
}

// ─── КОНСТАНТЫ ХРАМА ────────────────────────────────────────────────────────
const CHURCH         = 'Храм Рождества Христова';
const ADMIN_PASSWORD = 'маша';
const DONATION_PHONE = '+79244605220';
const DONATION_NAME  = 'Иван Александрович С.';
const DONATION_NOTE  = 'Пожертвование на храм';
const CONTACT_PHONE  = '+79244658261'; // личный номер для записок через личку
const DAILY_SUMMARY_HOUR_UTC = 13;    // 22:00 по Якутску (UTC+9)

// ─── TELEGRAM-ГРУППА для объявлений ─────────────────────────────────────────
const ANNOUNCE_CHAT_ID  = -1001155909350; // приходская группа
const ANNOUNCE_THREAD_ID = 9161;          // раздел «Жизнь прихода»

// ─── КОНФИГ ─────────────────────────────────────────────────────────────────
function loadConfig() {
    try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch {}
    return { adminIds: [] };
}
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
function isAdmin(id)   { return loadConfig().adminIds.includes(String(id)); }

// ─── ДАННЫЕ (плоские списки — обратная совместимость) ────────────────────────
function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { zdravie: [], upokoj: [], bolash: [], putesh: [], panikhida: [], molebn: [] };
    try {
        const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        d.bolash    = d.bolash    || [];
        d.putesh    = d.putesh    || [];
        d.panikhida = d.panikhida || [];
        d.molebn    = d.molebn    || [];
        return d;
    }
    catch { return { zdravie: [], upokoj: [], bolash: [], putesh: [], panikhida: [], molebn: [] }; }
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
let db = loadData();

// ─── ЗАПИСКИ (с датой и отправителем) ───────────────────────────────────────
function loadNotes() {
    if (!fs.existsSync(NOTES_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); }
    catch { return []; }
}
function saveNotes(n) { fs.writeFileSync(NOTES_FILE, JSON.stringify(n, null, 2)); }

function addNote(chatId, firstName, type, names) {
    const notes = loadNotes();
    notes.push({
        date: new Date().toISOString(),
        from: String(chatId),
        fromName: firstName || '',
        type,
        names,
    });
    saveNotes(notes);
    if (type === 'zdravie')         db.zdravie.push(...names);
    else if (type === 'upokoj')    db.upokoj.push(...names);
    else if (type === 'bolash')    db.bolash.push(...names);
    else if (type === 'putesh')    db.putesh.push(...names);
    else if (type === 'panikhida') db.panikhida.push(...names);
    else if (type === 'molebn')    db.molebn.push(...names);
    saveData(db);
}

// ─── ПРОФИЛИ ПРИХОЖАН (сохранённые списки имён) ─────────────────────────────
function loadProfiles() {
    try { return fs.existsSync(PROFILES_FILE) ? JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) : {}; }
    catch { return {}; }
}
function saveProfiles(p) { fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2)); }

function getProfile(userId) {
    return loadProfiles()[String(userId)] || { zdravie: [], upokoj: [] };
}

function saveProfileList(userId, type, names) {
    const profiles = loadProfiles();
    if (!profiles[String(userId)]) profiles[String(userId)] = { zdravie: [], upokoj: [] };
    profiles[String(userId)][type] = names;
    saveProfiles(profiles);
}

function showMyList(chatId) {
    const p = getProfile(chatId);
    const hasZdravie = p.zdravie && p.zdravie.length > 0;
    const hasUpokoj  = p.upokoj  && p.upokoj.length  > 0;

    if (!hasZdravie && !hasUpokoj) {
        bot.sendMessage(chatId,
            `📋 *Мой список*\n\nУ вас пока нет сохранённых имён.\n\nПодайте записку обычным способом — в конце я предложу сохранить список.\n\n_Потом одной кнопкой будете подавать за всех близких сразу!_ 🙏`,
            { parse_mode: 'Markdown', ...KB_USER });
        return;
    }

    let text = `📋 *Мой список*\n\nСохранённые имена:\n\n`;
    const buttons = [];

    if (hasZdravie) {
        text += `🙏 *О здравии:*\n${p.zdravie.map(n => `• ${n}`).join('\n')}\n\n`;
        buttons.push([{ text: `🙏 Подать о здравии (${p.zdravie.length} имён)`, callback_data: 'mylist_zdravie' }]);
    }
    if (hasUpokoj) {
        text += `✝️ *Об упокоении:*\n${p.upokoj.map(n => `• ${n}`).join('\n')}\n\n`;
        buttons.push([{ text: `✝️ Подать об упокоении (${p.upokoj.length} имён)`, callback_data: 'mylist_upokoj' }]);
    }
    buttons.push([{ text: '✏️ Изменить список', callback_data: 'mylist_edit' }]);

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });
}

// ─── РАСПИСАНИЕ ─────────────────────────────────────────────────────────────
function loadSchedule() {
    if (!fs.existsSync(SCHEDULE_FILE)) return { photoFileId: null, month: '', days: [] };
    try {
        const s = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        s.photoFileId = s.photoFileId || null;
        return s;
    }
    catch { return { photoFileId: null, month: '', days: [] }; }
}
function saveSchedule(s) { fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(s, null, 2)); }

// ─── ИМЕНА ──────────────────────────────────────────────────────────────────
const allForms = {
    'аввакум':'Аввакум','аввакума':'Аввакум',
    'агафья':'Агафья','агафьи':'Агафья','гаша':'Агафья',
    'агния':'Агния','агнии':'Агния',
    'александр':'Александр',
    'саша':'Александр','саши':'Александр','шура':'Александр',
    'александра':'Александра','александры':'Александра',
    'алексий':'Алексий','алексия':'Алексий','алексей':'Алексий','лёша':'Алексий','алёша':'Алексий',
    'алла':'Алла','аллы':'Алла',
    'анастасия':'Анастасия','настя':'Анастасия','настенька':'Анастасия',
    'анатолий':'Анатолий','толя':'Анатолий','толик':'Анатолий',
    'андрей':'Андрей','андрея':'Андрей','андрюша':'Андрей',
    'анна':'Анна','аня':'Анна','анечка':'Анна','нюра':'Анна','нюша':'Анна',
    'антоний':'Антоний','антон':'Антоний','тоша':'Антоний',
    'антонина':'Антонина','тоня':'Антонина',
    'аполлинария':'Аполлинария','полина':'Аполлинария','поля':'Аполлинария',
    'аркадий':'Аркадий','аркаша':'Аркадий',
    'арсений':'Арсений','арсюша':'Арсений',
    'артемий':'Артемий','тёма':'Артемий','артем':'Артемий',
    'афанасий':'Афанасий','афоня':'Афанасий',
    'борис':'Борис','боря':'Борис',
    'валентина':'Валентина','валя':'Валентина',
    'валерий':'Валерий','валера':'Валерий',
    'валерия':'Валерия','лера':'Валерия',
    'варвара':'Варвара','варя':'Варвара',
    'варлаам':'Варлаам','варнава':'Варнава','варфоломей':'Варфоломей',
    'василий':'Василий','вася':'Василий','васенька':'Василий',
    'василиса':'Василиса','васса':'Васса',
    'вениамин':'Вениамин','веня':'Вениамин',
    'вера':'Вера',
    'вероника':'Вероника','ника':'Вероника',
    'виктор':'Виктор','витя':'Виктор',
    'виктория':'Виктория','вика':'Виктория',
    'виталий':'Виталий',
    'владимир':'Владимир','вова':'Владимир','володя':'Владимир',
    'власий':'Власий','влас':'Власий',
    'вячеслав':'Вячеслав','слава':'Вячеслав',
    'гавриил':'Гавриил','гаврюша':'Гавриил',
    'галина':'Галина','галя':'Галина','галочка':'Галина',
    'геннадий':'Геннадий','гена':'Геннадий',
    'георгий':'Георгий','жора':'Георгий','гоша':'Георгий','юрий':'Георгий','юра':'Георгий',
    'герман':'Герман',
    'гликерия':'Гликерия','глаша':'Гликерия',
    'глеб':'Глеб',
    'григорий':'Григорий','гриша':'Григорий',
    'даниил':'Даниил','даня':'Даниил','данила':'Даниил',
    'дарья':'Дарья','даша':'Дарья','дашенька':'Дарья',
    'дионисий':'Дионисий','денис':'Дионисий',
    'димитрий':'Димитрий','дмитрий':'Димитрий','дима':'Димитрий','митя':'Димитрий',
    'евгений':'Евгений','женя':'Евгений',
    'евгения':'Евгения','евгении':'Евгения',
    'евдокия':'Евдокия','дуня':'Евдокия','авдотья':'Евдокия',
    'екатерина':'Екатерина','катя':'Екатерина','катюша':'Екатерина',
    'елена':'Елена','лена':'Елена','леночка':'Елена','алёна':'Елена','аленка':'Елена',
    'елизавета':'Елизавета','лиза':'Елизавета','лизонька':'Елизавета',
    'захария':'Захария','захар':'Захария',
    'зинаида':'Зинаида','зина':'Зинаида',
    'зиновий':'Зиновий',
    'зоя':'Зоя',
    'зосима':'Зосима',
    'иаков':'Иаков','яков':'Иаков','яша':'Иаков',
    'иларион':'Иларион',
    'илия':'Илия','илья':'Илия','ильюша':'Илия',
    'иннокентий':'Иннокентий','кеша':'Иннокентий',
    'иоанн':'Иоанн','иван':'Иоанн','ваня':'Иоанн','ванечка':'Иоанн','ванюша':'Иоанн',
    'иосиф':'Иосиф','осип':'Иосиф',
    'ирина':'Ирина','ира':'Ирина','ирочка':'Ирина',
    'иулиания':'Иулиания','ульяна':'Иулиания','юлия':'Иулиания','юля':'Иулиания',
    'кирилл':'Кирилл','кирюша':'Кирилл',
    'клавдия':'Клавдия','клава':'Клавдия',
    'константин':'Константин','костя':'Константин',
    'косма':'Косма','кузьма':'Косма','кузя':'Косма',
    'ксения':'Ксения','ксюша':'Ксения',
    'лариса':'Лариса',
    'лев':'Лев',
    'леонид':'Леонид','лёня':'Леонид',
    'лидия':'Лидия','лида':'Лидия',
    'лука':'Лука',
    'любовь':'Любовь','люба':'Любовь',
    'людмила':'Людмила','люда':'Людмила','люся':'Людмила',
    'макарий':'Макарий','макар':'Макарий',
    'максим':'Максим',
    'маргарита':'Маргарита','рита':'Маргарита',
    'марина':'Марина',
    'марк':'Марк',
    'мария':'Мария','маша':'Мария','маня':'Мария','машенька':'Мария','маруся':'Мария',
    'марфа':'Марфа',
    'матрона':'Матрона','матрёна':'Матрона',
    'матфей':'Матфей','матвей':'Матфей',
    'мефодий':'Мефодий',
    'михаил':'Михаил','миша':'Михаил','мишенька':'Михаил',
    'митрофан':'Митрофан',
    'моисей':'Моисей',
    'надежда':'Надежда','надя':'Надежда','наденька':'Надежда',
    'наталия':'Наталия','наталья':'Наталия','наташа':'Наталия',
    'нестор':'Нестор',
    'никита':'Никита',
    'николай':'Николай','коля':'Николай','колечка':'Николай',
    'нина':'Нина',
    'олег':'Олег',
    'ольга':'Ольга','оля':'Ольга','оленька':'Ольга',
    'павел':'Павел','паша':'Павел',
    'пантелеимон':'Пантелеимон',
    'параскева':'Параскева','прасковья':'Параскева','параша':'Параскева',
    'пелагия':'Пелагия','пелагея':'Пелагия',
    'пётр':'Пётр','петр':'Пётр','петя':'Пётр',
    'платон':'Платон',
    'раиса':'Раиса','рая':'Раиса',
    'роман':'Роман','рома':'Роман',
    'савва':'Савва',
    'серафим':'Серафим',
    'серафима':'Серафима','сима':'Серафима',
    'сергий':'Сергий','сергей':'Сергий','серёжа':'Сергий','серёга':'Сергий',
    'симеон':'Симеон','семён':'Симеон','семен':'Симеон','сёма':'Симеон',
    'спиридон':'Спиридон',
    'стефан':'Стефан','степан':'Стефан','стёпа':'Стефан',
    'сусанна':'Сусанна',
    'таисия':'Таисия',
    'тамара':'Тамара',
    'татьяна':'Татьяна','таня':'Татьяна','танюша':'Татьяна','танечка':'Татьяна',
    'тимофей':'Тимофей','тима':'Тимофей',
    'тихон':'Тихон','тиша':'Тихон',
    'феврония':'Феврония',
    'феодор':'Феодор','фёдор':'Феодор','федя':'Феодор',
    'феодосия':'Феодосия',
    'феофан':'Феофан',
    'фёкла':'Фёкла','фекла':'Фёкла',
    'филипп':'Филипп','филя':'Филипп',
    'фома':'Фома',
    'фотиния':'Фотиния','светлана':'Фотиния','света':'Фотиния','светочка':'Фотиния',
    'христина':'Христина','кристина':'Христина',
    'ярослав':'Ярослав',
    // ВЛАДИСЛАВ
    'владислав':'Владислав','владислава':'Владислав',
    'влад':'Владислав','влади':'Владислав','владик':'Владислав',
};

// Неоднозначные имена — нужен выбор пола
const AMBIGUOUS = {
    'александр': { male: 'Александр', female: 'Александра', label: 'Александр' },
    'евгений':   { male: 'Евгений',   female: 'Евгения',    label: 'Евгений'   },
    'валерий':   { male: 'Валерий',   female: 'Валерия',    label: 'Валерий'   },
};

function findCanonical(word) {
    const key = word.toLowerCase().trim().replace(/ё/g, 'е');
    for (const [k, v] of Object.entries(allForms)) {
        if (k.replace(/ё/g, 'е') === key) return v;
    }
    return null;
}

const specialGen = {
    'любовь':'Любови', 'павел':'Павла', 'лев':'Льва',
    'фёкла':'Фёклы', 'пётр':'Петра', 'иоанн':'Иоанна',
    'илия':'Илии', 'симеон':'Симеона', 'гавриил':'Гавриила',
    'иаков':'Иакова', 'матфей':'Матфея', 'дионисий':'Дионисия',
};

function toGenitive(name) {
    name = name.trim();
    if (!name) return '';
    const key = name.toLowerCase().replace(/ё/g, 'е');
    if (specialGen[key]) return specialGen[key];
    if (name.endsWith('ий')) return name.slice(0,-2)+'ия';
    if (name.endsWith('ия')) return name.slice(0,-2)+'ии';
    if (name.endsWith('ья')) return name.slice(0,-1)+'и';
    if (name.endsWith('ей')) return name.slice(0,-1)+'я';
    if (name.endsWith('ай')) return name.slice(0,-1)+'я';
    if (name.endsWith('й'))  return name.slice(0,-1)+'я';
    const velar = ['г','к','х','ж','ш','щ','ч'];
    if (name.endsWith('а')) {
        const prev = name[name.length-2].toLowerCase();
        return name.slice(0,-1)+(velar.includes(prev)?'и':'ы');
    }
    if (name.endsWith('я')) return name.slice(0,-1)+'и';
    const cons = ['б','в','г','д','ж','з','к','л','м','н','п','р','с','т','ф','х','ц','ч','ш','щ'];
    if (cons.includes(name[name.length-1].toLowerCase())) return name+'а';
    if (name.endsWith('ь')) return name.slice(0,-1)+'я';
    return name;
}

// Проверяет, является ли слово неоднозначным по полу
function isAmbiguous(word) {
    const key = word.toLowerCase().trim().replace(/ё/g, 'е');
    return !!AMBIGUOUS[key];
}

// Разбирает список строк имён
function parseNameLines(text) {
    return text.split('\n').map(l => l.trim()).filter(Boolean);
}

// ─── СОСТОЯНИЯ ──────────────────────────────────────────────────────────────
const states = {};
function getState(id)             { return states[id] || { step: 'NONE', data: {} }; }
function setState(id, step, data) { states[id] = { step, data: data || {} }; }
function clearState(id)           { delete states[id]; }

// ─── КЛАВИАТУРЫ ─────────────────────────────────────────────────────────────
const KB_USER = {
    reply_markup: {
        keyboard: [
            ['🙏 О здравии',          '✝️ Об упокоении'],
            ['🤒 О болящих',          '✈️ О путешествующих'],
            ['🕯 Панихида',           '🙏 Молебен'],
            ['📋 Мой список',          '🗓 Календарь'],
            ['📅 Расписание',          'ℹ️ О храме'],
            ['💳 Пожертвование'],
            ['🔗 Ссылки прихода'],
        ],
        resize_keyboard: true,
    },
};

const KB_ADMIN = {
    reply_markup: {
        keyboard: [
            ['🙏 О здравии',          '✝️ Об упокоении'],
            ['🤒 О болящих',          '✈️ О путешествующих'],
            ['🕯 Панихида',           '🙏 Молебен'],
            ['⛪ Служба',             '📋 Записки'],
            ['📤 Скачать список',     '🗑 Очистить после службы'],
            ['📢 Объявление',         '🔗 Ссылки прихода'],
            ['📋 Новое расписание',   '🗓 HTML расписания'],
            ['📊 Статистика открыток'],
        ],
        resize_keyboard: true,
    },
};

function inlineKb(buttons) {
    return { reply_markup: { inline_keyboard: buttons } };
}

// ─── КЭШ УВЕДОМЛЕНИЙ (для кнопки Помянул) ──────────────────────────────────
const notesCache = new Map();

// Имена в N колонок — моноширина через <pre>, чтобы колонки ровные
function formatNamesColumns(names, cols = 2) {
    if (!names.length) return '—';
    const maxLen = Math.max(...names.map(n => n.length));
    const colW = maxLen + 3;
    const lines = [];
    for (let i = 0; i < names.length; i += cols) {
        const row = names.slice(i, i + cols);
        const padded = row.map((n, idx) =>
            idx < row.length - 1 ? n.padEnd(colW, ' ') : n
        );
        lines.push(padded.join(''));
    }
    return '<pre>' + lines.join('\n') + '</pre>';
}

// Отправить уведомление администраторам с кнопкой «Помянул»
async function notifyAdminsNote(label, names, fromName) {
    const cfg = loadConfig();
    const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const colsText = formatNamesColumns(names, 2);
    const namesFlat = names.join(', ');
    notesCache.set(uid, { label, colsText, namesFlat, fromName: fromName || 'сайт' });
    setTimeout(() => notesCache.delete(uid), 24 * 60 * 60 * 1000);

    const text = `📋 <b>${label}</b>

${colsText}

<i>От: ${fromName || 'сайт'}</i>`;
    for (const adminId of cfg.adminIds) {
        await bot.sendMessage(adminId, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '☐ Помянул', callback_data: `pom_${uid}` }]] }
        }).catch(() => {});
    }
}

// ─── БОТ ────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
const awaitingSchedule = {};

async function notifyAdmins(text, opts) {
    const cfg = loadConfig();
    for (const id of cfg.adminIds) {
        await bot.sendMessage(id, text, opts || {}).catch(() => {});
    }
}

// Регистрация команд в меню Telegram
async function setupCommands() {
    const userCommands = [
        { command: 'menu',  description: '🏠 Главное меню' },
        { command: 'help',  description: '📖 Как подать записку' },
    ];
    const adminCommands = [
        { command: 'menu',      description: '🏠 Главное меню' },
        { command: 'notes',     description: '📋 Записки по видам' },
        { command: 'clear',     description: '🗑 Очистить все записки после службы' },
        { command: 'schedule',  description: '📅 Загрузить новое расписание (фото)' },
        { command: 'announce',  description: '📢 Написать объявление' },
        { command: 'stats',     description: '📊 Статистика записок' },
        { command: 'sbp',       description: '⚡ Установить СБП-ссылку на сайте' },
        { command: 'help',      description: '📖 Список команд' },
    ];

    await bot.setMyCommands(userCommands);
    console.log('✅ Команды для пользователей зарегистрированы');

    const cfg = loadConfig();
    for (const id of cfg.adminIds) {
        await bot.setMyCommands(adminCommands, {
            scope: { type: 'chat', chat_id: Number(id) },
        });
        console.log(`✅ Команды для администратора ${id} зарегистрированы`);
    }
}
setupCommands().catch(e => console.error('❌ setupCommands error:', e.message));

// ════════════════════════════════════════════════════════════
//  КОМАНДЫ
// ════════════════════════════════════════════════════════════

bot.onText(/\/start/, msg => {
    const id   = msg.chat.id;
    const name = msg.from.first_name || 'добрый человек';
    clearState(id);
    if (isAdmin(id)) {
        bot.sendMessage(id,
            `✞ Добро пожаловать!\n\n*${CHURCH}*\n\nВы вошли как администратор.`,
            { parse_mode: 'Markdown', ...KB_ADMIN });
    } else {
        bot.sendMessage(id,
            `✞ Добро пожаловать, ${name}!\n\n*${CHURCH}*\n\nЗдесь можно подать записку о здравии или об упокоении. Имена будут сохранены и переданы батюшке.\n\nВыберите действие:`,
            { parse_mode: 'Markdown', ...KB_USER });
    }
});

bot.onText(/\/admin(?:\s+(.+))?/, (msg, match) => {
    const id  = msg.chat.id;
    if (isAdmin(id)) { bot.sendMessage(id, '✅ Вы уже администратор.', KB_ADMIN); return; }
    const pwd = (match[1] || '').trim();
    if (pwd === ADMIN_PASSWORD) {
        const cfg = loadConfig();
        cfg.adminIds.push(String(id));
        saveConfig(cfg);
        bot.sendMessage(id, '✅ Добро пожаловать, батюшка!', KB_ADMIN);
    } else {
        bot.sendMessage(id, '❌ Неверный пароль.');
    }
});

bot.onText(/\/get_id/, msg => {
    bot.sendMessage(msg.chat.id, `Ваш Telegram ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// ─── /menu — главное меню ───────────────────────────────────────────────────
bot.onText(/\/menu/, msg => {
    const id = msg.chat.id;
    clearState(id);
    bot.sendMessage(id, '🏠 Главное меню', isAdmin(id) ? KB_ADMIN : KB_USER);
});

// ─── /notes — записки по видам (admin) ──────────────────────────────────────
bot.onText(/\/notes/, msg => {
    if (!isAdmin(msg.chat.id)) return;
    showNotes(msg.chat.id);
});

// ─── /clear — очистить записки (admin) ──────────────────────────────────────
bot.onText(/\/clear/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) return;
    bot.sendMessage(id, '⚠️ Вы уверены? Все записки будут удалены.',
        inlineKb([[
            { text: '✅ Да, очистить', callback_data: 'clear_yes' },
            { text: '❌ Отмена',       callback_data: 'clear_no'  },
        ]]));
});

// ─── /schedule — загрузить расписание (admin) ───────────────────────────────
bot.onText(/\/schedule/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) return;
    setState(id, 'AWAIT_SCHED_PHOTO', {});
    bot.sendMessage(id, '📅 Пришлите фото расписания — я его сохраню и покажу прихожанам.\n\n/menu — отмена');
});

// ─── Шаблон объявления в группу ─────────────────────────────────────────────
function buildAnnouncement(feastText) {
    return (
        `✝️ На ${feastText} ✝️\n\n` +
        `Принимаем ваше поминание — имена о здравии и об упокоении.\n\n` +
        `📲 Подать записку онлайн:\n${NETLIFY_URL}\n\n` +
        `Или написать мне в личном сообщении: ${CONTACT_PHONE}\n\n` +
        `💳 Пожертвование на храм:\n` +
        `• По номеру телефона (любой банк): ${DONATION_PHONE}\n` +
        `  Получатель: ${DONATION_NAME}\n` +
        `  Назначение: «${DONATION_NOTE}»\n` +
        `• Через СберБанк Онлайн — кнопка на сайте\n\n` +
        `🙏 Да хранит вас Господь!`
    );
}

// ─── /announce — объявление (admin) ─────────────────────────────────────────
bot.onText(/\/announce/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) return;
    setState(id, 'AWAIT_ANNOUNCE_FEAST', {});
    bot.sendMessage(id,
        '📢 *Объявление в группу*\n\nВведите название праздника или службы:\n\n_Пример:_\n`Воскресную Литургию в день святых отцов 1-го Вселенского Собора и памяти равноапостольных Мефодия и Кирилла`\n\n/menu — отмена',
        { parse_mode: 'Markdown', ...inlineKb([[{ text: '❌ Отмена', callback_data: 'cancel' }]]) });
});

// ─── /stats — статистика (admin) ────────────────────────────────────────────
bot.onText(/\/stats/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) return;
    const d = loadData();
    const notes = loadNotes();
    const today = new Date().toDateString();
    const todayCount = notes.filter(n => new Date(n.date).toDateString() === today).length;
    bot.sendMessage(id,
        `📊 *Статистика записок*\n\n` +
        `🙏 О здравии: *${d.zdravie.length}* имён\n` +
        `✝️ Об упокоении: *${d.upokoj.length}* имён\n` +
        `🤒 О болящих: *${d.bolash.length}* имён\n` +
        `✈️ О путешествующих: *${d.putesh.length}* имён\n\n` +
        `Всего: *${d.zdravie.length + d.upokoj.length + d.bolash.length + d.putesh.length}* имён\n` +
        `Записок сегодня: *${todayCount}*`,
        { parse_mode: 'Markdown', ...KB_ADMIN });
});

// ─── /sbp — установить СБП-ссылку (admin) ──────────────────────────────────
bot.onText(/\/sbp(?:\s+(.+))?/, (msg, match) => {
    const id  = msg.chat.id;
    if (!isAdmin(id)) return;

    const url = (match[1] || '').trim();

    // Без аргумента — показать текущее состояние
    if (!url) {
        const cfg = loadConfig();
        const current = cfg.sbpUrl || null;
        if (current) {
            bot.sendMessage(id,
                `⚡ *СБП-ссылка установлена:*\n\`${current}\`\n\nЧтобы обновить: \`/sbp новая_ссылка\`\nЧтобы удалить: \`/sbp off\``,
                { parse_mode: 'Markdown', ...KB_ADMIN });
        } else {
            bot.sendMessage(id,
                `⚡ СБП-ссылка пока не установлена.\n\nОтправьте:\n\`/sbp https://ссылка-от-батюшки\``,
                { parse_mode: 'Markdown', ...KB_ADMIN });
        }
        return;
    }

    // Удалить ссылку
    if (url === 'off' || url === 'удалить') {
        const cfg = loadConfig();
        cfg.sbpUrl = null;
        saveConfig(cfg);
        updateSbpOnSite(null);
        bot.sendMessage(id, '✅ СБП-ссылка удалена с сайта.', KB_ADMIN);
        return;
    }

    // Проверяем что это похоже на ссылку
    if (!url.startsWith('http')) {
        bot.sendMessage(id, '⚠️ Ссылка должна начинаться с http. Пример:\n`/sbp https://qr.nspk.ru/...`',
            { parse_mode: 'Markdown' });
        return;
    }

    // Сохраняем и обновляем сайт
    const cfg = loadConfig();
    cfg.sbpUrl = url;
    saveConfig(cfg);
    updateSbpOnSite(url);
    bot.sendMessage(id,
        `✅ *СБП-ссылка обновлена!*\n\nСайт обновляется, через ~15 секунд кнопка СБП появится:\n${NETLIFY_URL}`,
        { parse_mode: 'Markdown', ...KB_ADMIN });
});

function updateSbpOnSite(sbpUrl) {
    try {
        const indexPath = path.join(SITE_DIR, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');
        html = html.replace(
            /const SBP_URL = .*?;/,
            `const SBP_URL = ${sbpUrl ? `'${sbpUrl}'` : 'null'};`
        );
        fs.writeFileSync(indexPath, html, 'utf8');
        deployToGitHub('update SBP URL');
        console.log(`[sbp] url set to: ${sbpUrl}`);
    } catch(e) {
        console.error('[sbp] update error:', e.message);
    }
}

// ─── /help — помощь ─────────────────────────────────────────────────────────
bot.onText(/\/help/, msg => {
    const id = msg.chat.id;
    if (isAdmin(id)) {
        bot.sendMessage(id,
            `📖 *Команды батюшки:*\n\n` +
            `/menu — главное меню\n` +
            `/notes — записки по видам\n` +
            `/clear — очистить записки после службы\n` +
            `/schedule — загрузить расписание (фото)\n` +
            `/announce — написать объявление\n` +
            `/stats — статистика записок\n` +
            `/sbp [ссылка] — установить СБП-ссылку на сайте\n` +
            `/help — эта подсказка`,
            { parse_mode: 'Markdown', ...KB_ADMIN });
    } else {
        bot.sendMessage(id,
            `📖 *Как подать записку:*\n\nВыберите вид записки и введите имена — каждое на новой строке.\n\nИмена будут переданы батюшке. 🙏`,
            { parse_mode: 'Markdown', ...KB_USER });
    }
});

// ─── Просмотр записок (admin) ────────────────────────────────────────────────
function showNotes(chatId) {
    const d = loadData();
    const counts = {
        zdravie:   d.zdravie.length,
        upokoj:    d.upokoj.length,
        bolash:    d.bolash.length,
        putesh:    d.putesh.length,
        panikhida: (d.panikhida || []).length,
        molebn:    (d.molebn    || []).length,
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) { bot.sendMessage(chatId, '📋 Записок пока нет.', KB_ADMIN); return; }

    const buttons = [
        [{ text: `🙏 О здравии (${counts.zdravie})`,        callback_data: 'notes_zdravie' }],
        [{ text: `✝️ Об упокоении (${counts.upokoj})`,      callback_data: 'notes_upokoj'  }],
        [{ text: `🤒 О болящих (${counts.bolash})`,         callback_data: 'notes_bolash'  }],
        [{ text: `✈️ О путешествующих (${counts.putesh})`,  callback_data: 'notes_putesh'  }],
    ];
    if (counts.panikhida) buttons.push([{ text: `🕯 Панихида (${counts.panikhida})`, callback_data: 'notes_panikhida' }]);
    if (counts.molebn)    buttons.push([{ text: `🙏 Молебен (${counts.molebn})`,     callback_data: 'notes_molebn'    }]);

    bot.sendMessage(chatId,
        `📋 *Записки* — всего имён: ${total}

Выберите вид:`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
}

// ─── Режим службы (проскомидия) ───────────────────────────────────────────────
function showServiceMode(chatId) {
    const d = loadData();
    const types = [
        ['zdravie',   '🙏 О здравии'],
        ['upokoj',    '✝️ Об упокоении'],
        ['bolash',    '🤒 О болящих'],
        ['putesh',    '✈️ О путешествующих'],
        ['panikhida', '🕯 Панихида'],
        ['molebn',    '🙏 Молебен'],
    ];
    const total = types.reduce((s, [k]) => s + (d[k] || []).length, 0);
    if (!total) { bot.sendMessage(chatId, '📋 Записок пока нет.', KB_ADMIN); return; }

    bot.sendMessage(chatId,
        `⛪ <b>Режим службы</b> — ${total} имён

Тапните «Помянул» после каждой записки`,
        { parse_mode: 'HTML' }
    );
    for (const [key, label] of types) {
        const names = d[key] || [];
        if (!names.length) continue;
        const uid = Date.now().toString(36) + '_' + key;
        const colsText = formatNamesColumns(names, 2);
        const namesFlat = names.join(', ');
        notesCache.set(uid, { label, colsText, namesFlat, fromName: 'все записки' });
        setTimeout(() => notesCache.delete(uid), 8 * 60 * 60 * 1000);
        bot.sendMessage(chatId,
            `📋 <b>${label}</b> (${names.length})

${colsText}`,
            {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '☐ Помянул', callback_data: `pom_${uid}` }]] }
            }
        ).catch(() => {});
    }
}

// ─── Расписание (user) ───────────────────────────────────────────────────────
function showSchedule(chatId) {
    const s = loadSchedule();

    // Inline-кнопка «Открыть красивое расписание на сайте»
    const siteBtn = {
        reply_markup: {
            inline_keyboard: [[
                { text: '🌐 Открыть расписание на сайте', url: `${NETLIFY_URL}/schedule.html` }
            ]]
        }
    };

    if (s.photoFileId) {
        const caption = '📅 Расписание богослужений';
        const optsWithBtn = { caption, ...siteBtn };

        if (s.fileType === 'sticker') {
            // У стикеров нет caption — шлём стикер + отдельно кнопку
            bot.sendSticker(chatId, s.photoFileId, KB_USER).then(() => {
                bot.sendMessage(chatId, '🌐 Расписание на сайте — удобнее листать:', siteBtn);
            });
        } else if (s.fileType === 'document') {
            bot.sendDocument(chatId, s.photoFileId, optsWithBtn);
        } else if (s.fileType === 'video') {
            bot.sendVideo(chatId, s.photoFileId, optsWithBtn);
        } else {
            bot.sendPhoto(chatId, s.photoFileId, optsWithBtn)
                .catch(() => bot.sendDocument(chatId, s.photoFileId, optsWithBtn));
        }
        return;
    }

    // Расписание-фото ещё не загружено — но HTML-версия может быть
    bot.sendMessage(chatId,
        `📅 Расписание богослужений\n\nФото расписания пока не загружено батюшкой.\n\nАктуальное расписание — на сайте прихода 👇`,
        { ...KB_USER, ...siteBtn }
    );
}

// ─── О храме (user) ──────────────────────────────────────────────────────────
function showAbout(chatId) {
    bot.sendMessage(chatId,
        `✞ *Храм Рождества Христова*\n_посёлок Айхал · Якутия_\n\n` +
        `Посёлок Айхал — один из алмазных городов Якутии. Слово «Айхал» в переводе с якутского означает _«слава»_. Храм возведён при поддержке АК «АЛРОСА» и стоит на Соборной площади — в самом сердце посёлка.\n\n` +
        `Гордость храма — *фарфоровый иконостас*, один из редчайших в России. Золотые купола и колокольня стали частью облика Айхала.\n\n` +
        `👨‍⚕️ *Настоятель:* иерей Иоанн Серкин\n` +
        `📞 *Телефон:* ${DONATION_PHONE}\n` +
        `✝️ *Епархия:* Якутская и Ленская\n` +
        `🕯 *Престол:* Рождество Христово, 7 января`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '🌐 Сайт прихода', url: NETLIFY_URL }
            ]]}
        }
    );
    // Отдельным сообщением восстанавливаем основную клавиатуру
    setTimeout(() => bot.sendMessage(chatId, '🏠', KB_USER).catch(() => {}), 300);
}

// ─── Православный календарь ───────────────────────────────────────────────────
function orthodoxEaster(year) {
    const a = year % 4, b = year % 7, c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31);
    const day   = ((d + e + 114) % 31) + 1;
    const dt = new Date(Date.UTC(year, month - 1, day));
    dt.setUTCDate(dt.getUTCDate() + 13); // Julian → Gregorian
    return dt;
}

function showCalendar(chatId) {
    // Используем якутское время UTC+9
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const day   = now.getUTCDate();
    const dow   = now.getUTCDay(); // 0=вс

    const easter = orthodoxEaster(year);
    const eM = easter.getUTCMonth() + 1;
    const eD = easter.getUTCDate();
    const eDate = new Date(Date.UTC(year, eM - 1, eD));
    const todayUTC = new Date(Date.UTC(year, month - 1, day));
    const diff = Math.round((todayUTC - eDate) / 86400000);

    const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const DAYS   = ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];

    // Неподвижные великие праздники
    const FIXED = {
        '1-7':  '✝️ Рождество Христово',
        '1-14': '✝️ Обрезание Господне · свт. Василий Великий',
        '1-19': '✝️ Крещение Господне (Богоявление)',
        '2-15': '✝️ Сретение Господне',
        '4-7':  '✝️ Благовещение Пресвятой Богородицы',
        '8-19': '✝️ Преображение Господне',
        '8-28': '✝️ Успение Пресвятой Богородицы',
        '9-21': '✝️ Рождество Пресвятой Богородицы',
        '9-27': '✝️ Воздвижение Честного Креста',
        '11-4': '🕍 Казанская икона Богородицы',
        '12-4': '✝️ Введение во Храм Пресвятой Богородицы',
        '12-19':'🙏 Свт. Николай Чудотворец (Никола Зимний)',
    };

    // Подвижные праздники
    const MOVEABLE = {
        [-48]: '🟣 Чистый понедельник · начало Великого поста',
        [-7]:  '🌿 Вербное воскресенье (Вход Господень в Иерусалим)',
        [-6]:  '🕯 Великий понедельник',
        [-5]:  '🕯 Великий вторник',
        [-4]:  '🕯 Великая среда',
        [-3]:  '🕯 Великий четверг (Тайная Вечеря)',
        [-2]:  '🕯 Великая пятница (Распятие Господне)',
        [-1]:  '🕯 Великая суббота',
        [0]:   '🎉 ПАСХА ХРИСТОВА! Христос Воскресе!',
        [39]:  '✝️ Вознесение Господне',
        [49]:  '✝️ День Святой Троицы (Пятидесятница)',
        [50]:  '✝️ День Святого Духа',
    };

    let feast = MOVEABLE[diff] || FIXED[`${month}-${day}`] || null;

    // Пост
    const isBrightWeek    = diff >= 0  && diff <= 6;
    const isTrinityWeek   = diff >= 49 && diff <= 55;
    const isChristmasWeek = month === 1 && day >= 7 && day <= 17;
    const isPublicanWeek  = diff >= -70 && diff <= -64;
    const noFastWeek = isBrightWeek || isTrinityWeek || isChristmasWeek || isPublicanWeek;

    const isGreatLent      = diff >= -48 && diff <= -2 && !noFastWeek;
    const apostolicFastEnd = new Date(Date.UTC(year, 5, 29)); // 29 июня
    const apostolicFastStart = new Date(eDate); apostolicFastStart.setUTCDate(apostolicFastStart.getUTCDate() + 57);
    const isApostolicFast  = todayUTC >= apostolicFastStart && todayUTC <= apostolicFastEnd;
    const isDormitionFast  = month === 8 && day >= 1 && day <= 14;
    const isNativityFast   = (month === 11 && day >= 28) || month === 12 || (month === 1 && day <= 6);
    const isWedFri         = dow === 3 || dow === 5;

    let fastInfo = '';
    if (isGreatLent)          fastInfo = '🟣 Великий пост — строгое воздержание';
    else if (isBrightWeek)    fastInfo = '🌟 Светлая седмица — поста нет';
    else if (isTrinityWeek)   fastInfo = '🌿 Троицкая седмица — поста нет';
    else if (isChristmasWeek) fastInfo = '🌟 Святки — поста нет';
    else if (isPublicanWeek)  fastInfo = '✅ Седмица мытаря и фарисея — поста нет';
    else if (isApostolicFast) fastInfo = '🔵 Петров пост';
    else if (isDormitionFast) fastInfo = '🔵 Успенский пост';
    else if (isNativityFast)  fastInfo = '🔵 Рождественский пост';
    else if (isWedFri)        fastInfo = '🔵 Постный день (среда / пятница)';

    const easterStr = `${eD} ${MONTHS[eM - 1]}`;
    let text = `📅 *Церковный календарь*\n_${day} ${MONTHS[month - 1]} ${year}, ${DAYS[dow]}_\n\n`;
    if (feast) text += `${feast}\n\n`;
    if (fastInfo) text += `${fastInfo}\n\n`;
    text += `_Православная Пасха ${year} — ${easterStr}_`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...KB_USER });
}

// ─── Текст благодарности после записки ──────────────────────────────────────
const TYPE_LABEL_SHORT = { zdravie:'о здравии', upokoj:'об упокоении', bolash:'о болящих', putesh:'о путешествующих', panikhida:'панихида', molebn:'молебен' };
const TYPE_LABEL_FULL  = { zdravie:'🙏 О здравии', upokoj:'✝️ Об упокоении', bolash:'🤒 О болящих', putesh:'✈️ О путешествующих', panikhida:'🕯 Панихида', molebn:'🙏 Молебен' };

function sendThanks(chatId, type, names) {
    const label = TYPE_LABEL_SHORT[type] || type;
    const icons = { zdravie:'🙏', upokoj:'✝️', bolash:'🤒', putesh:'✈️', panikhida:'🕯', molebn:'🌿' };
    const icon  = icons[type] || '✝️';
    bot.sendMessage(chatId,
        `${icon} *Записка ${label} принята*\n\n${names.map(n => `• ${n}`).join('\n')}\n\nИмена будут помянуты на ближайшей службе в храме.\n\nГосподь слышит каждую молитву о ближних.\n*Спаси вас Христос!* 🙏`,
        { parse_mode: 'Markdown', ...KB_USER });

    // Предлагаем сохранить список (только для здравия и упокоения)
    if (type === 'zdravie' || type === 'upokoj') {
        const p = getProfile(chatId);
        const savedNames = p[type] || [];
        const isSame = savedNames.length === names.length &&
            savedNames.every((n, i) => n === names[i]);
        if (!isSame) {
            const listKey = `save_list_${type}_${names.join(',')}`.slice(0, 200);
            setTimeout(() => {
                bot.sendMessage(chatId,
                    `💾 Сохранить этот список для быстрой подачи в следующий раз?`,
                    { reply_markup: { inline_keyboard: [[
                        { text: '💾 Да, сохранить', callback_data: listKey },
                        { text: 'Нет', callback_data: 'pom_done' },
                    ]]}});
            }, 800);
        }
    }
}

// ════════════════════════════════════════════════════════════
//  ОБРАБОТЧИК INLINE КНОПОК
// ════════════════════════════════════════════════════════════

bot.on('callback_query', async query => {
    const id   = query.message.chat.id;
    const data = query.data;
    await bot.answerCallbackQuery(query.id);

    if (data === 'cancel') {
        clearState(id);
        bot.sendMessage(id, '❌ Отменено.', isAdmin(id) ? KB_ADMIN : KB_USER);
        return;
    }

    // Подтверждение записки
    if (data === 'note_confirm') {
        const st   = getState(id);
        const { type, resolved } = st.data;
        const genitives = resolved.map(r => r.gen);
        addNote(id, query.from.first_name, type, genitives);
        clearState(id);
        sendThanks(id, type, genitives);
        const label = TYPE_LABEL_FULL[type] || type;
        await notifyAdminsNote(label, genitives, query.from.first_name || '—');
        return;
    }

    // Выбор пола для неоднозначного имени
    if (data.startsWith('ambig_')) {
        const [, gender, idxStr] = data.split('_');
        const idx = parseInt(idxStr);
        const st  = getState(id);
        const { type, pending, resolved } = st.data;

        const item = pending[idx];
        const canonical = gender === 'm' ? item.ambig.male : item.ambig.female;
        const gen       = toGenitive(canonical);
        resolved.push({ original: item.original, canonical, gen, found: true });

        const nextIdx = idx + 1;
        if (nextIdx < pending.length) {
            // Следующее неоднозначное имя
            setState(id, 'NOTE_AMBIG', { type, pending, resolved });
            askAmbiguous(id, pending, nextIdx, type);
        } else {
            // Все разрешены — показываем подтверждение
            setState(id, 'NOTE_CONFIRM', { type, resolved });
            showConfirm(id, type, resolved);
        }
        return;
    }

    // Просмотр записок по типу
    if (data.startsWith('notes_')) {
        const type  = data.replace('notes_', '');
        const d     = loadData();
        const names = d[type] || [];
        const label = TYPE_LABEL_FULL[type] || type;
        if (!names.length) {
            bot.sendMessage(id, `${label}:\n\nЗаписок нет.`);
            return;
        }
        let text = `${label}:\n\n`;
        names.forEach((name, i) => { text += `${i + 1}. ${name}\n`; });
        bot.sendMessage(id, text);
        return;
    }

    // Очистить записки
    if (data === 'clear_yes') {
        db.zdravie = []; db.upokoj = []; db.bolash = []; db.putesh = [];
        db.panikhida = []; db.molebn = [];
        saveData(db); saveNotes([]);
        bot.sendMessage(id, '✅ Все записки очищены после службы.', KB_ADMIN);
        return;
    }
    if (data === 'clear_no') {
        bot.sendMessage(id, 'Отменено.', KB_ADMIN);
        return;
    }

    // ─── Кнопка «Помянул» ────────────────────────────────────────────────
    if (data.startsWith('pom_') && data !== 'pom_done') {
        const uid = data.slice(4);
        const cached = notesCache.get(uid);
        let editText;
        if (cached) {
            editText = `✅ <b>ПОМЯНУТО — ${cached.label}</b>

<s>${cached.namesFlat || cached.colsText}</s>

<i>От: ${cached.fromName}</i>`;
        } else {
            editText = `✅ <b>ПОМЯНУТО</b>`;
        }
        try {
            await bot.editMessageText(editText, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '✅ Помянуто', callback_data: 'pom_done' }]] }
            });
        } catch(e) { console.error('[pom] edit error:', e.message); }
        return;
    }
    if (data === 'pom_done') return;

    // ─── Мой список: быстрая подача ─────────────────────────────────────────
    if (data === 'mylist_zdravie' || data === 'mylist_upokoj') {
        const type = data === 'mylist_zdravie' ? 'zdravie' : 'upokoj';
        const p = getProfile(id);
        const names = p[type] || [];
        if (!names.length) { bot.sendMessage(id, '📋 Список пуст.', KB_USER); return; }
        addNote(id, query.from.first_name, type, names);
        const label = type === 'zdravie' ? 'о здравии' : 'об упокоении';
        const icon  = type === 'zdravie' ? '🙏' : '✝️';
        await notifyAdminsNote(TYPE_LABEL_FULL[type], names, (query.from.first_name || '—') + ' (мой список)');
        bot.sendMessage(id,
            `${icon} *Записка ${label} принята*\n\n${names.map(n => `• ${n}`).join('\n')}\n\nИмена будут помянуты на ближайшей службе.\n*Спаси вас Христос!* 🙏`,
            { parse_mode: 'Markdown', ...KB_USER });
        return;
    }

    if (data === 'mylist_edit') {
        setState(id, 'AWAIT_MYLIST_TYPE', {});
        bot.sendMessage(id,
            `✏️ *Редактирование списка*\n\nВыберите, какой список хотите изменить:`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                [{ text: '🙏 О здравии', callback_data: 'mylist_edit_zdravie' }],
                [{ text: '✝️ Об упокоении', callback_data: 'mylist_edit_upokoj' }],
                [{ text: '❌ Отмена', callback_data: 'cancel' }],
            ]}});
        return;
    }

    if (data === 'mylist_edit_zdravie' || data === 'mylist_edit_upokoj') {
        const type = data === 'mylist_edit_zdravie' ? 'zdravie' : 'upokoj';
        const label = type === 'zdravie' ? 'о здравии' : 'об упокоении';
        setState(id, 'AWAIT_MYLIST_NAMES', { type });
        bot.sendMessage(id,
            `✏️ Введите имена *${label}* — каждое с новой строки.\n\nЭто заменит ваш текущий список.\n\n/menu — отмена`,
            { parse_mode: 'Markdown' });
        return;
    }

    // ─── Сохранить список после записки ─────────────────────────────────────
    if (data.startsWith('save_list_')) {
        const [,, type, ...rest] = data.split('_');
        const names = rest.join('_').split(',');
        saveProfileList(id, type, names);
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: id, message_id: query.message.message_id
        }).catch(() => {});
        bot.sendMessage(id, `✅ Список сохранён! Теперь кнопка *📋 Мой список* подаст записку за всех одним нажатием. 🙏`,
            { parse_mode: 'Markdown', ...KB_USER });
        return;
    }
});

function askAmbiguous(chatId, pending, idx, type) {
    const item  = pending[idx];
    const label = type === 'zdravie' ? 'о здравии' : 'об упокоении';
    bot.sendMessage(chatId,
        `❓ Имя *«${item.original}»* — мужское или женское?`,
        { parse_mode: 'Markdown', ...inlineKb([
            [
                { text: `♂ ${item.ambig.male}`,   callback_data: `ambig_m_${idx}` },
                { text: `♀ ${item.ambig.female}`, callback_data: `ambig_f_${idx}` },
            ],
            [{ text: '❌ Отмена', callback_data: 'cancel' }]
        ])});
}

function showConfirm(chatId, type, resolved) {
    const label = TYPE_LABEL_FULL[type] || type;
    let namesText = '';
    const notFound = [];

    resolved.forEach(r => {
        if (!r.found) {
            notFound.push(r.original);
            namesText += `⚠️ ${r.gen}\n`;
        } else if (r.canonical.toLowerCase() !== r.original.toLowerCase()) {
            namesText += `✅ ${r.gen}  _← ${r.original}_\n`;
        } else {
            namesText += `✅ ${r.gen}\n`;
        }
    });

    const warning = notFound.length
        ? `\n_⚠️ Не найдено в святцах: ${notFound.join(', ')}. Запишем как есть._\n`
        : '';

    bot.sendMessage(chatId,
        `*${label}*\n\n${namesText}${warning}\nВсё верно?`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '✅ Подтвердить', callback_data: 'note_confirm' }],
            [{ text: '✏️ Ввести заново', callback_data: 'cancel' }],
        ]}});
}

// ════════════════════════════════════════════════════════════
//  ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ
// ════════════════════════════════════════════════════════════

bot.on('message', msg => {
    const id   = msg.chat.id;
    const msgType = msg.photo ? 'photo' : msg.document ? 'document' : msg.text ? 'text' :
        msg.video ? 'video' : msg.audio ? 'audio' : msg.voice ? 'voice' :
        msg.sticker ? 'sticker' : msg.animation ? 'animation' : msg.video_note ? 'video_note' : 'other';
    const keys = Object.keys(msg).filter(k => !['message_id','from','chat','date'].includes(k)).join(',');
    console.log(`[IN] id=${id} type=${msgType} step=${getState(id).step} keys=${keys}`);

    // ─── Документ в режиме ввода текста расписания ──────────────────────────
    if (isAdmin(id) && getState(id).step === 'AWAIT_SCHEDULE_TEXT' && msg.document) {
        const mime = msg.document.mime_type || '';
        if (mime === 'text/plain' || mime === '' || msg.document.file_name?.endsWith('.txt')) {
            // Скачиваем и читаем как текст
            bot.getFile(msg.document.file_id).then(fileInfo => {
                const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileInfo.file_path}`;
                const https = require('https');
                return new Promise((resolve, reject) => {
                    https.get(fileUrl, res => {
                        let data = '';
                        res.setEncoding('utf8');
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data));
                        res.on('error', reject);
                    }).on('error', reject);
                });
            }).then(fileText => {
                clearState(id);
                const html = buildScheduleHTML(fileText.trim());
                fs.writeFileSync(HTML_OUT, html, 'utf8');
                deployToGitHub('update schedule');
                bot.sendMessage(id, `✅ Расписание опубликовано!\n\n🌐 ${NETLIFY_URL}/schedule.html`, KB_ADMIN);
            }).catch(e => {
                console.error('[schedule_text] file read error:', e.message);
                bot.sendMessage(id, '❌ Не удалось прочитать файл: ' + e.message, KB_ADMIN);
            });
        } else {
            bot.sendMessage(id,
                `⚠️ Получен файл формата *${mime || 'неизвестный'}* — не могу прочитать.\n\n` +
                `Пожалуйста, отправьте текст расписания как обычное сообщение.\n\n` +
                `_Если Telegram вставляет файл вместо текста — сначала вставьте текст в Заметки, скопируйте оттуда и отправьте в бот._`,
                { parse_mode: 'Markdown' });
        }
        return;
    }

    // ─── Фото / документ / стикер от батюшки (расписание) ──────────────────
    if (isAdmin(id) && getState(id).step === 'AWAIT_SCHED_PHOTO') {
        let fileId   = null;
        let fileType = null;
        if (msg.photo) {
            fileId = msg.photo[msg.photo.length - 1].file_id;
            fileType = 'photo';
        } else if (msg.document) {
            fileId = msg.document.file_id;
            fileType = 'document';
        } else if (msg.sticker) {
            fileId = msg.sticker.file_id;
            fileType = 'sticker';
        } else if (msg.video) {
            fileId = msg.video.file_id;
            fileType = 'video';
        }
        if (fileId) {
            clearState(id);
            const s = loadSchedule();
            s.photoFileId = fileId;
            s.fileType    = fileType;
            saveSchedule(s);
            console.log(`[schedule] saved type=${fileType} fileId=${fileId}`);
            bot.sendMessage(id, '✅ Расписание сохранено! Прихожане увидят его по кнопке «📅 Расписание».', KB_ADMIN);
            return;
        }
        if (msg.text && !msg.text.startsWith('/')) {
            bot.sendMessage(id, '⚠️ Пришлите фото расписания (скрепка → галерея). /menu — отмена');
            return;
        }
    }

    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return;

    // Ввод расписания (admin режим)
    if (awaitingSchedule[id]) {
        const day = parseDay(text);
        if (!day) {
            bot.sendMessage(id, '⚠️ Не понял формат. Попробуйте:\n`1 мая чт | Прп. Иоанна | 8:40 Литургия`', { parse_mode: 'Markdown' });
            return;
        }
        const s = loadSchedule();
        s.days.push(day);
        saveSchedule(s);
        bot.sendMessage(id, `✓ ${day.date} ${day.month} (${day.dayOfWeek}) — добавлено`);
        return;
    }

    // Отмена — для всех пользователей из любого состояния
    if (text === '❌ Отмена') {
        clearState(id);
        bot.sendMessage(id, '❌ Отменено.', isAdmin(id) ? KB_ADMIN : KB_USER);
        return;
    }

    // Кнопки пользователя
    if (text === '🙏 О здравии')          { startNote(id, 'zdravie');   return; }
    if (text === '✝️ Об упокоении')        { startNote(id, 'upokoj');    return; }
    if (text === '🤒 О болящих')           { startNote(id, 'bolash');    return; }
    if (text === '✈️ О путешествующих')    { startNote(id, 'putesh');    return; }
    if (text === '🕯 Панихида')            { startNote(id, 'panikhida'); return; }
    if (text === '🙏 Молебен')             { startNote(id, 'molebn');    return; }
    if (text === '📅 Расписание')          { showSchedule(id); return; }
    if (text === '🗓 Календарь')          { showCalendar(id); return; }
    if (text === '📋 Мой список')         { showMyList(id); return; }
    if (text === 'ℹ️ О храме')            { showAbout(id); return; }
    if (text === '💳 Пожертвование') {
        bot.sendMessage(id,
            `💳 *Пожертвование на храм*\n\n` +
            `Перевод через СберБанк Онлайн:\n` +
            `[Нажмите здесь для перевода](https://messenger.online.sberbank.ru/sl/G11bjkOBTlCp7iypZ)\n\n` +
            `Или по номеру телефона:\n*${DONATION_PHONE}*\n` +
            `Получатель: ${DONATION_NAME}\n` +
            `Назначение: «${DONATION_NOTE}»\n\n` +
            `_Спаси вас Господи! 🙏_`,
            { parse_mode: 'Markdown', ...KB_USER });
        return;
    }

    // Кнопки admin
    if (isAdmin(id)) {
        if (text === '⛪ Служба')   { showServiceMode(id); return; }
        if (text === '📋 Записки') { showNotes(id); return; }
        if (text === '📤 Скачать список') { exportNotes(id); return; }
        if (text === '🗑 Очистить после службы') {
            bot.sendMessage(id, 'Вы уверены? Все записки будут удалены.',
                inlineKb([[
                    { text: '✅ Да, очистить', callback_data: 'clear_yes' },
                    { text: '❌ Отмена',       callback_data: 'clear_no'  },
                ]]));
            return;
        }
        if (text === '📢 Объявление') {
            setState(id, 'AWAIT_ANNOUNCE_FEAST', {});
            bot.sendMessage(id,
                '📢 *Объявление в группу*\n\nВведите название праздника или службы:\n\n_Пример:_\n`Воскресную Литургию в день святых отцов 1-го Вселенского Собора`\n\n/menu — отмена',
                { parse_mode: 'Markdown', ...inlineKb([[{ text: '❌ Отмена', callback_data: 'cancel' }]]) });
            return;
        }
        if (text === '🔗 Ссылки прихода') {
            const isAdm = isAdmin(id);
            const userLinks = [
                [{ text: '🌐 Сайт прихода',            url: `${NETLIFY_URL}` }],
                [{ text: '📅 Расписание богослужений',  url: `${NETLIFY_URL}/schedule.html` }],
                [{ text: '🕯 Подать на Панихиду',       url: `${NETLIFY_URL}/#panikhida` }],
                [{ text: '🌿 Открытки к празднику',     url: `${NETLIFY_URL}/#cards` }],
                [{ text: '💳 Пожертвование',             url: `${NETLIFY_URL}/#donate` }],
            ];
            const adminLinks = [
                [{ text: '🖨 QR-код для притвора',      url: `${NETLIFY_URL}/qr.html` }],
                [{ text: '📄 Предложение Владыке',      url: `${NETLIFY_URL}/proposal.html` }],
            ];
            bot.sendMessage(id,
                `🔗 *Ссылки прихода*\n\n_Нажмите на любую — откроется в браузере_`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: isAdm ? [...userLinks, ...adminLinks] : userLinks },
                });
            return;
        }
        if (text === '📊 Статистика открыток') {
            const stats = loadCardStats();
            const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
            if (!entries.length) {
                bot.sendMessage(id, '📊 Открытки ещё никто не скачивал.', KB_ADMIN);
                return;
            }
            const total = entries.reduce((s, [, n]) => s + n, 0);
            const lines = entries.map(([card, n], i) =>
                `${i + 1}. ${card.replace(/^.*\//, '')} — ${n} раз`
            );
            bot.sendMessage(id,
                `📊 *Статистика открыток*\n\nВсего скачиваний: *${total}*\n\n` + lines.join('\n'),
                { parse_mode: 'Markdown', ...KB_ADMIN });
            return;
        }

        if (text === '📋 Новое расписание') {
            setState(id, 'AWAIT_SCHED_PHOTO', {});
            bot.sendMessage(id, '📅 Пришлите фото расписания — я его сохраню и покажу прихожанам.\n\n/menu — отмена');
            return;
        }
        if (text === '🗓 HTML расписания') {
            setState(id, 'AWAIT_SCHEDULE_TEXT', {});
            bot.sendMessage(id, '🗓 Пришлите текст расписания — я оформлю его красивой таблицей и опубликую на сайте.\n\nПросто скопируйте текст и отправьте в одном сообщении.\n\n/menu — отмена');
            return;
        }
    }

    // Ввод имён для «Моего списка»
    const st = getState(id);
    if (st.step === 'AWAIT_MYLIST_NAMES') {
        const type  = st.data.type;
        const lines = parseNameLines(text);
        if (!lines.length) { bot.sendMessage(id, '⚠️ Введите хотя бы одно имя.'); return; }
        const names = lines.map(w => {
            const c = findCanonical(w);
            return c ? toGenitive(c) : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        });
        saveProfileList(id, type, names);
        clearState(id);
        const label = type === 'zdravie' ? 'о здравии' : 'об упокоении';
        bot.sendMessage(id,
            `✅ Список *${label}* сохранён!\n\n${names.map(n => `• ${n}`).join('\n')}\n\nТеперь кнопка *📋 Мой список* подаст записку за всех одним нажатием. 🙏`,
            { parse_mode: 'Markdown', ...KB_USER });
        return;
    }

    // Состояние объявления — ввод названия праздника (admin)
    if (st.step === 'AWAIT_ANNOUNCE_FEAST' && isAdmin(id)) {
        clearState(id);
        const announcement = buildAnnouncement(text);

        // Отправляем в группу в раздел «Жизнь прихода»
        bot.sendMessage(ANNOUNCE_CHAT_ID, announcement, {
            message_thread_id: ANNOUNCE_THREAD_ID,
        }).then(() => {
            bot.sendMessage(id,
                `✅ *Объявление опубликовано* в разделе «Жизнь прихода»!\n\n` +
                `Текст для других групп (WhatsApp и т.д.) 👇`,
                { parse_mode: 'Markdown', ...KB_ADMIN });
            bot.sendMessage(id, announcement);
        }).catch(err => {
            // Если бот не в группе или нет прав — даём текст для ручной отправки
            console.error('[announce] group send error:', err.message);
            bot.sendMessage(id,
                `⚠️ *Не удалось отправить в группу автоматически.*\n\n` +
                `Возможные причины:\n` +
                `— бот ещё не добавлен в группу\n` +
                `— нет прав на отправку\n\n` +
                `Скопируйте текст ниже и отправьте вручную 👇`,
                { parse_mode: 'Markdown', ...KB_ADMIN });
            bot.sendMessage(id, announcement);
        });
        return;
    }

    // Состояние ввода текста расписания (admin)
    if (st.step === 'AWAIT_SCHEDULE_TEXT' && isAdmin(id)) {
        clearState(id);
        try {
            const html = buildScheduleHTML(text);
            fs.writeFileSync(HTML_OUT, html, 'utf8');
            deployToGitHub('update schedule');
            bot.sendMessage(id, `✅ Расписание опубликовано!\n\n🌐 ${NETLIFY_URL}/schedule.html`, KB_ADMIN);
        } catch(e) {
            bot.sendMessage(id, '❌ Ошибка: ' + e.message, KB_ADMIN);
        }
        return;
    }

    // Состояние ввода имён
    if (st.step === 'NOTE_NAMES') {
        const lines = parseNameLines(text);
        if (!lines.length) { bot.sendMessage(id, '⚠️ Введите хотя бы одно имя.'); return; }

        const resolved = [];
        const pending  = [];

        lines.forEach(word => {
            const key   = word.toLowerCase().trim().replace(/ё/g, 'е');
            const ambig = AMBIGUOUS[key];
            if (ambig) {
                pending.push({ original: word, ambig });
            } else {
                const canonicalFound = findCanonical(word);
                const canonical = canonicalFound || (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
                const gen       = toGenitive(canonical);
                resolved.push({ original: word, canonical, gen, found: !!canonicalFound });
            }
        });

        if (pending.length > 0) {
            setState(id, 'NOTE_AMBIG', { type: st.data.type, pending, resolved });
            askAmbiguous(id, pending, 0, st.data.type);
        } else {
            setState(id, 'NOTE_CONFIRM', { type: st.data.type, resolved });
            showConfirm(id, st.data.type, resolved);
        }
        return;
    }
});

function startNote(chatId, type) {
    setState(chatId, 'NOTE_NAMES', { type });
    const label = TYPE_LABEL_SHORT[type] || type;
    bot.sendMessage(chatId,
        `📝 Записка *${label}*\n\nВведите имена — каждое на новой строке:\n\n_Пример:_\nИван\nМария\nОлег`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['❌ Отмена']],
                resize_keyboard: true,
                one_time_keyboard: false,
            }
        });
}


// ════════════════════════════════════════════════════════════
//  РАСПИСАНИЕ — КОМАНДЫ ADMIN
// ════════════════════════════════════════════════════════════

bot.onText(/\/новый_месяц(?:\s+(.+))?/, (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const month = (match[1] || 'Месяц не указан').trim();
    saveSchedule({ month, days: [] });
    awaitingSchedule[msg.chat.id] = true;
    bot.sendMessage(msg.chat.id,
        `📅 *Новое расписание: ${month}*\n\nВводите каждый день отдельным сообщением:\n\n\`1 мая чт | Прп. Иоанна | 8:40 Литургия | 17:00 Вечерня\`\n\nКогда закончите — /готово`,
        { parse_mode: 'Markdown' });
});

bot.onText(/\/готово/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id) || !awaitingSchedule[id]) return;
    delete awaitingSchedule[id];
    const s = loadSchedule();
    bot.sendMessage(id, `✅ Расписание сохранено: ${s.days.length} дней.\n\nОтправьте /html_месяц чтобы обновить страницу.`);
});

bot.onText(/\/html_месяц/, msg => {
    const id = msg.chat.id;
    if (!isAdmin(id)) return;
    const s = loadSchedule();
    if (!s.days || !s.days.length) { bot.sendMessage(id, '⚠️ Расписание пустое.'); return; }
    try {
        const html = generateScheduleHTML(s);
        fs.writeFileSync(HTML_OUT, html, 'utf8');
        bot.sendMessage(id, `✅ HTML расписание обновлено!\n📅 ${s.month} — ${s.days.length} дней`);
    } catch(e) {
        bot.sendMessage(id, '❌ Ошибка: ' + e.message);
    }
});

// ─── Парсинг дня расписания ──────────────────────────────────────────────────
function parseDay(line) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) return null;
    const m = parts[0].match(/^(\d{1,2})\s+(\S+)\s+(\S+)(.*)?$/);
    if (!m) return null;
    const date = m[1], month = m[2], dayShort = m[3].toLowerCase();
    const flags = (m[4] || '').toLowerCase();
    const dayMap = { пн:'Понедельник',вт:'Вторник',ср:'Среда',чт:'Четверг',пт:'Пятница',сб:'Суббота',вс:'Воскресенье' };
    const dayOfWeek = dayMap[dayShort] || dayShort;
    let type = 'weekday';
    if (dayShort === 'вс') type = 'sunday';
    else if (dayShort === 'сб') type = 'saturday';
    if (flags.includes('праздник')) type = 'feast';
    let feastName = null, saints = '', svcStart = 2;
    if (type === 'feast' && parts.length > 3) { feastName = parts[1]; saints = parts[2] || ''; svcStart = 3; }
    else { saints = parts[1]; }
    const services = [];
    for (let i = svcStart; i < parts.length; i++) {
        const sm = parts[i].match(/^(\d{1,2}:\d{2})\s+(.+)$/);
        if (sm) services.push({ time: sm[1], desc: sm[2] });
    }
    return { date, month, dayOfWeek, type, feastName, saints, services };
}

// ─── HTML расписания ─────────────────────────────────────────────────────────
function generateScheduleHTML(schedule) {
    function rowClass(type) {
        return { feast:'great-feast', sunday:'sunday', saturday:'saturday', special:'special' }[type] || 'weekday';
    }
    const rows = (schedule.days || []).map(day => {
        const rc = rowClass(day.type);
        const isRed = day.type === 'feast' || day.type === 'sunday';
        const rowCount = day.services.length || 1;
        const saintHtml = day.feastName
            ? `<span class="feast-title">✦ ${day.feastName} ✦</span><span class="saints-text">${day.saints}</span>`
            : `<span class="saints-text">${day.saints}</span>`;
        const dayCell   = `<td class="col-day" rowspan="${rowCount}"><span class="day-name">${day.dayOfWeek}</span><span class="day-date">${day.date} ${day.month}</span></td>`;
        const saintCell = `<td class="col-saints" rowspan="${rowCount}">${saintHtml}</td>`;
        if (!day.services.length) return `<tr class="${rc}">${dayCell}${saintCell}<td></td><td></td></tr>`;
        return day.services.map((svc, i) => {
            const cells = i === 0
                ? `${dayCell}${saintCell}<td class="col-time">${svc.time}</td><td>${svc.desc}</td>`
                : `<td class="col-time">${svc.time}</td><td>${svc.desc}</td>`;
            return `<tr class="${rc}">${cells}</tr>`;
        }).join('\n');
    }).join('\n');

    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Расписание — ${CHURCH}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#c8a45a;font-family:Georgia,serif;display:flex;justify-content:center;padding:20px;min-height:100vh}
.page{background:#f5e6c0;width:860px;max-width:100%;border:5px solid #8B6914;box-shadow:0 0 40px rgba(0,0,0,.5)}
.inner{border:2px solid #c9a84c;margin:8px;padding:24px 20px 20px}
.header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.photo-box{width:150px;min-width:150px;height:175px;border:3px solid #8B6914;border-radius:50% 50% 8px 8px/55% 55% 8px 8px;overflow:hidden;background:#e0c88a}
.photo-box img{width:100%;height:100%;object-fit:cover;object-position:center top;display:block}
.header-center{flex:1;text-align:center}
.church-name{font-size:24px;font-weight:bold;color:#2c1400;line-height:1.35;margin-bottom:8px}
.month-label{font-size:17px;color:#8B1A1A;font-style:italic}
.divider{display:flex;align-items:center;gap:10px;margin:14px 0;color:#8B6914}
.divider::before,.divider::after{content:'';flex:1;height:2px;background:linear-gradient(to right,transparent,#c9a84c,transparent)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td{border:1px solid #c9a84c;padding:8px 9px;vertical-align:top}
.col-day{width:90px;text-align:center;font-weight:bold;vertical-align:middle}
.col-saints{width:270px}.col-time{width:55px;text-align:center;font-weight:bold;white-space:nowrap;vertical-align:middle}
tr.weekday{background:#fdf6e0}tr.saturday{background:#f7edd0}tr.sunday{background:#fff4c8}tr.great-feast{background:#ffe4b0}
tr.sunday .day-name,tr.sunday .saints-text{color:#8B1A1A}
tr.great-feast .day-name,.feast-title,.great-feast .col-time{color:#8B1A1A;font-weight:bold}
.day-name{font-size:14px;display:block}.day-date{font-size:12px;color:#777;display:block;margin-top:2px}
.saints-text{font-style:italic;color:#3a2000}.feast-title{display:block;font-style:normal;font-weight:bold;color:#8B1A1A;margin-bottom:2px}
.footer{text-align:center;padding:14px 0 4px;font-size:13px;color:#6b4c00;line-height:2}
</style></head><body>
<div class="page"><div class="inner">
<div class="header">
  <div class="photo-box"><img src="church.jpg" alt="Храм" onerror="this.parentElement.style.background='#e0c88a'"></div>
  <div class="header-center">
    <div style="font-size:32px;color:#8B6914;margin-bottom:8px">☩</div>
    <div class="church-name">${CHURCH}</div>
    <div class="month-label">Расписание богослужений — ${schedule.month}</div>
  </div>
  <div style="width:80px;text-align:center;font-size:36px;color:#8B6914">✞</div>
</div>
<div class="divider"><span>☩</span></div>
<table>${rows}</table>
<div class="divider" style="margin-top:16px"><span>☩</span></div>
<div class="footer">
  💳 Пожертвование: перевод по номеру <strong>${DONATION_PHONE}</strong> — ${DONATION_NAME}
</div>
</div></div></body></html>`;
}

// ─── HTTP для сайта ──────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
});

// ════════════════════════════════════════════════════════════
//  ПАРСЕР ТЕКСТОВОГО РАСПИСАНИЯ → HTML
// ════════════════════════════════════════════════════════════

function parseScheduleText(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const DAY_RE = /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресень[ея]|воскресение)/i;
    const MONTHS = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
    const DATE_RE = new RegExp(`^\\d{1,2}\\s+(${MONTHS})$`, 'i');
    const TIME_RE = /^\d{1,2}:\d{2}$/;
    const FESTIVE_RE = /литурги[яи]|всенощн|вознесени|праздничн|воскресн/i;

    let title = '', week = '';
    const days = [];
    let i = 0;

    if (i < lines.length) title = lines[i++];
    if (i < lines.length && !DAY_RE.test(lines[i])) week = lines[i++];

    let curDay = null;
    let saintBuf = [];
    let timeBuf = null;
    let svcBuf = [];

    function flushService() {
        if (timeBuf !== null && curDay) {
            const desc = svcBuf.join(' ');
            curDay.services.push({ time: timeBuf, desc, festive: FESTIVE_RE.test(desc) });
        }
        timeBuf = null; svcBuf = [];
    }
    function flushSaints() {
        if (curDay && saintBuf.length) {
            curDay.saints.push(saintBuf.join(' '));
            saintBuf = [];
        }
    }

    while (i < lines.length) {
        const line = lines[i++];

        if (DAY_RE.test(line)) {
            flushService(); flushSaints();
            curDay = { name: line, saints: [], services: [] };
            days.push(curDay);
            continue;
        }
        if (DATE_RE.test(line) && curDay && !/\d/.test(curDay.name)) {
            curDay.name += ' ' + line;
            continue;
        }
        if (TIME_RE.test(line)) {
            flushService(); flushSaints();
            timeBuf = line;
            continue;
        }
        if (timeBuf !== null) {
            svcBuf.push(line);
        } else if (curDay) {
            saintBuf.push(line);
        }
    }
    flushService(); flushSaints();

    return { title, week, days };
}

function buildScheduleHTML(rawText) {
    const { title, week, days } = parseScheduleText(rawText);
    const SUN_RE = /воскресень[ея]|воскресение/i;

    let rows = '';
    for (const day of days) {
        const isSun = SUN_RE.test(day.name);
        const totalRows = day.saints.length + day.services.length || 1;
        const nameParts = day.name.replace(/(\d)/, '<br>$1');
        const dayCls = isSun ? 'day sunday' : 'day';
        let first = true;

        const addDayCell = () => {
            if (first) {
                rows += `<tr class="day-start"><td class="${dayCls}" rowspan="${totalRows}">${nameParts}</td>`;
                first = false;
            } else {
                rows += '<tr>';
            }
        };

        for (const saint of day.saints) {
            addDayCell();
            const sCls = isSun ? 'saint red' : 'saint';
            rows += `<td colspan="2" class="${sCls}"><em>${saint}</em></td></tr>\n`;
        }
        for (const svc of day.services) {
            addDayCell();
            const fCls = svc.festive ? ' red' : '';
            rows += `<td class="time${fCls}">${svc.time}</td>`;
            rows += `<td class="svc${fCls}">${svc.desc}</td></tr>\n`;
        }
        if (first) {
            rows += `<tr><td class="${dayCls}">-</td><td></td><td></td></tr>\n`;
        }
    }

    return `<!DOCTYPE html><html lang="ru"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Храм Рождества Христова</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',serif;background:#f0ebe0;padding:12px}
.wrap{max-width:700px;margin:0 auto;background:#fff;border:2px solid #2E6B2E;border-radius:6px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.15)}
/* ── Шапка ── */
.header{background:#2E6B2E;color:#fff;display:flex;align-items:center;gap:14px;padding:14px 16px}
.header-photo{width:78px;height:78px;min-width:78px;border-radius:50%;overflow:hidden;border:2px solid rgba(255,255,255,.6);box-shadow:0 0 0 3px rgba(255,255,255,.18)}
.header-photo img{width:100%;height:100%;object-fit:cover;object-position:center 55%;display:block}
.header-text{flex:1;text-align:center}
.header-cross{font-size:18px;margin-bottom:2px;opacity:.85}
.header-church{font-size:17px;font-weight:bold;letter-spacing:.5px;margin-bottom:4px;line-height:1.25}
.header-title{font-size:13px;opacity:.88;margin-bottom:3px;font-style:italic}
.header-week{font-size:12px;opacity:.75;font-style:italic}
/* ── Строка контактов ── */
.contacts{background:#245a24;color:#d4f0d4;display:flex;justify-content:center;align-items:center;gap:20px;padding:7px 14px;font-size:12.5px;flex-wrap:wrap}
.contacts a{color:#d4f0d4;text-decoration:none}
.contacts a:hover{color:#fff}
/* ── Таблица ── */
table{width:100%;border-collapse:collapse}
td{border:1px solid #c5d9c5;padding:8px 9px;vertical-align:middle}
td.day{width:23%;text-align:left;padding:8px 7px;border:1px solid #2E6B2E;font-size:13px;line-height:1.5;font-weight:bold;color:#1a4d1a;vertical-align:middle}
td.day.sunday{color:#8B0000;background:#fff9f0}
td.saint{border:1px solid #c5d9c5;font-size:12.5px;color:#444;text-align:center;background:#fafff8;padding:7px;font-style:italic}
td.saint.red{color:#8B0000;background:#fff8f5}
td.time{width:11%;text-align:center;padding:6px 4px;border:1px solid #c5d9c5;font-size:13px;font-weight:bold;color:#1a4d1a;white-space:nowrap}
td.time.red{color:#8B0000}
td.svc{padding:6px 9px;border:1px solid #c5d9c5;font-size:13px;color:#222}
td.svc.red{color:#8B0000;font-weight:bold}
tr.day-start td{border-top:2px solid #2E6B2E}
/* ── Подвал ── */
.footer{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;font-size:12px;color:#555;border-top:2px solid #2E6B2E;background:#f6faf6;flex-wrap:wrap;gap:4px}
.footer-church{font-weight:bold;color:#2E6B2E}
/* ── Кнопки ── */
.btns{display:flex;gap:10px;justify-content:center;margin:10px auto 2px;flex-wrap:wrap}
.btn{padding:7px 20px;border:none;border-radius:4px;font-size:13px;cursor:pointer;font-family:inherit;font-weight:bold}
.btn-print{background:#2E6B2E;color:#fff}
.btn-print:hover{background:#245a24}
.btn-share{background:#fff;color:#2E6B2E;border:2px solid #2E6B2E}
.btn-share:hover{background:#f0faf0}
@media print{
  body{background:#fff;padding:0}
  .wrap{box-shadow:none;border-radius:0}
  .btns{display:none}
}
@media(max-width:480px){
  .header-photo{width:56px;height:56px;min-width:56px}
  .header-church{font-size:14px}
  .contacts{gap:10px;font-size:11.5px}
  td{padding:5px;font-size:12px}
}
</style></head><body>
<div class="wrap">

<div class="header">
  <div class="header-photo">
    <img src="h1.jpg" alt="Храм" onerror="this.style.display='none'">
  </div>
  <div class="header-text">
    <div class="header-cross">✞</div>
    <div class="header-church">Храм Рождества Христова</div>
    <div class="header-title">${title}</div>
    <div class="header-week">${week}</div>
  </div>
</div>

<div class="contacts">
  <span>⛪ пос. Айхал, Республика Саха (Якутия)</span>
  <span>Настоятель: иерей Иоанн Серкин &nbsp;·&nbsp; <a href="tel:+79244605220">+7 (924) 460-52-20</a></span>
</div>

<table>
${rows}</table>

<div class="footer">
  <span class="footer-church">Храм Рождества Христова</span>
  <span>пос. Айхал</span>
</div>
</div>

<div class="btns">
  <button class="btn btn-print" onclick="window.print()">🖨 Распечатать</button>
  <button class="btn btn-share" onclick="shareSchedule()">📤 Поделиться</button>
</div>

<script>
function shareSchedule() {
  const url = window.location.href;
  const title = 'Расписание богослужений — Храм Рождества Христова, пос. Айхал';
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      alert('Ссылка скопирована!\\nВставьте её в сообщение.');
    }).catch(() => {
      prompt('Скопируйте ссылку:', url);
    });
  }
}
</script>
</body></html>`;
}

app.post('/zapiski', (req, res) => {
    const { type, names } = req.body;
    if (!type || !names?.length) return res.status(400).json({ ok: false });
    addNote(null, 'сайт', type, names);
    const label = TYPE_LABEL_FULL[type] || type;
    notifyAdminsNote(label, names, 'сайт');
    res.json({ ok: true });
});

app.post('/clear', (req, res) => {
    db.zdravie = []; db.upokoj = []; db.bolash = []; db.putesh = [];
    db.panikhida = []; db.molebn = [];
    saveData(db); saveNotes([]);
    notifyAdmins('🗑 Записки очищены через сайт после службы.');
    res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Статистика скачиваний открыток ──────────────────────────
const CARD_STATS_FILE = path.join(__dirname, 'card-stats.json');

function loadCardStats() {
    try { return JSON.parse(fs.readFileSync(CARD_STATS_FILE, 'utf8')); }
    catch { return {}; }
}

app.post('/cards/track', (req, res) => {
    const card = req.query.card;
    if (!card) return res.json({ ok: false });
    const stats = loadCardStats();
    stats[card] = (stats[card] || 0) + 1;
    fs.writeFileSync(CARD_STATS_FILE, JSON.stringify(stats, null, 2));
    res.json({ ok: true, count: stats[card] });
});

app.get('/cards/stats', (req, res) => {
    res.json(loadCardStats());
});

app.post('/question', async (req, res) => {
    const { name, text } = req.body || {};
    if (!text) return res.json({ ok: false });
    const msg = `✉️ *Вопрос батюшке*\n\n*От:* ${name || 'Прихожанин'}\n\n${text}`;
    const cfg = loadConfig();
    for (const adminId of cfg.adminIds) {
        await bot.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => {});
    }
    res.json({ ok: true });
});

app.listen(3001, () => console.log('HTTP на порту 3001'));

// ─── Экспорт записок (admin) ─────────────────────────────────────────────────
function exportNotes(chatId) {
    const d = loadData();
    const total = d.zdravie.length + d.upokoj.length + d.bolash.length + d.putesh.length +
        (d.panikhida||[]).length + (d.molebn||[]).length;

    if (!total) {
        bot.sendMessage(chatId, '📋 Записок пока нет — нечего скачивать.', KB_ADMIN);
        return;
    }

    const date = new Date().toLocaleDateString('ru-RU');
    let txt = `ЗАПИСКИ — ${date}\n${'═'.repeat(30)}\n\n`;

    if (d.zdravie.length) {
        txt += `🙏 О ЗДРАВИИ (${d.zdravie.length}):\n`;
        d.zdravie.forEach((n, i) => txt += `${i + 1}. ${n}\n`);
        txt += '\n';
    }
    if (d.upokoj.length) {
        txt += `✝️ ОБ УПОКОЕНИИ (${d.upokoj.length}):\n`;
        d.upokoj.forEach((n, i) => txt += `${i + 1}. ${n}\n`);
        txt += '\n';
    }
    if (d.bolash.length) {
        txt += `🤒 О БОЛЯЩИХ (${d.bolash.length}):\n`;
        d.bolash.forEach((n, i) => txt += `${i + 1}. ${n}\n`);
        txt += '\n';
    }
    if (d.putesh.length) {
        txt += `✈️ О ПУТЕШЕСТВУЮЩИХ (${d.putesh.length}):\n`;
        d.putesh.forEach((n, i) => txt += `${i + 1}. ${n}\n`);
        txt += '\n';
    }
    if ((d.panikhida||[]).length) {
        txt += `🕯 ПАНИХИДА (${d.panikhida.length}):\n`;
        d.panikhida.forEach((n, i) => txt += `${i + 1}. ${n}\n`);
        txt += '\n';
    }
    if ((d.molebn||[]).length) {
        txt += `🙏 МОЛЕБЕН (${d.molebn.length}):\n`;
        d.molebn.forEach((n, i) => txt += `${i + 1}. ${n}\n`);
        txt += '\n';
    }
    txt += `${'─'.repeat(30)}\nВсего: ${total} имён`;

    const buf = Buffer.from(txt, 'utf8');
    const filename = `zapiski_${date.replace(/\./g, '_')}.txt`;
    bot.sendDocument(chatId, buf, { caption: `📋 Записки — ${total} имён`, ...KB_ADMIN },
        { filename, contentType: 'text/plain' });
}

// ─── Бэкап данных ────────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function runDailyBackup(now) {
    try {
        const { execSync } = require('child_process');
        const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const backupPath = path.join(BACKUP_DIR, `backup_${dateStr}.zip`);

        // Собираем все важные файлы данных
        const filesToBackup = [DATA_FILE, NOTES_FILE, SCHEDULE_FILE, CONFIG_FILE]
            .filter(f => fs.existsSync(f));

        execSync(`zip -j "${backupPath}" ${filesToBackup.map(f => `"${f}"`).join(' ')}`);

        // Ротация: удаляем бэкапы старше 30 дней
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        fs.readdirSync(BACKUP_DIR).forEach(file => {
            const fp = path.join(BACKUP_DIR, file);
            if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
        });

        // Отправляем бэкап в Telegram каждому админу
        const d = loadData();
        const total = d.zdravie.length + d.upokoj.length + d.bolash.length + d.putesh.length;
        const zipBuf = fs.readFileSync(backupPath);
        const filename = `backup_${dateStr}.zip`;
        const caption = `💾 *Резервная копия данных — ${dateStr}*\n\nАрхив содержит все записки и настройки.\nВсего имён в базе: *${total}*`;

        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        for (const adminId of (config.adminIds || [])) {
            await bot.sendDocument(adminId, zipBuf,
                { caption, parse_mode: 'Markdown' },
                { filename, contentType: 'application/zip' }
            ).catch(e => console.error('[backup] send to', adminId, e.message));
        }
        console.log('[backup] done:', backupPath);
    } catch (e) {
        console.error('[backup] failed:', e.message);
    }
}

// ─── Итог дня (ежедневно в 22:00 по Якутску = 13:00 UTC) ────────────────────
let lastSummaryDate = '';
setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== DAILY_SUMMARY_HOUR_UTC || now.getUTCMinutes() !== 0) return;
    const dateKey = now.toDateString();
    if (lastSummaryDate === dateKey) return; // уже отправляли сегодня
    lastSummaryDate = dateKey;

    const d = loadData();
    const total = d.zdravie.length + d.upokoj.length + d.bolash.length + d.putesh.length;

    const notes = loadNotes();
    const todayStr = now.toLocaleDateString('ru-RU');
    const todayCount = notes.filter(n => {
        const nd = new Date(n.date);
        return nd.toDateString() === dateKey;
    }).length;

    if (total) {
        await notifyAdmins(
            `📊 *Итог дня — ${todayStr}*\n\n` +
            `🙏 О здравии: *${d.zdravie.length}* имён\n` +
            `✝️ Об упокоении: *${d.upokoj.length}* имён\n` +
            `🤒 О болящих: *${d.bolash.length}* имён\n` +
            `✈️ О путешествующих: *${d.putesh.length}* имён\n\n` +
            `Записок сегодня: *${todayCount}*\n` +
            `Всего накоплено: *${total}* имён`,
            { parse_mode: 'Markdown' }
        );
    }

    // Ежедневный бэкап — всегда, даже если записок нет
    await runDailyBackup(now);
}, 60 * 1000); // проверяем каждую минуту

console.log(`✞ Бот ${CHURCH} — запущен`);
bot.on('polling_error', err => console.error('Polling error:', err.message));
