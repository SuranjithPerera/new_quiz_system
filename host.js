async function endQuiz() {
    if (hostQuestionTimer) {
        clearInterval(hostQuestionTimer);
        hostQuestionTimer = null;
    }
    
    if (typeof gameAutoCleanupTimer !== 'undefined' && gameAutoCleanupTimer) {
        clearTimeout(gameAutoCleanupTimer);
        gameAutoCleanupTimer = null;
    }
    
    try {
        if (hostGameInstance && database && hostGamePin) {
            
            const gameStateRef = database.ref(`games/${hostGamePin}/gameState`);
            await gameStateRef.update({
                status: 'finished',
                endedAt: Date.now(),
                endReason: 'host_ended',
                message: 'Quiz completed by host'
            });
            
            await hostGameInstance.endGame();
        } else {
        }
        
        showResults();
        showStatus('Quiz ended! All players have been notified.', 'success');
        
    } catch (error) {
        showStatus('Error ending quiz: ' + error.message, 'error');
        
        showResults();
    }
}

async function nextQuestion() {
    if (hostQuestionTimer) {
        clearInterval(hostQuestionTimer);
        hostQuestionTimer = null;
    }
    
    if (hostCurrentQuestionIndex >= hostCurrentQuiz.questions.length - 1) {
        showStatus('All questions completed! Ending quiz...', 'info');
        
        setTimeout(() => {
            endQuiz();
        }, 2000);
        return;
    }
    
    try {
        hostCurrentQuestionIndex++;
        
        const playerUpdates = {};
        Object.keys(hostPlayers).forEach(playerId => {
            playerUpdates[`players/${playerId}/status`] = 'waiting';
            playerUpdates[`players/${playerId}/currentAnswer`] = null;
            playerUpdates[`players/${playerId}/responseTime`] = null;
            playerUpdates[`players/${playerId}/answerTime`] = null;
        });
        
        playerUpdates['gameState/status'] = 'playing';
        playerUpdates['gameState/currentQuestion'] = hostCurrentQuestionIndex;
        playerUpdates['gameState/questionStartTime'] = Date.now();
        
        await database.ref(`games/${hostGamePin}`).update(playerUpdates);
        
        displayCurrentQuestion();
        
    } catch (error) {
        showStatus('Error moving to next question', 'error');
    }
}

function showResults() {
    if (hostQuestionTimer) {
        clearInterval(hostQuestionTimer);
        hostQuestionTimer = null;
    }
    
    if (typeof gameAutoCleanupTimer !== 'undefined' && gameAutoCleanupTimer) {
        clearTimeout(gameAutoCleanupTimer);
        gameAutoCleanupTimer = null;
    }
    
    hideElement('active-game');
    showElement('results-screen');
    
    displayFinalLeaderboard();
}

function hideElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) element.style.display = 'none';
}

function showElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) element.style.display = 'block';
}

function showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'status-message';
        }, 3000);
    }
}