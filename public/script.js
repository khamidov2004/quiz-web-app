// =============================================
//  QUIZ AUTOMATION BOT — Full Script (Fixed)
// =============================================

const ADMIN_PASSWORD = "Khamidov_2004";
const STORAGE_KEY = "quiz_bot_data";

// State
let currentQuizId = null;
let quizQuestions = [];
let qIndex = 0;
let score = 0;
let selectedCount = 10;
let selectedMode = 'mashq';
const LETTERS = ['A','B','C','D','E','F','G','H'];

// Shared database state
let cachedQuizzes = [];
let adminPasswordUsed = "";

// HTML Escaper
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// DOM helpers
const $ = id => document.getElementById(id);
const ui = {
    home:       $('home-screen'),
    adminLogin: $('admin-login-screen'),
    admin:      $('admin-screen'),
    settings:   $('settings-screen'),
    quiz:       $('quiz-screen'),
    result:     $('result-screen'),
    loading:    $('loading-overlay'),
    status:     $('upload-status'),
    file:       $('file-input'),
};

// ============================
// SCREEN NAVIGATION
// ============================
function showScreen(screen) {
    [ui.home, ui.adminLogin, ui.admin, ui.settings, ui.quiz, ui.result].forEach(s => {
        if (s) {
            s.classList.remove('active');
            s.classList.add('hidden');
        }
    });
    if (screen) {
        screen.classList.remove('hidden');
        screen.classList.add('active');
    }
}

// Helper to show screens
function showScreenById(id) {
    showScreen($(id));
}

// ============================
// BACKEND API & CACHE
// ============================
async function syncQuizzes() {
    try {
        const res = await fetch('/api/quizzes');
        if (res.ok) {
            cachedQuizzes = await res.json();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedQuizzes));
        } else {
            throw new Error("API responded with error status");
        }
    } catch(e) {
        console.warn("Backend serverga bog'lanishda muammo (localStorage fallback):", e);
        try {
            cachedQuizzes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch(err) {
            cachedQuizzes = [];
        }
    }
}

function getQuizzes() {
    return cachedQuizzes;
}

async function addQuiz(name, questions) {
    const newQuiz = {
        id: Date.now().toString(),
        name: name,
        questions: questions,
        createdAt: new Date().toLocaleDateString('uz-UZ')
    };

    // Optimistic local update
    cachedQuizzes.push(newQuiz);
    renderHome();
    renderAdminQuizList();

    try {
        const res = await fetch('/api/quizzes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-password': adminPasswordUsed
            },
            body: JSON.stringify({ name, questions })
        });
        if (res.ok) {
            const savedQuiz = await res.json();
            const idx = cachedQuizzes.findIndex(q => q.id === newQuiz.id);
            if (idx !== -1) cachedQuizzes[idx] = savedQuiz;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedQuizzes));
        } else {
            throw new Error("Server testni saqlay olmadi");
        }
    } catch(e) {
        console.warn("Serverda saqlash bajarilmadi (localStorage-da saqlandi):", e);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedQuizzes));
    }
}

async function deleteQuiz(id) {
    cachedQuizzes = cachedQuizzes.filter(q => q.id !== id);
    renderHome();
    renderAdminQuizList();

    try {
        const res = await fetch(`/api/quizzes/${id}`, {
            method: 'DELETE',
            headers: {
                'x-admin-password': adminPasswordUsed
            }
        });
        if (res.ok) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedQuizzes));
        } else {
            throw new Error("Server testni o'chira olmadi");
        }
    } catch(e) {
        console.warn("Serverdan o'chirish bajarilmadi (localStorage-dan o'chirildi):", e);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedQuizzes));
    }
}

// ============================
// HOME SCREEN
// ============================
function renderHome() {
    const quizzes = getQuizzes();
    const list = $('quiz-list');
    const empty = $('no-quizzes');

    if (quizzes.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = quizzes.map(q => `
        <div class="quiz-item" onclick="openQuizSettings('${q.id}')">
            <div class="quiz-item-info">
                <div class="quiz-item-name">${escapeHTML(q.name)}</div>
                <div class="quiz-item-meta">${q.questions.length} ta savol · ${q.createdAt}</div>
            </div>
            <div class="quiz-item-arrow">→</div>
        </div>
    `).join('');
}

function openQuizSettings(quizId) {
    const quizzes = getQuizzes();
    const quiz = quizzes.find(q => q.id === quizId);
    if (!quiz) return;

    currentQuizId = quizId;
    $('settings-quiz-name').textContent = quiz.name;
    $('total-questions-count').textContent = quiz.questions.length;

    document.querySelectorAll('#q-count-options .pill').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
    });
    document.querySelectorAll('#mode-options .pill').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
    });
    selectedCount = 10;
    selectedMode = 'mashq';

    showScreen(ui.settings);
}

