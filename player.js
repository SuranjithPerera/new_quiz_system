let playerGameInstance = null;
let playerGamePlayerId = null;
let playerGamePlayerName = null;
let currentGamePin = null;
let playerScore = 0;
let hasAnswered = false;
let questionStartTime = null;
let currentTimerInterval = null;
let currentQuestionData = null;
let isRecoveringState = false;
let isQuestionActive = false;
let questionEndTime = null;
let previousScore = 0;

const PLAYER_STATE_KEYS = {
    GAME_PIN: 'player_game_pin',
    PLAYER_NAME: 'player_player_name',
    PLAYER_ID: 'player_player_id',
    GAME_STATE: 'player_game_state',
    IS_ACTIVE: 'player_is_active',
    CURRENT_SCORE: 'player_current_score'
};

class SimpleAnswerManager {
    constructor() {
        this.questionStartTime = null;
        this.hasAnswered = false;
    }

    startQuestion(startTime) {
        this.questionStartTime = startTime || Date.now();
        this.hasAnswered = false;
    }

    getResponseTime() {
        if (!this.questionStartTime) return 0;
        return (Date.now() - this.questionStartTime) / 1000;
    }

    markAnswered() {
        this.hasAnswered = true;
    }

    canAnswer() {
        return !this.hasAnswered;
    }
}

class SimpleQuizGame {
    constructor(gamePin, isHost = false) {
        this.gamePin = gamePin;
        this.isHost = isHost;
    }

    async joinGame(playerName) {
        try {
            const newPlayerId = Date.now().toString() + '_' + Math.floor(Math.random() * 1000);
            const playerData = {
                id: newPlayerId,
                name: playerName,
                score: 0,
                status: 'waiting',
                joinedAt: Date.now()
            };

            const playerRef = database.ref(`games/${this.gamePin}/players/${newPlayerId}`);
            await playerRef.set(playerData);
            
            return newPlayerId;
        } catch (error) {
            return null;
        }
    }

    listenToGameState(callback) {
        const gameStateRef = database.ref(`games/${this.gamePin}/gameState`);
        
        gameStateRef.on('value', (snapshot) => {
            const gameState = snapshot.val();
            if (gameState) {
                callback(gameState);
            }
        });
    }

    listenToPlayers(callback) {
        const playersRef = database.ref(`games/${this.gamePin}/players`);
        
        playersRef.on('value', (snapshot) => {
            const players = snapshot.val() || {};
            callback(players);
        });
    }

    cleanup() {
        if (this.gamePin && typeof database !== 'undefined') {
            database.ref(`games/${this.gamePin}`).off();
        }
    }
}

let answerManager = null;

function clearOldPlayerState() {
    Object.values(PLAYER_STATE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });
    
    playerGameInstance = null;
    playerGamePlayerId = null;
    playerGamePlayerName = null;
    currentGamePin = null;
    playerScore = 0;
    hasAnswered = false;
    questionStartTime = null;
    isQuestionActive = false;
    questionEndTime = null;
    previousScore = 0;
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
}

function initializePlayer() {
    const newGamePin = localStorage.getItem('gamePin');
    const newPlayerName = localStorage.getItem('playerName');
    
    clearOldPlayerState();
    
    answerManager = new SimpleAnswerManager();
    
    currentGamePin = newGamePin;
    playerGamePlayerName = newPlayerName;
    
    if (!currentGamePin || !playerGamePlayerName) {
        showStatus('Invalid game information. Please enter game PIN and name.', 'error');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 3000);
        return;
    }
    
    const gamePinEl = document.getElementById('player-game-pin');
    const playerNameEl = document.getElementById('player-name-display');
    
    if (gamePinEl) gamePinEl.textContent = currentGamePin;
    if (playerNameEl) playerNameEl.textContent = playerGamePlayerName;
    
    hideAllScreens();
    showElement('joining-game');
    
    waitForFirebaseReady(() => {
        joinGame();
    });
}

