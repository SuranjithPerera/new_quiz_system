// Global Utility & Security Functions
window.sanitizeHTML = function(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag));
};

window.sampleQuizzes = [
    {
        id: 'sample1',
        title: 'General Knowledge Quiz',
        questions: [
            {
                question: "What is the capital of France?",
                answers: ["London", "Berlin", "Paris", "Madrid"],
                correct: 2,
                timeLimit: 20
            },
            {
                question: "Which planet is known as the Red Planet?",
                answers: ["Venus", "Mars", "Jupiter", "Saturn"],
                correct: 1,
                timeLimit: 20
            },
            {
                question: "What is 2 + 2?",
                answers: ["3", "4", "5", "6"],
                correct: 1,
                timeLimit: 15
            },
            {
                question: "Who painted the Mona Lisa?",
                answers: ["Van Gogh", "Picasso", "Da Vinci", "Monet"],
                correct: 2,
                timeLimit: 25
            }
        ]
    },
    {
        id: 'sample2',
        title: 'Science Quiz',
        questions: [
            {
                question: "What is the chemical symbol for water?",
                answers: ["H2O", "CO2", "NaCl", "O2"],
                correct: 0,
                timeLimit: 15
            },
            {
                question: "How many bones are in the human body?",
                answers: ["106", "206", "306", "406"],
                correct: 1,
                timeLimit: 25
            },
            {
                question: "What gas do plants absorb from the atmosphere?",
                answers: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"],
                correct: 2,
                timeLimit: 20
            }
        ]
    }
];

// Core Game Classes
class ScoringSystem {
    constructor() {
        this.baseScore = 1000;
        this.speedBonusMultiplier = 0.5;
        this.correctAnswerBonus = 100;
    }

    calculateScore(isCorrect, responseTime, questionTimeLimit, questionDifficulty = 1) {
        if (!isCorrect) return 0;
        let score = this.baseScore * questionDifficulty;
        const timePercentage = Math.max(0, (questionTimeLimit - responseTime) / questionTimeLimit);
        const speedBonus = Math.floor(this.baseScore * this.speedBonusMultiplier * timePercentage);
        const correctBonus = this.correctAnswerBonus * questionDifficulty;
        return Math.max(0, Math.floor(score + speedBonus + correctBonus));
    }
}
window.ScoringSystem = ScoringSystem;

class PlayerAnswerManager {
    constructor() {
        this.questionStartTime = null;
        this.hasAnswered = false;
        this.answerSubmittedTime = null;
    }

    startQuestion(startTime) {
        this.questionStartTime = startTime || Date.now();
        this.hasAnswered = false;
        this.answerSubmittedTime = null;
    }

    getResponseTime() {
        if (!this.questionStartTime) return 0;
        return (Date.now() - this.questionStartTime) / 1000;
    }

    markAnswered() {
        this.hasAnswered = true;
        this.answerSubmittedTime = Date.now();
    }

    canAnswer() {
        return !this.hasAnswered;
    }
}
window.PlayerAnswerManager = PlayerAnswerManager;

class QuizGame {
    constructor(gamePin, isHost = false) {
        this.gamePin = gamePin;
        this.isHost = isHost;
        this.currentQuestion = 0;
        this.players = {};
        this.gameState = 'waiting';
        this.timer = null;
        this.timeLeft = 0;
        this.questionStartTime = null;
        this.scoringSystem = new ScoringSystem();
    }

    async createGame(quiz) {
        if (!this.isHost) return false;
        try {
            const db = await this.waitForDatabase();
            if (!db) throw new Error('Database not available');
            
            const gameData = {
                gamePin: this.gamePin,
                quiz: quiz,
                gameState: {
                    status: 'waiting',
                    currentQuestion: 0,
                    timeLeft: 0,
                    questionStartTime: null
                },
                players: {},
                createdAt: Date.now(),
                hostId: window.generatePlayerId(),
                hostUid: typeof auth !== 'undefined' && auth.currentUser ? auth.currentUser.uid : null
            };

            await db.ref(`games/${this.gamePin}`).set(gameData);
            return true;
        } catch (error) {
            return false;
        }
    }