// ============================
// ADMIN LOGIN
// ============================
function showAdminLogin() {
    $('admin-password').value = '';
    $('login-error').classList.add('hidden');
    showScreen(ui.adminLogin);
}

function attemptLogin() {
    const pwd = $('admin-password').value;
    if (pwd === ADMIN_PASSWORD) {
        adminPasswordUsed = pwd; // Save for server requests
        showScreen(ui.admin);
        renderAdminQuizList();
        ui.status.textContent = '';
        $('quiz-name-input').value = '';
        ui.file.value = '';
    } else {
        $('login-error').classList.remove('hidden');
    }
}

$('admin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
});

function logoutAdmin() {
    renderHome();
    showScreen(ui.home);
}

// ============================
// ADMIN — Quiz list
// ============================
function renderAdminQuizList() {
    const quizzes = getQuizzes();
    const list = $('admin-quiz-list');
    const empty = $('admin-no-quizzes');

    if (quizzes.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = quizzes.map(q => `
        <div class="admin-quiz-item">
            <div class="admin-quiz-item-info">
                <div class="admin-quiz-item-name">${escapeHTML(q.name)}</div>
                <div class="admin-quiz-item-meta">${q.questions.length} ta savol · ${q.createdAt}</div>
            </div>
            <button class="btn-delete" onclick="confirmDelete('${q.id}')">🗑 O'chirish</button>
        </div>
    `).join('');
}

async function confirmDelete(id) {
    if (confirm("Rostdan ham bu testni o'chirmoqchimisiz?")) {
        await deleteQuiz(id);
    }
}

// ============================
// FILE UPLOAD + PARSE
// ============================
ui.file.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const quizName = $('quiz-name-input').value.trim() || file.name.replace(/\.[^.]+$/, '');
    const ext = file.name.split('.').pop().toLowerCase();
    ui.status.textContent = "Fayl o'qilmoqda...";

    try {
        let text = '';
        if (ext === 'txt') {
            text = await file.text();
        } else if (ext === 'pdf') {
            ui.status.textContent = "PDF o'qilmoqda...";
            text = await readPDF(file);
        } else if (ext === 'docx' || ext === 'doc') {
            ui.status.textContent = "Word o'qilmoqda...";
            text = await readDOCX(file);
        } else {
            throw new Error("Bu fayl turi qo'llab-quvvatlanmaydi. Faqat TXT, PDF, DOCX.");
        }

        if (!text || text.trim().length < 10) {
            throw new Error("Faylda yetarlicha matn topilmadi.");
        }

        ui.status.textContent = "Savollar tahlil qilinmoqda...";
        ui.loading.classList.remove('hidden'); // Show loading screen

        let parsedQuestions = [];
        let aiSuccess = false;

        try {
            const response = await fetch('/api/parse-quiz', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });

            if (response.ok) {
                const resData = await response.json();
                if (resData.success && Array.isArray(resData.questions) && resData.questions.length > 0) {
                    parsedQuestions = resData.questions;
                    aiSuccess = true;
                }
            }
        } catch (aiErr) {
            console.error("AI orqali tahlil qilishda xatolik, offline parserga o'tilmoqda:", aiErr);
        }

        if (!aiSuccess) {
            console.warn("AI parser ishlamadi. Local offline parserdan foydalaniladi.");
            parsedQuestions = parseQuestions(text);
        }

        ui.loading.classList.add('hidden'); // Hide loading screen

        if (parsedQuestions.length > 0) {
            await addQuiz(quizName, parsedQuestions);
            if (aiSuccess) {
                ui.status.innerHTML = '<span style="color:#388e61;">✅ Sun\'iy intellekt orqali ' + parsedQuestions.length + ' ta savol muvaffaqiyatli yuklandi!</span>';
            } else {
                ui.status.innerHTML = '<span style="color:#e88b30;">⚠️ AI ishlamadi, offline parser orqali ' + parsedQuestions.length + ' ta savol yuklandi!</span>';
            }
            $('quiz-name-input').value = '';
            ui.file.value = '';
        } else {
            ui.status.innerHTML = '<span style="color:#ea4335;">❌ Savollarni ajratib bo\'lmadi. Fayl formatini tekshiring.</span>';
        }

    } catch (err) {
        ui.loading.classList.add('hidden'); // Ensure loading is hidden on error
        ui.status.innerHTML = '<span style="color:#ea4335;">❌ Xatolik: ' + err.message + '</span>';
    }
});