function clearPlayerState() {
    Object.values(PLAYER_STATE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });
    
    currentGamePin = null;
    playerGamePlayerId = null;
    playerGamePlayerName = null;
    playerScore = 0;
    previousScore = 0;
    hasAnswered = false;
    isQuestionActive = false;
    questionEndTime = null;
}

function savePlayerState(gameState = 'lobby') {
    try {
        localStorage.setItem(PLAYER_STATE_KEYS.IS_ACTIVE, 'true');
        localStorage.setItem(PLAYER_STATE_KEYS.GAME_PIN, currentGamePin);
        localStorage.setItem(PLAYER_STATE_KEYS.PLAYER_ID, playerGamePlayerId);
        localStorage.setItem(PLAYER_STATE_KEYS.PLAYER_NAME, playerGamePlayerName);
        localStorage.setItem(PLAYER_STATE_KEYS.GAME_STATE, gameState);
        localStorage.setItem(PLAYER_STATE_KEYS.CURRENT_SCORE, playerScore.toString());
    } catch (error) {
    }
}

function waitForFirebaseReady(callback) {
    let attempts = 0;
    const maxAttempts = 40;
    
    function checkReady() {
        attempts++;
        
        const firebaseReady = typeof firebase !== 'undefined';
        const databaseReady = typeof database !== 'undefined' && database && database.ref;
        
        if (firebaseReady && databaseReady) {
            setTimeout(() => {
                callback();
            }, 500);
        } else if (attempts >= maxAttempts) {
            showStatus('Connection timeout. Please refresh and try again.', 'error');
        } else {
            setTimeout(checkReady, 500);
        }
    }
    
    checkReady();
}

async function joinGame() {
    showStatus('Connecting to game...', 'info');
    
    try {
        const gameCheckResult = await checkGameExistsDetailed();
        
        if (!gameCheckResult.exists) {
            showStatus(gameCheckResult.message, 'error');
            
            clearPlayerState();
            localStorage.removeItem('gamePin');
            localStorage.removeItem('playerName');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 3000);
            return;
        }
        
        showStatus('Game found! Joining...', 'info');
        
        playerGameInstance = new SimpleQuizGame(currentGamePin, false);
        playerGamePlayerId = await playerGameInstance.joinGame(playerGamePlayerName);
        
        if (!playerGamePlayerId) {
            throw new Error('Failed to get player ID from join operation');
        }
        
        const gameStateRef = database.ref(`games/${currentGamePin}/gameState`);
        const gameStateSnapshot = await gameStateRef.once('value');
        const currentState = gameStateSnapshot.val();
        
        playerGameInstance.listenToGameState(onGameStateChange);
        playerGameInstance.listenToPlayers(onPlayersUpdate);
        
        hideElement('joining-game');
        
        if (currentState) {
            switch (currentState.status) {
                case 'waiting':
                    showElement('waiting-lobby');
                    showStatus('Joined successfully! Waiting for host to start...', 'success');
                    savePlayerState('lobby');
                    break;
                    
                case 'playing':
                case 'question_ended':
                    showWaitingNext();
                    showStatus('Game in progress. Wait for next question!', 'info');
                    savePlayerState('waiting-next');
                    break;
                    
                case 'finished':
                    showFinalResults();
                    showStatus('Game has already ended!', 'info');
                    break;
                    
                default:
                    showElement('waiting-lobby');
                    showStatus('Joined successfully!', 'success');
                    savePlayerState('lobby');
            }
        } else {
            showElement('waiting-lobby');
            showStatus('Joined successfully!', 'success');
            savePlayerState('lobby');
        }
        
    } catch (error) {
        showStatus('Failed to join: ' + error.message, 'error');
        
        clearPlayerState();
        localStorage.removeItem('gamePin');
        localStorage.removeItem('playerName');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 3000);
    }
}