    async joinGame(playerName) {
        try {
            const db = await this.waitForDatabase();
            if (!db) throw new Error('Database not available');
            
            const safePlayerName = window.sanitizeHTML(playerName);
            const storageKey = 'quizmaster_playerId_' + this.gamePin;
            let playerId = sessionStorage.getItem(storageKey);
            let playerExists = false;

            if (playerId) {
                const playerSnapshot = await db.ref(`games/${this.gamePin}/players/${playerId}`).once('value');
                if (playerSnapshot.exists()) {
                    playerExists = true;
                } else {
                    playerId = window.generatePlayerId();
                }
            } else {
                playerId = window.generatePlayerId();
            }

            sessionStorage.setItem(storageKey, playerId);
            const playerRef = db.ref(`games/${this.gamePin}/players/${playerId}`);

            if (!playerExists) {
                const playerData = {
                    id: playerId,
                    name: safePlayerName,
                    score: 0,
                    status: 'waiting',
                    joinedAt: Date.now(),
                    currentAnswer: null,
                    responseTime: null,
                    questionScore: null,
                    isCorrect: null,
                    lastQuestionScore: 0,
                    lastQuestionCorrect: false
                };
                await playerRef.set(playerData);
            } else {
                await playerRef.update({ name: safePlayerName });
            }
            
            return playerId;
        } catch (error) {
            return null;
        }
    }

    async startGame() {
        if (!this.isHost) return false;
        try {
            const db = await this.waitForDatabase();
            if (!db) throw new Error('Database not available');
            
            const startTime = Date.now();
            await db.ref(`games/${this.gamePin}/gameState`).update({
                status: 'playing',
                currentQuestion: 0,
                questionStartTime: startTime
            });
            
            this.questionStartTime = startTime;
            return true;
        } catch (error) {
            return false;
        }
    }

    async nextQuestion() {
        if (!this.isHost) return false;
        try {
            const nextQuestionIndex = this.currentQuestion + 1;
            const startTime = Date.now();
            const db = await this.waitForDatabase();
            if (!db) throw new Error('Database not available');
            
            const updates = {};
            updates['gameState/currentQuestion'] = nextQuestionIndex;
            updates['gameState/questionStartTime'] = startTime;
            updates['gameState/status'] = 'playing';
            
            const playersSnapshot = await db.ref(`games/${this.gamePin}/players`).once('value');
            const players = playersSnapshot.val() || {};
            
            Object.keys(players).forEach(playerId => {
                updates[`players/${playerId}/status`] = 'waiting';
                updates[`players/${playerId}/currentAnswer`] = null;
                updates[`players/${playerId}/responseTime`] = null;
                updates[`players/${playerId}/answerTime`] = null;
            });
            
            await db.ref(`games/${this.gamePin}`).update(updates);
            this.currentQuestion = nextQuestionIndex;
            this.questionStartTime = startTime;
            return true;
        } catch (error) {
            return false;
        }
    }

