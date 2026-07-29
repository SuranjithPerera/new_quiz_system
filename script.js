// Attach directly to window to avoid 'const' redeclaration crashes
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
window.ScoringSystem = ScoringSystem; // Make globally available instantly

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
        } catch (error) {
        }
        
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
window.QuizGame = QuizGame; // Force instant global availability

window.generateGamePin = function() {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

window.generatePlayerId = function() {
    return Date.now().toString() + '_' + Math.floor(Math.random() * 1000).toString();
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