function checkGameExistsDetailed() {
    return new Promise((resolve) => {
        const gameRef = database.ref(`games/${currentGamePin}`);
        
        const timeout = setTimeout(() => {
            resolve({
                exists: false,
                reason: 'timeout',
                message: 'Connection timeout. Please check your internet and try again.'
            });
        }, 10000);
        
        gameRef.once('value', (snapshot) => {
            clearTimeout(timeout);
            const gameData = snapshot.val();
            
            if (!gameData) {
                resolve({
                    exists: false,
                    reason: 'not_found',
                    message: 'Game not found. Please check the PIN and try again.'
                });
                return;
            }
            
            if (!gameData.quiz || !gameData.quiz.questions || gameData.quiz.questions.length === 0) {
                resolve({
                    exists: false,
                    reason: 'invalid_quiz',
                    message: 'Game has invalid quiz data.'
                });
                return;
            }
            
            resolve({
                exists: true,
                reason: 'success',
                message: 'Game found!'
            });
            
        }, (error) => {
            clearTimeout(timeout);
            resolve({
                exists: false,
                reason: 'database_error',
                message: 'Database error: ' + error.message
            });
        });
    });
}

function onGameStateChange(gameState) {
    if (!gameState) {
        return;
    }
    
    switch (gameState.status) {
        case 'waiting':
            hideAllScreens();
            showElement('waiting-lobby');
            savePlayerState('lobby');
            break;
            
        case 'playing':
            hasAnswered = false;
            isQuestionActive = true;
            questionEndTime = null;
            if (answerManager) {
                answerManager.startQuestion(gameState.questionStartTime);
            }
            showActiveQuestion(gameState);
            savePlayerState('playing');
            break;
            
        case 'question_ended':
            isQuestionActive = false;
            questionEndTime = gameState.questionEndTime || Date.now();
            
            if (currentTimerInterval) {
                clearInterval(currentTimerInterval);
                currentTimerInterval = null;
            }
            
            setTimeout(() => {
                showWaitingNext();
                savePlayerState('question-ended');
            }, 2000);
            break;
            
        case 'finished':
            if (currentTimerInterval) {
                clearInterval(currentTimerInterval);
                currentTimerInterval = null;
            }
            showFinalResults();
            break;
            
        case 'abandoned':
            if (currentTimerInterval) {
                clearInterval(currentTimerInterval);
                currentTimerInterval = null;
            }
            clearPlayerState();
            showStatus('Game ended - host disconnected', 'info');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 3000);
            break;
            
        default:
    }
}

function onPlayersUpdate(players) {
    const playerCount = Object.keys(players).length;
    
    const countEl = document.getElementById('lobby-player-count');
    if (countEl) countEl.textContent = playerCount;
    
    if (playerGamePlayerId && players[playerGamePlayerId]) {
        const currentPlayerData = players[playerGamePlayerId];
        const newScore = currentPlayerData.score || 0;
        
        if (newScore !== playerScore) {
            
            if (newScore > playerScore) {
                const increase = newScore - playerScore;
                showScoreIncrease(increase);
            }
            
            previousScore = playerScore;
            playerScore = newScore;
            
            forceUpdateAllScoreDisplays();
        }
        
        savePlayerState();
    }
    
    updateLeaderboards(players);
}

function forceUpdateAllScoreDisplays() {
    const currentScoreEl = document.getElementById('current-score');
    if (currentScoreEl) {
        currentScoreEl.textContent = playerScore;
    }
    
    const finalScoreEl = document.getElementById('player-final-score');
    if (finalScoreEl) {
        finalScoreEl.textContent = `${playerScore} points`;
    }
    
    if (currentScoreEl && previousScore !== playerScore && playerScore > previousScore) {
        currentScoreEl.classList.add('score-updated');
        setTimeout(() => {
            currentScoreEl.classList.remove('score-updated');
        }, 1000);
    }
}