// ============================
// MATNNI TOZALASH
// ============================
function cleanText(text) {
    text = text.replace(/\r\n/g, '\n');     // Windows line endings
    text = text.replace(/\r/g, '\n');        // Mac line endings
    text = text.replace(/\t/g, ' ');         // Tablarni bo'shliqqa
    text = text.replace(/ {3,}/g, '  ');     // Ko'p bo'shliqlarni 2 taga
    return text;
}

// ============================
// DRAG-AND-DROP
// ============================
const dropzone = $('dropzone');
if (dropzone) {
    ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => {
        e.preventDefault(); dropzone.style.borderColor = 'var(--primary)'; dropzone.style.background = 'var(--primary-light)';
    }));
    ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => {
        e.preventDefault(); dropzone.style.borderColor = ''; dropzone.style.background = '';
    }));
    dropzone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            const dt = new DataTransfer();
            dt.items.add(file);
            ui.file.files = dt.files;
            ui.file.dispatchEvent(new Event('change'));
        }
    });
}

// ============================
// FILE READERS
// ============================
async function readPDF(file) {
    const buf = await file.arrayBuffer();
    const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let lastY = null;
        for (const item of content.items) {
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                text += '\n'; // Yangi qator
            }
            text += item.str + ' ';
            lastY = item.transform[5];
        }
        text += '\n';
    }
    return text;
}

async function readDOCX(file) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value;
}