    async endGame() {
        if (!this.isHost) return false;
        try {
            const db = await this.waitForDatabase();
            if (!db) throw new Error('Database not available');
            
            await db.ref(`games/${this.gamePin}/gameState`).update({
                status: 'finished',
                endedAt: Date.now()
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    async calculatePlayerScore(playerId, answerIndex, correctIndex, responseTime, questionTimeLimit) {
        const isCorrect = answerIndex === correctIndex;
        const score = this.scoringSystem.calculateScore(isCorrect, responseTime, questionTimeLimit);
        
        try {
            const db = await this.waitForDatabase();
            if (!db) throw new Error('Database not available');
            
            const playerRef = db.ref(`games/${this.gamePin}/players/${playerId}`);
            const playerSnapshot = await playerRef.once('value');
            const playerData = playerSnapshot.val();
            
            if (playerData) {
                const newTotalScore = (playerData.score || 0) + score;
                await playerRef.update({
                    score: newTotalScore,
                    lastQuestionScore: score,
                    lastQuestionCorrect: isCorrect,
                    questionScore: score,
                    isCorrect: isCorrect,
                    scoredAt: Date.now()
                });
                return { score, totalScore: newTotalScore, isCorrect };
            }
        } catch (error) {}
        
        return { score: 0, totalScore: 0, isCorrect: false };
    }

    async waitForDatabase() {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 20;
            const checkDatabase = () => {
                attempts++;
                if (window.database && typeof window.database.ref === 'function') {
                    resolve(window.database);
                } else if (attempts >= maxAttempts) {
                    resolve(null);
                } else {
                    setTimeout(checkDatabase, 200);
                }
            };
            checkDatabase();
        });
    }

    listenToGameState(callback) {
        this.waitForDatabase().then(db => {
            if (!db) return;
            db.ref(`games/${this.gamePin}/gameState`).on('value', (snapshot) => {
                const gameState = snapshot.val();
                if (gameState) {
                    if (gameState.questionStartTime) {
                        this.questionStartTime = gameState.questionStartTime;
                    }
                    callback(gameState);
                }
            });
        });
    }

    listenToPlayers(callback) {
        this.waitForDatabase().then(db => {
            if (!db) return;
            db.ref(`games/${this.gamePin}/players`).on('value', (snapshot) => {
                callback(snapshot.val() || {});
            });
        });
    }

    cleanup() {
        this.waitForDatabase().then(db => {
            if (this.gamePin && db) {
                db.ref(`games/${this.gamePin}`).off();
                db.ref(`games/${this.gamePin}/players`).off();
                db.ref(`games/${this.gamePin}/gameState`).off();
            }
        });
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
window.QuizGame = QuizGame;

// Firebase Configuration & Initialization
const firebaseConfig = {
    apiKey: "AIzaSyB2sHk8KwuoJlIBK0ceZxS2IvKgquid04A",
    authDomain: "quizsystem-fbdb9.firebaseapp.com",
    databaseURL: "https://quizsystem-fbdb9-default-rtdb.firebaseio.com",
    projectId: "quizsystem-fbdb9",
    storageBucket: "quizsystem-fbdb9.firebasestorage.app",
    messagingSenderId: "637015291465",
    appId: "1:637015291465:web:893fea9aea38abda6df198",
    measurementId: "G-QGJM9L11N9"
};

let database = null;
let auth = null;
let isFirebaseInitialized = false;
let initializationPromise = null;

function initializeFirebaseIfNeeded() {
    if (initializationPromise) return initializationPromise;
    
    initializationPromise = new Promise(async (resolve, reject) => {
        try {
            if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
            let app;
            try { app = firebase.app(); } catch (error) { app = firebase.initializeApp(firebaseConfig); }
            
            auth = firebase.auth();
            database = firebase.database();
            
            window.auth = auth;
            window.database = database;
            
            isFirebaseInitialized = true;
            resolve({ auth, database });
        } catch (error) {
            createMockServices();
            reject(error);
        }
    });
    return initializationPromise;
}

function createMockServices() {
    const mockAuth = {
        onAuthStateChanged: function(callback) { setTimeout(() => callback(null), 100); return () => {}; },
        signOut: function() { return Promise.resolve(); },
        currentUser: null
    };
    const mockDatabase = {
        ref: function(path) {
            return {
                set: function() { return Promise.reject(new Error('Firebase not available')); },
                update: function() { return Promise.reject(new Error('Firebase not available')); },
                once: function(event, callback, errorCallback) {
                    if (errorCallback) setTimeout(() => errorCallback(new Error('Firebase not available')), 100);
                    return Promise.reject(new Error('Firebase not available'));
                },
                on: function(event, callback, errorCallback) {
                    if (errorCallback) setTimeout(() => errorCallback(new Error('Firebase not available')), 100);
                },
                off: function() {}
            };
        }
    };
    auth = mockAuth;
    database = mockDatabase;
    window.auth = mockAuth;
    window.database = mockDatabase;
}

// Session Management
let currentUser = null;
let sessionData = { quizzes: [], stats: {}, userData: {} };

class SessionManager {
    constructor() {
        this.sessionKey = 'quizmaster_session';
        this.tempDataKey = 'quizmaster_temp_data';
        this.recoveryKey = 'quizmaster_recovery';
        this.isInitialized = false;
    }

    initializeSession() {
        try {
            const savedSession = sessionStorage.getItem(this.sessionKey);
            if (savedSession) {
                sessionData = JSON.parse(savedSession);
            } else {
                this.createNewSession();
            }
            this.isInitialized = true;
            this.handleRecovery();
        } catch (error) {
            this.createNewSession();
        }
    }

    handleRecovery() {
        try {
            const recoveryData = sessionStorage.getItem(this.recoveryKey);
            if (recoveryData) {
                const recovery = JSON.parse(recoveryData);
                const timeSinceLastSave = Date.now() - recovery.timestamp;
                if (timeSinceLastSave < 5 * 60 * 1000) {
                    if (recovery.sessionData && (!sessionData.lastUpdated || recovery.sessionData.lastUpdated > sessionData.lastUpdated)) {
                        sessionData = { ...sessionData, ...recovery.sessionData };
                        this.saveSession();
                    }
                }
                if (timeSinceLastSave > 10 * 60 * 1000) { 
                    sessionStorage.removeItem(this.recoveryKey);
                }
            }
        } catch (error) {}
    }

    saveRecoveryCheckpoint() {
        try {
            const recoveryData = { timestamp: Date.now(), sessionData: { ...sessionData, lastUpdated: Date.now() } };
            sessionStorage.setItem(this.recoveryKey, JSON.stringify(recoveryData));
        } catch (error) {}
    }

    createNewSession() {
        sessionStorage.removeItem('savedQuizzes');
        sessionData = {
            quizzes: [],
            stats: { quizCount: 0, totalPlays: 0 },
            userData: {},
            sessionId: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            isGuest: true,
            userId: null
        };
        this.saveSession();
    }

    saveSession() {
        try {
            sessionData.lastUpdated = Date.now();
            sessionStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
            if (!this.lastRecoveryCheckpoint || Date.now() - this.lastRecoveryCheckpoint > 30000) {
                this.saveRecoveryCheckpoint();
                this.lastRecoveryCheckpoint = Date.now();
            }
        } catch (error) {}
    }

    getSessionQuizzes() {
        return sessionData.quizzes || [];
    }

    addQuizToSession(quiz) {
        if (!sessionData.quizzes) sessionData.quizzes = [];
        if (!sessionData.stats) sessionData.stats = { quizCount: 0, totalPlays: 0 };
        
        const existingIndex = sessionData.quizzes.findIndex(q => q.id === quiz.id);
        if (existingIndex !== -1) {
            sessionData.quizzes[existingIndex] = quiz;
        } else {
            sessionData.quizzes.push(quiz);
            sessionData.stats.quizCount = (sessionData.stats.quizCount || 0) + 1;
        }
        
        this.saveSession();
        
        const activeUser = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : currentUser;
        if (activeUser && !sessionData.isGuest && database && database.ref) {
            this.saveQuizToFirebase(activeUser.uid, quiz).catch(console.error);
        }
    }

    async saveQuizToFirebase(userId, quiz, retryCount = 0) {
        try {
            if (!database || !database.ref) throw new Error('Firebase not available');
            await database.ref(`users/${userId}/quizzes/${quiz.id}`).set({
                ...quiz,
                userId: userId,
                updatedAt: Date.now(),
                syncedAt: Date.now()
            });
        } catch (error) {
            if (retryCount < 1) {
                setTimeout(() => this.saveQuizToFirebase(userId, quiz, retryCount + 1), 3000);
            }
            throw error;
        }
    }

    async loadUserDataFromFirebase(user) {
        try {
            if (!database || !database.ref) throw new Error('Firebase not available');
            const userData = await this.getFirebaseUserData(user.uid);
            const quizzes = await this.getFirebaseQuizzes(user.uid);
            const localQuizzes = sessionData.quizzes || [];
            
            let finalQuizzes;
            if (sessionData.isGuest || !sessionData.userId || sessionData.userId === user.uid) {
                finalQuizzes = this.mergeQuizzes(localQuizzes, quizzes);
            } else {
                finalQuizzes = quizzes;
            }

            sessionData.quizzes = finalQuizzes;
            sessionData.stats = userData.stats || sessionData.stats || { quizCount: 0, totalPlays: 0 };
            sessionData.userData = userData;
            sessionData.isGuest = false;
            sessionData.userId = user.uid;
            sessionData.userEmail = user.email;

            this.saveSession();
            return { success: true, quizzes: finalQuizzes, userData };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    mergeQuizzes(localQuizzes, remoteQuizzes) {
        const merged = [];
        const processedIds = new Set();
        remoteQuizzes.forEach(remoteQuiz => { merged.push(remoteQuiz); processedIds.add(remoteQuiz.id); });
        localQuizzes.forEach(localQuiz => {
            if (!processedIds.has(localQuiz.id)) { merged.push(localQuiz); processedIds.add(localQuiz.id); }
        });
        return merged;
    }

    async getFirebaseUserData(userId) {
        try {
            const snapshot = await database.ref(`users/${userId}`).once('value');
            return snapshot.val() || {};
        } catch (error) { return {}; }
    }

    async getFirebaseQuizzes(userId) {
        try {
            const snapshot = await database.ref(`users/${userId}/quizzes`).once('value');
            const quizzes = snapshot.val() || {};
            return Object.values(quizzes);
        } catch (error) { return []; }
    }

    clearSession() {
        sessionStorage.removeItem(this.sessionKey);
        sessionStorage.removeItem(this.recoveryKey);
        sessionStorage.removeItem('savedQuizzes');
        this.createNewSession();
    }
}

window.sessionManager = new SessionManager();

// App Logic & UI Functions
async function setupAuthStateListener() {
    try {
        await waitForAuth();
        if (auth && typeof auth.onAuthStateChanged === 'function') {
            auth.onAuthStateChanged(async (user) => {
                currentUser = user;
                if (user) {
                    const storedUserId = sessionStorage.getItem('userId');
                    if (storedUserId && storedUserId !== user.uid) window.sessionManager.clearSession();
                    sessionStorage.setItem('userEmail', user.email);
                    sessionStorage.setItem('userName', user.displayName || user.email);
                    sessionStorage.setItem('userId', user.uid);
                    
                    const loadResult = await window.sessionManager.loadUserDataFromFirebase(user);
                    if (loadResult.success) {
                        window.dispatchEvent(new CustomEvent('userDataUpdated', { 
                            detail: { quizzes: loadResult.quizzes, userData: loadResult.userData }
                        }));
                    }
                } else {
                    sessionStorage.removeItem('userEmail');
                    sessionStorage.removeItem('userName');
                    sessionStorage.removeItem('userId');
                    window.sessionManager.clearSession();
                    window.dispatchEvent(new CustomEvent('userDataUpdated', { detail: { quizzes: [], userData: {} } }));
                }
            });
        }
    } catch (error) {}
}

function waitForAuth() {
    return new Promise((resolve) => {
        let attempts = 0;
        const checkAuth = () => {
            attempts++;
            if (window.auth && typeof window.auth.onAuthStateChanged === 'function') resolve();
            else if (attempts >= 20) resolve(); 
            else setTimeout(checkAuth, 100);
        };
        checkAuth();
    });
}

window.generateGamePin = function() {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

window.generatePlayerId = function() {
    return Date.now().toString() + Math.floor(Math.random() * 1000).toString();
};

window.calculateScore = function(isCorrect, responseTime, maxTime) {
    if (!isCorrect) return 0;
    const baseScore = 1000;
    const timeBonus = Math.floor((Math.max(0, maxTime - responseTime) / maxTime) * 500);
    return baseScore + timeBonus;
};

window.showElement = function(elementId) {
    const element = document.getElementById(elementId);
    if (element) element.style.display = 'block';
};

window.hideElement = function(elementId) {
    const element = document.getElementById(elementId);
    if (element) element.style.display = 'none';
};

window.showStatus = function(message, type = 'info') {
    const statusEl = document.getElementById('status-message') || document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'status-message';
        }, 3000);
    }
};

window.saveQuizToSystem = async function(quizData) {
    window.sessionManager.addQuizToSession(quizData);
    const activeUser = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : currentUser;
    
    if (activeUser && database && database.ref) {
        try {
            await window.sessionManager.saveQuizToFirebase(activeUser.uid, quizData);
            return { success: true, location: 'firebase' };
        } catch (error) {
            return { success: true, location: 'local', error: error.message };
        }
    } else {
        return { success: true, location: 'session' };
    }
};

window.loadAllQuizzes = async function() {
    const activeUser = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : currentUser;
    if (activeUser && database && database.ref) {
        const result = await window.sessionManager.loadUserDataFromFirebase(activeUser);
        if (result.success) return result.quizzes;
    }
    return window.sessionManager.getSessionQuizzes();
};

window.deleteQuizFromSystem = async function(quizId) {
    sessionData.quizzes = sessionData.quizzes.filter(q => q.id !== quizId);
    window.sessionManager.saveSession();
    
    const activeUser = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : currentUser;
    if (activeUser && database && database.ref) {
        try {
            await database.ref(`users/${activeUser.uid}/quizzes/${quizId}`).remove();
        } catch (error) {}
    }
    return true;
};

window.signOut = async function() {
    try {
        window.sessionManager.saveRecoveryCheckpoint();
        window.sessionManager.clearSession();
        if (auth && typeof auth.signOut === 'function') {
            await auth.signOut();
        }
    } catch (error) {}
};

// Database References Setup
window.getGameRef = function(pin) { return (database && typeof database.ref === 'function') ? database.ref(`games/${pin}`) : null; };
window.getPlayersRef = function(pin) { return (database && typeof database.ref === 'function') ? database.ref(`games/${pin}/players`) : null; };
window.getGameStateRef = function(pin) { return (database && typeof database.ref === 'function') ? database.ref(`games/${pin}/gameState`) : null; };
window.getUserQuizzesRef = function(userId) { return (database && typeof database.ref === 'function') ? database.ref(`users/${userId}/quizzes`) : null; };
window.getUserDataRef = function(userId) { return (database && typeof database.ref === 'function') ? database.ref(`users/${userId}`) : null; };
window.getUserStatsRef = function(userId) { return (database && typeof database.ref === 'function') ? database.ref(`users/${userId}/stats`) : null; };

document.addEventListener('DOMContentLoaded', function() {
    window.sessionManager.initializeSession();
    initializeFirebaseIfNeeded()
        .then(() => setupAuthStateListener())
        .catch(console.error);
});