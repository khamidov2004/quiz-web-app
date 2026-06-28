const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const https = require('https');

// Load environment variables manually
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const index = trimmed.indexOf('=');
        if (index !== -1) {
            const key = trimmed.substring(0, index).trim();
            const value = trimmed.substring(index + 1).trim().replace(/^["']|["']$/g, '');
            if (key) process.env[key] = value;
        }
    });
}

const app = express();
const PORT = process.env.PORT || 3000;
const QUIZZES_FILE = path.join(__dirname, 'quizzes.json');
const ADMIN_PASSWORD = "Khamidov_2004";

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large quiz files (with many questions)
app.use(express.static(path.join(__dirname, 'public')));

// Ensure quizzes.json is only handled lazily to avoid startup write errors on read-only environments
// (no root-level writeFileSync)

// MongoDB setup
let isMongoConnected = false;
let dbConnection = null;
let lastConnectionAttempt = 0;
const CONNECTION_COOLDOWN_MS = 30000; // 30 seconds cooldown between connection attempts if offline

const quizSchema = new mongoose.Schema({
    name: { type: String, required: true },
    questions: [
        {
            question: { type: String, required: true },
            options: [{ type: String, required: true }],
            correctAnswer: { type: String, required: true }
        }
    ],
    createdAt: { type: String, default: () => new Date().toLocaleDateString('uz-UZ') }
});

const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', quizSchema);

async function connectToDatabase() {
    if (dbConnection && mongoose.connection.readyState === 1) {
        isMongoConnected = true;
        return;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        isMongoConnected = false;
        return;
    }

    // Skip trying to reconnect if we failed recently to prevent request hangs
    const now = Date.now();
    if (!isMongoConnected && now - lastConnectionAttempt < CONNECTION_COOLDOWN_MS) {
        return;
    }

    lastConnectionAttempt = now;

    try {
        dbConnection = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000
        });
        isMongoConnected = true;
        console.log("✅ MongoDB-ga muvaffaqiyatli ulandi!");
    } catch (err) {
        console.error("❌ MongoDB-ga ulanishda xatolik:", err.message);
        isMongoConnected = false;
    }
}

// Global DB Connection middleware
app.use(async (req, res, next) => {
    await connectToDatabase();
    next();
});

// Helpers for fallback
function readQuizzes() {
    try {
        if (!fs.existsSync(QUIZZES_FILE)) {
            return [];
        }
        const data = fs.readFileSync(QUIZZES_FILE, 'utf8');
        return JSON.parse(data) || [];
    } catch (e) {
        console.error("Faylni o'qishda xatolik:", e);
        return [];
    }
}

function writeQuizzes(quizzes) {
    try {
        fs.writeFileSync(QUIZZES_FILE, JSON.stringify(quizzes, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Faylga yozishda xatolik:", e);
        return false;
    }
}

// REST API Endpoints

// 1. Get all quizzes
app.get('/api/quizzes', async (req, res) => {
    try {
        if (isMongoConnected) {
            const dbQuizzes = await Quiz.find({});
            const quizzes = dbQuizzes.map(q => ({
                id: q._id.toString(),
                name: q.name,
                questions: q.questions,
                createdAt: q.createdAt
            }));
            res.json(quizzes);
        } else {
            const quizzes = readQuizzes();
            res.json(quizzes);
        }
    } catch (e) {
        console.error("Quizlarni yuklashda xatolik:", e);
        res.status(500).json({ error: "Testlarni yuklab bo'lmadi." });
    }
});

// 2. Add a new quiz (Admin only)
app.post('/api/quizzes', async (req, res) => {
    const pwd = req.headers['x-admin-password'];
    if (pwd !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Ruxsat berilmagan! Admin paroli noto'g'ri." });
    }

    const { name, questions } = req.body;
    if (!name || !questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: "Noto'g'ri ma'lumotlar formati." });
    }

    try {
        if (isMongoConnected) {
            const newQuiz = new Quiz({ name, questions });
            const saved = await newQuiz.save();
            res.status(201).json({
                id: saved._id.toString(),
                name: saved.name,
                questions: saved.questions,
                createdAt: saved.createdAt
            });
        } else {
            // Netlify filesystem is read-only, so quizzes.json write always fails. Return a descriptive DB error.
            res.status(500).json({ 
                error: "Ma'lumotlar bazasiga ulanib bo'lmadi (isMongoConnected=false). Netlify-da MONGODB_URI va MongoDB Atlas-da Network Access (0.0.0.0/0) sozlamalari to'g'ri ekanligini tekshiring." 
            });
        }
    } catch (e) {
        console.error("Testni saqlashda xatolik:", e);
        res.status(500).json({ error: "Ma'lumotlar bazasiga saqlashda xatolik yuz berdi: " + e.message });
    }
});