// =====================================================
// SAVOLLAR PARSERI — ULTIMATE SMART UNIFIED PARSER
// =====================================================
function parseQuestions(text) {
    console.log("=== ULTIMATE SMART PARSER START ===");
    console.log("Input length:", text.length, "chars");

    text = cleanText(text);

    // Qator ko'chishlarini tekislash (PDF-da ko'p kuzatiladi)
    // Masalan: "A)\n Variant matni" yoki "1.\n Savol matni" bo'lsa ularni birlashtiramiz
    text = text.replace(/\n\s*([A-Ea-e][\.\)\-])\s*\n/g, '\n$1 ');
    text = text.replace(/\n\s*(\d+[\.\)\-])\s*\n/g, '\n$1 ');

    const lines = text.split('\n');
    const questions = [];
    
    let currentQ = null;
    let currentOpts = [];
    let currentCorrectLetter = '';
    let currentCorrect = '';

    function saveCurrentQuestion() {
        if (currentQ && currentQ.trim().length > 3) {
            if (currentOpts.length >= 2) {
                let resolvedCorrect = '';
                if (currentCorrectLetter) {
                    const idx = currentCorrectLetter.charCodeAt(0) - 65; // 'A' -> 0
                    if (idx >= 0 && idx < currentOpts.length) {
                        resolvedCorrect = currentOpts[idx];
                    }
                }
                if (!resolvedCorrect) {
                    resolvedCorrect = currentCorrect || currentOpts[0];
                }
                questions.push({
                    question: currentQ.trim(),
                    options: currentOpts.map(o => o.trim()),
                    correctAnswer: resolvedCorrect.trim()
                });
            }
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const t = rawLine.trim();
        if (!t) continue;

        // 1. Savol raqami tekshiruvi: "1.", "1)", "1-", "№ 1:" kabi boshlansa
        const qMatch = t.match(/^(?:question\s+|savol\s+|test\s+|№\s*)?(\d+)\s*[\.\)\-\:\s\u2013\u2014]\s*(.*)/i);
        // 2. Variant harfi tekshiruvi: "A)", "A.", "a)", "A-"
        const optMatch = t.match(/^([a-eA-E])\s*[\.\)\-\:\s\u2013\u2014]\s*(.*)/);
        // 3. To'g'ri javob tekshiruvi: "Javob: A", "To'g'ri javob: B", "Javob - C"
        const ansMatch = t.match(/^(?:javob|answer|to['`‘’’]?g['`‘’’]?ri\s*javob|correct|kalit)[\s\:\-]+([a-eA-E])\b/i) || 
                         t.match(/^(?:javob|answer|to['`‘’’]?g['`‘’’]?ri\s*javob|correct|kalit)\s+([a-eA-E])\b/i);

        if (qMatch && !optMatch) {
            // Yangi savol boshlandi, eskisini saqlaymiz
            saveCurrentQuestion();

            currentQ = qMatch[2].trim();
            currentOpts = [];
            currentCorrectLetter = '';
            currentCorrect = '';

            // Bitta qatorda bir nechta variant yozilgan bo'lsa (A) ... B) ... C) ...)
            const inline = extractInlineOptions(currentQ);
            if (inline.opts.length >= 2) {
                currentQ = inline.question;
                currentOpts = inline.opts;
                if (inline.correct) currentCorrect = inline.correct;
                if (inline.correctLetter) currentCorrectLetter = inline.correctLetter;
            }
        } 
        else if (optMatch) {
            // Variant qatori
            let optText = optMatch[2].trim();
            let isCorrect = false;
            if (optText.startsWith('+') || optText.startsWith('*')) {
                isCorrect = true;
                optText = optText.substring(1).trim();
            }

            currentOpts.push(optText);
            if (isCorrect) {
                currentCorrect = optText;
            }

            // Bitta qatorda boshqa variantlar ham bo'lsa
            const inline = extractInlineOptions(rawLine);
            if (inline.opts.length >= 2) {
                currentOpts.pop(); // Remove the last line because inline returns full options list
                currentOpts = currentOpts.concat(inline.opts);
                if (inline.correct) currentCorrect = inline.correct;
                if (inline.correctLetter) currentCorrectLetter = inline.correctLetter;
            }
        } 
        else if (ansMatch) {
            // To'g'ri javob e'lon qilingan qator
            currentCorrectLetter = ansMatch[1].toUpperCase();
        } 
        else {
            // Na savol, na variant, na javob qatori — bu savol yoki variantning davomi
            if (currentQ && currentOpts.length === 0) {
                // Savol matnining davomi
                currentQ += '\n' + t;
            } else if (currentOpts.length > 0) {
                // Oxirgi variant matnining davomi
                currentOpts[currentOpts.length - 1] += '\n' + t;
            }
        }
    }

    // Save final question
    saveCurrentQuestion();

    console.log("Parser extracted questions count:", questions.length);

    // Fallback: If no questions found, parse by simple 5 lines pattern
    if (questions.length === 0) {
        return parseFallbackEvery5Lines(lines);
    }

    return questions;
}

function extractInlineOptions(text) {
    const parts = text.split(/\s+(?=[A-Ea-e][\.\)\-\s]\s*)/);
    if (parts.length < 2) {
        return { question: text, opts: [], correct: '', correctLetter: '' };
    }

    const question = parts[0].trim();
    const opts = [];
    let correct = '';
    let correctLetter = '';

    for (let i = 0; i < parts.length; i++) {
        const m = parts[i].match(/^([A-Ea-e])[\.\)\-\s]\s*(.*)/);
        if (m) {
            const letter = m[1].toUpperCase();
            let optText = m[2].trim();
            let isCorrect = false;
            if (optText.startsWith('+') || optText.startsWith('*')) {
                isCorrect = true;
                optText = optText.substring(1).trim();
            }
            opts.push(optText);
            if (isCorrect) {
                correct = optText;
                correctLetter = letter;
            }
        }
    }

    return { question, opts, correct, correctLetter };
}

function parseFallbackEvery5Lines(lines) {
    const questions = [];
    const cleanLines = lines.map(l => l.trim()).filter(l => l.length > 0);

    if (cleanLines.length < 5) return [];

    for (let i = 0; i + 4 < cleanLines.length; i += 5) {
        const q = cleanLines[i].replace(/^\d+[\.\)]\s*/, '').trim();
        const opts = [];
        let correct = '';
        for (let j = 1; j <= 4 && (i + j) < cleanLines.length; j++) {
            let opt = cleanLines[i + j].replace(/^[a-eA-E][\.\)\-\:\s]\s*/, '').trim();
            if (opt.startsWith('+') || opt.startsWith('*')) {
                opt = opt.substring(1).trim();
                correct = opt;
            }
            opts.push(opt);
        }
        if (!correct && opts.length > 0) correct = opts[0];
        if (opts.length >= 2 && q.length > 3) {
            questions.push({ question: q, options: opts, correctAnswer: correct });
        }
    }
    return questions;
}