function showScoreIncrease(points) {
    const scoreFloat = document.createElement('div');
    scoreFloat.textContent = `+${points}`;
    scoreFloat.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);
        color: white;
        padding: 15px 25px;
        border-radius: 30px;
        font-size: 2rem;
        font-weight: 900;
        z-index: 10000;
        pointer-events: none;
        animation: scoreFloatUp 3s ease-out forwards;
        box-shadow: 0 10px 30px rgba(76, 175, 80, 0.5);
        border: 3px solid rgba(255, 255, 255, 0.8);
        text-shadow: 2px 2px 6px rgba(0, 0, 0, 0.3);
    `;
    
    document.body.appendChild(scoreFloat);
    
    setTimeout(() => {
        if (scoreFloat.parentNode) {
            scoreFloat.parentNode.removeChild(scoreFloat);
        }
    }, 3000);
}

function showWaitingLobby() {
    hideAllScreens();
    showElement('waiting-lobby');
}

function showActiveQuestion(gameState) {
    database.ref(`games/${currentGamePin}`).once('value', (snapshot) => {
        const gameData = snapshot.val();
        const question = gameData?.quiz?.questions?.[gameState.currentQuestion];
        
        if (question) {
            displayQuestion(question, gameState.currentQuestion + 1);
        } else {
            showStatus('Error loading question', 'error');
            showWaitingNext();
        }
    }, (error) => {
        showStatus('Error loading question', 'error');
        showWaitingNext();
    });
}

function displayQuestion(question, questionNumber) {
    hideAllScreens();
    showElement('active-question');
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
    }
    
    document.getElementById('question-num').textContent = questionNumber;
    document.getElementById('question-text').textContent = question.question;
    
    const grid = document.getElementById('answers-grid');
    grid.innerHTML = '';
    hasAnswered = false;
    isQuestionActive = true;
    questionEndTime = null;
    
    question.answers.forEach((answer, index) => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.textContent = answer;
        btn.onclick = () => selectAnswer(index);
        grid.appendChild(btn);
    });
    
    startTimerPlayer(question.timeLimit || 20);
    hideElement('answer-feedback');
}

function startTimerPlayer(duration) {
    const display = document.getElementById('question-timer');
    let timeLeft = duration;
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
    }
    
    const update = () => {
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        if (timeLeft <= 5) {
            display.style.background = 'linear-gradient(135deg, #e21b3c 0%, #ff4757 100%)';
            display.classList.add('urgent');
        } else if (timeLeft <= 10) {
            display.style.background = 'linear-gradient(135deg, #ff6900 0%, #ff8c00 100%)';
            display.classList.add('warning');
            display.classList.remove('urgent');
        } else {
            display.style.background = 'linear-gradient(135deg, #26d0ce 0%, #1dd1a1 100%)';
            display.classList.remove('urgent', 'warning');
            display.style.animation = 'none';
        }
        
        if (timeLeft <= 0) {
            clearInterval(currentTimerInterval);
            currentTimerInterval = null;
            onTimeout();
        } else {
            timeLeft--;
        }
    };
    
    update();
    currentTimerInterval = setInterval(update, 1000);
}

async function selectAnswer(answerIndex) {
    if (hasAnswered || !isQuestionActive || questionEndTime) {
        return;
    }
    
    hasAnswered = true;
    if (answerManager) {
        answerManager.markAnswered();
    }
    
    const responseTime = answerManager ? answerManager.getResponseTime() : 0;
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
    }
    
    const buttons = document.querySelectorAll('.answer-btn');
    buttons.forEach((btn, index) => {
        btn.disabled = true;
        if (index === answerIndex) {
            btn.style.transform = 'scale(1.05)';
            btn.style.border = '4px solid #fff';
            btn.style.boxShadow = '0 0 25px rgba(255, 255, 255, 0.7)';
            btn.style.zIndex = '1000';
        } else {
            btn.style.opacity = '0.6';
        }
    });
    
    try {
        const playerRef = database.ref(`games/${currentGamePin}/players/${playerGamePlayerId}`);
        await playerRef.update({
            currentAnswer: answerIndex,
            responseTime: responseTime,
            status: 'answered',
            answerTime: Date.now()
        });
        
        showFeedback(`Answer submitted! Response time: ${responseTime.toFixed(1)}s`);
        
        const timerEl = document.getElementById('question-timer');
        if (timerEl) {
            timerEl.textContent = "ANSWERED";
            timerEl.style.background = 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)';
            timerEl.style.animation = 'none';
            timerEl.classList.remove('urgent', 'warning');
        }
        
    } catch (error) {
        showStatus('Failed to submit answer', 'error');
        
        if (isQuestionActive && !questionEndTime) {
            hasAnswered = false;
            if (answerManager) {
                answerManager = new SimpleAnswerManager();
            }
            
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.style.transform = '';
                btn.style.border = '';
                btn.style.boxShadow = '';
                btn.style.opacity = '';
                btn.style.zIndex = '';
            });
            
            const timeLeftEstimate = Math.max(5, 20 - responseTime);
            startTimerPlayer(timeLeftEstimate);
        }
    }
}

function onTimeout() {
    isQuestionActive = false;
    questionEndTime = Date.now();
    
    if (!hasAnswered) {
        hasAnswered = true;
        
        const buttons = document.querySelectorAll('.answer-btn');
        buttons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
        });
        
        showFeedback('Time\'s up! No answer submitted.');
        
        const timerEl = document.getElementById('question-timer');
        if (timerEl) {
            timerEl.textContent = "TIME'S UP";
            timerEl.style.background = 'linear-gradient(135deg, #e21b3c 0%, #ff4757 100%)';
            timerEl.style.animation = 'pulse 1s infinite';
        }
    }
}

function showFeedback(message) {
    const feedback = document.getElementById('answer-feedback');
    const messageEl = document.getElementById('feedback-message');
    if (messageEl) messageEl.textContent = message;
    showElement('answer-feedback');
}

function showWaitingNext() {
    hideAllScreens();
    showElement('waiting-next');
    forceUpdateAllScoreDisplays();
}

function updateScoreDisplay() {
    forceUpdateAllScoreDisplays();
}

function updateLeaderboards(players) {
    const sorted = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0));
    
    updateLeaderboard('current-leaderboard', sorted.slice(0, 5));
    updateLeaderboard('final-leaderboard-player', sorted);
    
    const rank = sorted.findIndex(p => p.id === playerGamePlayerId) + 1;
    const rankEl = document.getElementById('player-final-rank');
    if (rankEl) {
        rankEl.textContent = `#${rank} of ${sorted.length}`;
    }
}

