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
    if (initializationPromise) {
        return initializationPromise;
    }
    
    initializationPromise = new Promise(async (resolve, reject) => {
        try {
            if (typeof firebase === 'undefined') {
                throw new Error('Firebase SDK not loaded');
            }
            
            let app;
            try {
                app = firebase.app(); 
            } catch (error) {
                app = firebase.initializeApp(firebaseConfig);
            }
            
            auth = firebase.auth();
            database = firebase.database();
            
            window.auth = auth;
            window.database = database;
            
            database.ref('.info/connected').on('value', function(snapshot) {
                if (snapshot.val() === true) {
                } else {
                }
            });
            
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
        onAuthStateChanged: function(callback) {
            setTimeout(() => callback(null), 100);
            return () => {}; 
        },
        signOut: function() {
            return Promise.resolve();
        },
        currentUser: null
    };
    
    const mockDatabase = {
        ref: function(path) {
            return {
                set: function(data) {
                    return Promise.reject(new Error('Firebase not available'));
                },
                update: function(data) {
                    return Promise.reject(new Error('Firebase not available'));
                },
                once: function(event, callback, errorCallback) {
                    if (errorCallback) {
                        setTimeout(() => errorCallback(new Error('Firebase not available')), 100);
                    }
                    return Promise.reject(new Error('Firebase not available'));
                },
                on: function(event, callback, errorCallback) {
                    if (errorCallback) {
                        setTimeout(() => errorCallback(new Error('Firebase not available')), 100);
                    }
                },
                off: function() {
                }
            };
        }
    };
    
    auth = mockAuth;
    database = mockDatabase;
    window.auth = mockAuth;
    window.database = mockDatabase;
}

let currentUser = null;
let currentGame = null;
let currentQuestionIndex = 0;
let gamePin = null;
let isHost = false;
let sessionData = {
    quizzes: [],
    stats: {},
    userData: {}
};

class SessionManager {
    constructor() {
        this.sessionKey = 'quizmaster_session';
        this.tempDataKey = 'quizmaster_temp_data';
        this.recoveryKey = 'quizmaster_recovery';
        this.isInitialized = false;
    }

    initializeSession() {
        try {
            const savedSession = localStorage.getItem(this.sessionKey);
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
            const recoveryData = localStorage.getItem(this.recoveryKey);
            if (recoveryData) {
                const recovery = JSON.parse(recoveryData);
                const timeSinceLastSave = Date.now() - recovery.timestamp;
                
                if (timeSinceLastSave < 5 * 60 * 1000) {
                    if (recovery.sessionData && 
                        (!sessionData.lastUpdated || recovery.sessionData.lastUpdated > sessionData.lastUpdated)) {
                        sessionData = { ...sessionData, ...recovery.sessionData };
                        this.saveSession();
                    }
                }
                
                if (timeSinceLastSave > 10 * 60 * 1000) { 
                    localStorage.removeItem(this.recoveryKey);
                }
            }
        } catch (error) {
        }
    }

    saveRecoveryCheckpoint() {
        try {
            const recoveryData = {
                timestamp: Date.now(),
                sessionData: { ...sessionData, lastUpdated: Date.now() }
            };
            localStorage.setItem(this.recoveryKey, JSON.stringify(recoveryData));
        } catch (error) {
        }
    }

    createNewSession() {
        localStorage.removeItem('savedQuizzes');
        
        sessionData = {
            quizzes: [],
            stats: { quizCount: 0, totalPlays: 0 },
            userData: {},
            sessionId: this.generateSessionId(),
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            isGuest: true
        };
        this.saveSession();
    }

    saveSession() {
        try {
            sessionData.lastUpdated = Date.now();
            localStorage.setItem(this.sessionKey, JSON.stringify(sessionData));
            
            if (!this.lastRecoveryCheckpoint || 
                Date.now() - this.lastRecoveryCheckpoint > 30000) {
                this.saveRecoveryCheckpoint();
                this.lastRecoveryCheckpoint = Date.now();
            }
        } catch (error) {
        }
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getSessionQuizzes() {
        return sessionData.quizzes || [];
    }

    getSessionStats() {
        return sessionData.stats || { quizCount: 0, totalPlays: 0 };
    }

    addQuizToSession(quiz) {
        if (!sessionData.quizzes) {
            sessionData.quizzes = [];
        }
        
        if (!sessionData.stats) {
            sessionData.stats = { quizCount: 0, totalPlays: 0 };
        }
        
        const existingIndex = sessionData.quizzes.findIndex(q => q.id === quiz.id);
        if (existingIndex !== -1) {
            sessionData.quizzes[existingIndex] = quiz;
        } else {
            sessionData.quizzes.push(quiz);
            sessionData.stats.quizCount = (sessionData.stats.quizCount || 0) + 1;
        }
        
        this.saveSession();
        
        if (currentUser && !sessionData.isGuest && database && database.ref) {
            this.saveQuizToFirebase(currentUser.uid, quiz).catch(console.error);
        }
    }

    async saveQuizToFirebase(userId, quiz, retryCount = 0) {
        try {
            if (!database || !database.ref) {
                throw new Error('Firebase not available');
            }
            
            await database.ref(`users/${userId}/quizzes/${quiz.id}`).set({
                ...quiz,
                userId: userId,
                updatedAt: Date.now(),
                syncedAt: Date.now()
            });
            
        } catch (error) {
            if (retryCount < 1) {
                setTimeout(() => {
                    this.saveQuizToFirebase(userId, quiz, retryCount + 1);
                }, 3000);
            }
            throw error;
        }
    }

    async loadUserDataFromFirebase(user) {
        try {
            if (!database || !database.ref) {
                throw new Error('Firebase not available');
            }

            const userData = await this.getFirebaseUserData(user.uid);
            const quizzes = await this.getFirebaseQuizzes(user.uid);

            const localQuizzes = sessionData.quizzes || [];
            const mergedQuizzes = this.mergeQuizzes(localQuizzes, quizzes);

            sessionData.quizzes = mergedQuizzes;
            sessionData.stats = userData.stats || sessionData.stats || { quizCount: 0, totalPlays: 0 };
            sessionData.userData = userData;
            sessionData.isGuest = false;
            sessionData.userId = user.uid;
            sessionData.userEmail = user.email;

            this.saveSession();

            return { success: true, quizzes: mergedQuizzes, userData };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    mergeQuizzes(localQuizzes, remoteQuizzes) {
        const merged = [];
        const processedIds = new Set();

        remoteQuizzes.forEach(remoteQuiz => {
            merged.push(remoteQuiz);
            processedIds.add(remoteQuiz.id);
        });

        localQuizzes.forEach(localQuiz => {
            if (!processedIds.has(localQuiz.id)) {
                merged.push(localQuiz);
                processedIds.add(localQuiz.id);
            }
        });

        return merged;
    }

    async getFirebaseUserData(userId) {
        try {
            if (!database || !database.ref) {
                throw new Error('Firebase not available');
            }
            const snapshot = await database.ref(`users/${userId}`).once('value');
            return snapshot.val() || {};
        } catch (error) {
            return {};
        }
    }

    async getFirebaseQuizzes(userId) {
        try {
            if (!database || !database.ref) {
                throw new Error('Firebase not available');
            }
            const snapshot = await database.ref(`users/${userId}/quizzes`).once('value');
            const quizzes = snapshot.val() || {};
            return Object.values(quizzes);
        } catch (error) {
            return [];
        }
    }

    clearSession() {
        localStorage.removeItem(this.sessionKey);
        localStorage.removeItem(this.recoveryKey);
        localStorage.removeItem('savedQuizzes');
        this.createNewSession();
    }
}

const sessionManager = new SessionManager();

async function setupAuthStateListener() {
    try {
        await waitForAuth();
        
        if (auth && typeof auth.onAuthStateChanged === 'function') {
            
            auth.onAuthStateChanged(async (user) => {
                currentUser = user;
                
                if (user) {
                    localStorage.setItem('userEmail', user.email);
                    localStorage.setItem('userName', user.displayName || user.email);
                    localStorage.setItem('userId', user.uid);
                    
                    const loadResult = await sessionManager.loadUserDataFromFirebase(user);
                    if (loadResult.success) {
                        window.dispatchEvent(new CustomEvent('userDataUpdated', { 
                            detail: { quizzes: loadResult.quizzes, userData: loadResult.userData }
                        }));
                    }
                    
                } else {
                    localStorage.removeItem('userEmail');
                    localStorage.removeItem('userName');
                    localStorage.removeItem('userId');
                    
                    sessionManager.clearSession();
                    
                    window.dispatchEvent(new CustomEvent('userDataUpdated', { 
                        detail: { quizzes: [], userData: {} }
                    }));
                }
            });
            
        } else {
        }
    } catch (error) {
    }
}

function waitForAuth() {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 20;
        
        const checkAuth = () => {
            attempts++;
            
            if (window.auth && typeof window.auth.onAuthStateChanged === 'function') {
                resolve();
            } else if (attempts >= maxAttempts) {
                resolve(); 
            } else {
                setTimeout(checkAuth, 100);
            }
        };
        
        checkAuth();
    });
}

function generateGamePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generatePlayerId() {
    return Date.now().toString() + Math.floor(Math.random() * 1000).toString();
}

function getGameRef(pin) {
    if (database && typeof database.ref === 'function') {
        return database.ref(`games/${pin}`);
    }
    return null;
}

function getPlayersRef(pin) {
    if (database && typeof database.ref === 'function') {
        return database.ref(`games/${pin}/players`);
    }
    return null;
}

function getGameStateRef(pin) {
    if (database && typeof database.ref === 'function') {
        return database.ref(`games/${pin}/gameState`);
    }
    return null;
}

function getUserQuizzesRef(userId) {
    if (database && typeof database.ref === 'function') {
        return database.ref(`users/${userId}/quizzes`);
    }
    return null;
}

function getUserDataRef(userId) {
    if (database && typeof database.ref === 'function') {
        return database.ref(`users/${userId}`);
    }
    return null;
}

function getUserStatsRef(userId) {
    if (database && typeof database.ref === 'function') {
        return database.ref(`users/${userId}/stats`);
    }
    return null;
}

async function saveQuizToSystem(quizData) {
    sessionManager.addQuizToSession(quizData);
    
    if (currentUser && database && database.ref) {
        try {
            await sessionManager.saveQuizToFirebase(currentUser.uid, quizData);
            return { success: true, location: 'firebase' };
        } catch (error) {
            return { success: true, location: 'local', error: error.message };
        }
    } else {
        return { success: true, location: 'session' };
    }
}

async function loadAllQuizzes() {
    if (currentUser && database && database.ref) {
        const result = await sessionManager.loadUserDataFromFirebase(currentUser);
        if (result.success) {
            return result.quizzes;
        }
    }
    
    return sessionManager.getSessionQuizzes();
}

async function deleteQuizFromSystem(quizId) {
    sessionData.quizzes = sessionData.quizzes.filter(q => q.id !== quizId);
    sessionManager.saveSession();
    
    if (currentUser && database && database.ref) {
        try {
            await database.ref(`users/${currentUser.uid}/quizzes/${quizId}`).remove();
        } catch (error) {
        }
    }
    
    return true;
}

async function signOut() {
    try {
        if (auth && typeof auth.signOut === 'function') {
            await auth.signOut();
        }
        
        sessionManager.clearSession();
    } catch (error) {
    }
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status-message') || document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'status-message';
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    sessionManager.initializeSession();
    
    initializeFirebaseIfNeeded()
        .then(() => {
            return setupAuthStateListener();
        })
        .then(() => {
        })
        .catch(error => {
        });
});

window.sessionManager = sessionManager;
window.saveQuizToSystem = saveQuizToSystem;
window.loadAllQuizzes = loadAllQuizzes;
window.deleteQuizFromSystem = deleteQuizFromSystem;
window.signOut = signOut;
window.showStatus = showStatus;
window.generateGamePin = generateGamePin;
window.generatePlayerId = generatePlayerId;
window.getGameRef = getGameRef;
window.getPlayersRef = getPlayersRef;
window.getGameStateRef = getGameStateRef;
window.getUserQuizzesRef = getUserQuizzesRef;
window.getUserDataRef = getUserDataRef;
window.getUserStatsRef = getUserStatsRef;