// ============================
// SETTINGS — Pill selections
// ============================
document.querySelectorAll('#q-count-options .pill').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#q-count-options .pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedCount = btn.dataset.value;
    });
});

document.querySelectorAll('#mode-options .pill').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#mode-options .pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedMode = btn.dataset.value;
    });
});

// ============================
// QUIZ — Start, Render, Handle
// ============================
function startQuiz() {
    const quizzes = getQuizzes();
    const quiz = quizzes.find(q => q.id === currentQuizId);
    if (!quiz) return;

    let qs = [...quiz.questions];
    if ($('shuffle-toggle').checked) qs.sort(() => Math.random() - 0.5);

    if (selectedCount !== 'all') {
        const n = parseInt(selectedCount);
        if (n < qs.length) qs = qs.slice(0, n);
    }

    quizQuestions = qs;
    qIndex = 0;
    score = 0;

    $('total-q').textContent = quizQuestions.length;
    $('score-badge').textContent = "0 to'g'ri";
    showScreen(ui.quiz);
    renderQuestion();
}

function renderQuestion() {
    const q = quizQuestions[qIndex];
    $('current-q').textContent = qIndex + 1;
    $('q-label').textContent = 'SAVOL ' + (qIndex + 1);
    $('question-text').textContent = q.question;
    $('progress').style.width = ((qIndex / quizQuestions.length) * 100) + '%';
    $('next-btn').classList.add('hidden');

    const container = $('options-container');
    container.innerHTML = '';

    let opts = [...q.options];
    if ($('shuffle-toggle').checked) opts.sort(() => Math.random() - 0.5);

    opts.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerHTML = `<span class="choice-letter">${LETTERS[i] || (i+1)}</span><span class="choice-text"></span>`;
        btn.querySelector('.choice-text').textContent = opt; // Safely set text content
        btn.onclick = () => handleChoice(btn, opt, q.correctAnswer);
        container.appendChild(btn);
    });
}

function handleChoice(btn, selected, correct) {
    const isCorrect = selected === correct;

    if (selectedMode === 'mashq') {
        document.querySelectorAll('.choice-btn').forEach(b => {
            b.disabled = true;
            if (b.querySelector('.choice-text').textContent === correct) b.classList.add('correct');
        });
        if (isCorrect) { score++; btn.classList.add('correct'); }
        else { btn.classList.add('wrong'); }

        $('score-badge').textContent = score + " to'g'ri";
        $('next-btn').classList.remove('hidden');
    } else {
        if (isCorrect) score++;
        $('score-badge').textContent = score + " to'g'ri";
        nextQuestion();
    }
}

function nextQuestion() {
    qIndex++;
    if (qIndex < quizQuestions.length) renderQuestion();
    else showResults();
}

function showResults() {
    $('progress').style.width = '100%';
    setTimeout(() => {
        showScreen(ui.result);
        $('final-score').textContent = score;
        $('final-total').textContent = quizQuestions.length;

        const pct = Math.round((score / quizQuestions.length) * 100);
        $('result-percent').textContent = pct + '%';

        const fb = $('feedback-text'), em = $('result-emoji');
        if (pct >= 90)      { fb.textContent = "Ajoyib! Zo'r bilasiz! 🏆"; em.textContent = '🏆'; }
        else if (pct >= 70) { fb.textContent = "Yaxshi natija! 💪"; em.textContent = '🎉'; }
        else if (pct >= 50) { fb.textContent = "O'rtacha. Ko'proq o'qing. 📖"; em.textContent = '📖'; }
        else                { fb.textContent = "Natija past. Qayta urining! 💡"; em.textContent = '😔'; }
    }, 250);
}

function retakeQuiz() {
    if (currentQuizId) openQuizSettings(currentQuizId);
}

function exitQuiz() {
    if (confirm("Quizdan chiqishni xohlaysizmi?")) {
        renderHome();
        showScreen(ui.home);
    }
}

// ============================
// INITIALIZE
// ============================
async function init() {
    await syncQuizzes();
    renderHome();
}
init();