function updateLeaderboard(elementId, players) {
    const board = document.getElementById(elementId);
    if (!board) return;
    
    board.innerHTML = '<h3>🏆 Leaderboard</h3>';
    
    players.forEach((player, index) => {
        const div = document.createElement('div');
        div.className = `player-score ${index < 3 ? `rank-${index + 1}` : ''}`;
        
        if (player.id === playerGamePlayerId) {
            div.style.backgroundColor = '#e3f2fd';
            div.style.fontWeight = 'bold';
            div.style.border = '3px solid #1368ce';
        }
        
        div.innerHTML = `
            <span>#${index + 1} ${player.name} ${player.id === playerGamePlayerId ? '(You)' : ''}</span>
            <span>${player.score || 0} points</span>
        `;
        board.appendChild(div);
    });
}

function showFinalResults() {
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    
    const performFinalScoreVerification = async () => {
        try {
            const playerRef = database.ref(`games/${currentGamePin}/players/${playerGamePlayerId}`);
            const snapshot = await playerRef.once('value');
            const freshPlayerData = snapshot.val();
            
            if (freshPlayerData && typeof freshPlayerData.score === 'number') {
                const firebaseScore = freshPlayerData.score;
                
                if (firebaseScore !== playerScore) {
                    playerScore = firebaseScore;
                }
                
                forceUpdateAllScoreDisplays();
                
                setTimeout(() => {
                    forceUpdateAllScoreDisplays();
                }, 50);
                
                setTimeout(() => {
                    forceUpdateAllScoreDisplays();
                }, 200);
                
            } else {
                forceUpdateAllScoreDisplays();
            }
            
        } catch (error) {
            forceUpdateAllScoreDisplays();
        }
    };
    
    hideAllScreens();
    showElement('final-results');
    
    if (typeof confetti !== 'undefined') {
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#46178f', '#9c4dff', '#ff6900', '#26d0ce']
        });
    }
    
    performFinalScoreVerification();
    
    showStatus('🏁 Quiz completed! Final results are in!', 'success');
    
    setTimeout(() => {
        clearPlayerState();
        localStorage.removeItem('gamePin');
        localStorage.removeItem('playerName');
    }, 1000);
}