// 3. Delete a quiz (Admin only)
app.delete('/api/quizzes/:id', async (req, res) => {
    const pwd = req.headers['x-admin-password'];
    if (pwd !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Ruxsat berilmagan! Admin paroli noto'g'ri." });
    }

    const id = req.params.id;

    try {
        if (isMongoConnected) {
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return res.status(404).json({ error: "Noto'g'ri ID formati." });
            }
            const deleted = await Quiz.findByIdAndDelete(id);
            if (!deleted) {
                return res.status(404).json({ error: "O'chirilishi kerak bo'lgan test topilmadi." });
            }
            res.json({ success: true, message: "Test o'chirildi." });
        } else {
            let quizzes = readQuizzes();
            const originalLength = quizzes.length;
            quizzes = quizzes.filter(q => q.id !== id);

            if (quizzes.length === originalLength) {
                return res.status(404).json({ error: "O'chirilishi kerak bo'lgan test topilmadi." });
            }

            if (writeQuizzes(quizzes)) {
                res.json({ success: true, message: "Test o'chirildi." });
            } else {
                res.status(500).json({ error: "Serverda testni o'chirish iloji bo'lmadi." });
            }
        }
    } catch (e) {
        console.error("Testni o'chirishda xatolik:", e);
        res.status(500).json({ error: "Serverda testni o'chirish iloji bo'lmadi." });
    }
});

// 4. Gemini AI Quiz Parser
app.post('/api/parse-quiz', async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: "Matn taqdim etilmadi." });
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        return res.status(500).json({ error: "Gemini API kaliti topilmadi." });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

    const promptText = `Sizga har xil formatdagi (PDF, Word, TXT dan olingan) test savollari matni beriladi. Sizning vazifangiz ushbu matndagi barcha savollarni, ularning variantlarini va to'g'ri javoblarini aniqlab, ularni structured JSON formatga o'tkazishdir.

Qoidalarga qat'iy rioya qiling:
1. Har bir savol uchun JSON obyekt yaratilsin. Unda quyidagi maydonlar bo'lsin:
   - "question": Savolning to'liq matni (hech qanday boshidagi "1.", "Savol:" kabi raqamlar yoki prefikslarsiz).
   - "options": Variantlar ro'yxati (kamida 2 ta, odatda 4 ta). Variantlar boshidagi "A)", "B.", "C-" kabi harf va belgilarni olib tashlang. Faqat toza variant matnini yozing.
   - "correctAnswer": To'g'ri javobning aniq matni. Bu matn "options" ro'yxatidagi variantlardan biriga harfma-harf mos kelishi shart.
2. To'g'ri javobni qanday aniqlash mumkin:
   - Matnda to'g'ri javob alohida "Javob: A", "Kalit: B", "To'g'ri javob: C" yoki shunga o'xshash ko'rinishda yozilgan bo'lishi mumkin.
   - Variantlar ichida to'g'ri javobning boshida "+" yoki "*" belgisi bo'lishi mumkin (masalan: "*A) Variant matni" yoki "+B) Variant matni").
   - Agar to'g'ri javob matnda aniq ko'rsatilmagan bo'lsa, savol mazmunidan kelib chiqib eng to'g'ri variantni tanlab, uni "correctAnswer" ga yozing.
3. Matndagi barcha savollarni to'liq tahlil qilib, birorta ham savolni tashlab ketmang.

Savollar matni:
${text}`;

    const postData = JSON.stringify({
        contents: [{
            parts: [{
                text: promptText
            }]
        }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        question: { type: "STRING" },
                        options: {
                            type: "ARRAY",
                            items: { type: "STRING" }
                        },
                        correctAnswer: { type: "STRING" }
                    },
                    required: ["question", "options", "correctAnswer"]
                }
            }
        }
    });

    const reqOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 60000 // 60-second timeout
    };

    const apiReq = https.request(url, reqOptions, (apiRes) => {
        let responseBody = '';
        apiRes.on('data', (chunk) => {
            responseBody += chunk;
        });

        apiRes.on('end', () => {
            if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                try {
                    const parsedData = JSON.parse(responseBody);
                    if (parsedData.candidates && parsedData.candidates[0] && parsedData.candidates[0].content && parsedData.candidates[0].content.parts && parsedData.candidates[0].content.parts[0]) {
                        const jsonText = parsedData.candidates[0].content.parts[0].text;
                        const questions = JSON.parse(jsonText);
                        return res.json({ success: true, questions });
                    } else {
                        console.error("Gemini response structure mismatch:", responseBody);
                        return res.status(500).json({ error: "Gemini javob formati xato." });
                    }
                } catch (e) {
                    console.error("Error parsing Gemini JSON response:", e);
                    return res.status(500).json({ error: "Muvaffaqiyatsiz tahlil (JSON parslash xatosi)." });
                }
            } else {
                console.error("Gemini API error status:", apiRes.statusCode, responseBody);
                return res.status(apiRes.statusCode).json({ error: `Gemini API xatosi: ${apiRes.statusCode}` });
            }
        });
    });

    apiReq.on('error', (e) => {
        console.error("Gemini request error:", e);
        return res.status(500).json({ error: `Server ulanish xatosi: ${e.message}` });
    });

    apiReq.on('timeout', () => {
        apiReq.destroy();
        return res.status(504).json({ error: "Gemini API kutish vaqti tugadi." });
    });

    apiReq.write(postData);
    apiReq.end();
});

// Serve main page on all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server (only if run directly, not in Netlify functions)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`🚀 Quiz Web App serveri ishga tushdi!`);
        console.log(`Ssilka: http://localhost:${PORT}`);
        console.log(`====================================================`);
    });
}

module.exports = app;