function hideAllScreens() {
    const screens = ['joining-game', 'waiting-lobby', 'active-question', 'waiting-next', 'final-results'];
    screens.forEach(hideElement);
}

function hideElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    if (status) {
        status.textContent = message;
        status.className = `status-message ${type}`;
        setTimeout(() => {
            status.textContent = '';
            status.className = 'status-message';
        }, 3000);
    }
}

window.addEventListener('beforeunload', () => {
    if (playerGameInstance) {
        playerGameInstance.cleanup();
    }
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    
    clearPlayerState();
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && playerGamePlayerId && currentGamePin) {
    }
});

function playAgain() {
    clearPlayerState();
    localStorage.removeItem('gamePin');
    localStorage.removeItem('playerName');
    window.location.href = 'index.html';
}

window.playAgain = playAgain;

const playerEnhancedCSS = `
<style id="player-enhanced-scoring">
@keyframes scoreFloatUp {
    0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.5) rotate(-10deg);
    }
    15% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.3) rotate(0deg);
    }
    85% {
        opacity: 1;
        transform: translate(-50%, -70%) scale(1) rotate(0deg);
    }
    100% {
        opacity: 0;
        transform: translate(-50%, -90%) scale(0.8) rotate(5deg);
    }
}

@keyframes scoreUpdate {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); color: #4caf50; }
    100% { transform: scale(1); }
}

.score-updated {
    animation: scoreUpdate 0.8s ease-out !important;
}

.timer.urgent {
    animation: urgentPulse 0.5s infinite !important;
    box-shadow: 0 0 30px rgba(226, 27, 60, 0.8) !important;
}

.timer.warning {
    animation: warningPulse 1s infinite !important;
    box-shadow: 0 0 20px rgba(255, 105, 0, 0.6) !important;
}

@keyframes urgentPulse {
    0%, 100% { 
        opacity: 1; 
        transform: scale(1);
        box-shadow: 0 0 30px rgba(226, 27, 60, 0.8);
    }
    50% { 
        opacity: 0.8; 
        transform: scale(1.05);
        box-shadow: 0 0 40px rgba(226, 27, 60, 1);
    }
}

@keyframes warningPulse {
    0%, 100% { 
        opacity: 1;
        box-shadow: 0 0 20px rgba(255, 105, 0, 0.6);
    }
    50% { 
        opacity: 0.9;
        box-shadow: 0 0 25px rgba(255, 105, 0, 0.8);
    }
}

.answer-btn {
    transition: all 0.3s ease !important;
}

.answer-btn:disabled {
    transition: all 0.5s ease !important;
}

.player-score {
    transition: all 0.3s ease !important;
}

#answer-feedback {
    animation: slideInUp 0.5s ease-out !important;
}

@keyframes slideInUp {
    0% {
        opacity: 0;
        transform: translateY(20px);
    }
    100% {
        opacity: 1;
        transform: translateY(0);
    }
}

#current-score, #player-final-score {
    transition: all 0.3s ease !important;
    font-weight: bold !important;
}

.status-message {
    animation: statusBounce 0.5s ease-out !important;
}

@keyframes statusBounce {
    0% {
        opacity: 0;
        transform: translateY(-10px) scale(0.9);
    }
    60% {
        opacity: 1;
        transform: translateY(0) scale(1.05);
    }
    100% {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}
</style>
`;

if (!document.getElementById('player-enhanced-scoring')) {
    const styleElement = document.createElement('div');
    styleElement.innerHTML = playerEnhancedCSS;
    document.head.appendChild(styleElement.firstElementChild);
}

document.addEventListener('DOMContentLoaded', () => {
    initializePlayer();
});