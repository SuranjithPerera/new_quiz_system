const SESSION_KEY = "kokoot_admin_session";
const SESSION_MINUTES = 60;

let adminData = { games: [], stats: {} };

const sanitizeHTML = str => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag));
};

function saveSession(uid, email) {
    const data = { uid, email, exp: Date.now() + SESSION_MINUTES * 60 * 1000 };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function hasValidSession() {
    try {
        const d = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
        return d && Date.now() < d.exp;
    } catch { 
        return false; 
    }
}

function clearSession() { 
    sessionStorage.removeItem(SESSION_KEY); 
}

const $ = id => document.getElementById(id);
function show(id) { $(id).style.display = 'block'; }
function hide(id) { $(id).style.display = 'none'; }
function toast(msg, type = 'info') {
    const el = $('admin-status'); 
    if (!el) return;
    el.textContent = msg; 
    el.className = 'status-message ' + type;
    setTimeout(() => {
        el.textContent = ''; 
        el.className = 'status-message';
    }, 5000);
}

function waitFirebase() {
    return new Promise((res, rej) => {
        let tries = 0; 
        (function check() {
            if (typeof database !== 'undefined' && typeof auth !== 'undefined') return res();
            if (++tries > 30) return rej(new Error('Firebase not available'));
            setTimeout(check, 250);
        })();
    });
}

async function isAdminUser(user) {
    return !!user;
}

document.addEventListener('DOMContentLoaded', async () => {
    show('loading-screen');
    await waitFirebase().catch(() => location.href = 'index.html');

    if (hasValidSession() && auth.currentUser) {
        initDashboard();
    } else {
        auth.onAuthStateChanged(async user => {
            if (!user) { 
                clearSession(); 
                showDenied();
                return;
            }
            if (await isAdminUser(user)) {
                saveSession(user.uid, user.email); 
                initDashboard();
            } else {
                clearSession(); 
                showDenied();
            }
        });
    }
});

function showDenied() {
    hide('loading-screen'); 
    hide('admin-content'); 
    show('access-denied');
}

async function initDashboard() {
    try {
        await loadGames();        
        calcStats();              
        renderStats();
        renderGames();
        hide('loading-screen'); 
        show('admin-content');
        toast('Dashboard ready', 'success');
        realTimeGames();
    } catch (e) {
        toast('Error loading dashboard', 'error');
    }
}

async function loadGames() {
    adminData.games = [];
    const snap = await database.ref('games').once('value');
    const obj = snap.val() || {};
    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;

    Object.entries(obj).forEach(([pin, data]) => {
        if (data.hostUid === currentUserId) {
            adminData.games.push({
                gamePin: pin,
                quiz: data.quiz || {},
                gameState: data.gameState || {},
                createdAt: data.createdAt || 0,
                players: data.players ? Object.values(data.players) : [],
                playerCount: data.players ? Object.keys(data.players).length : 0
            });
        }
    });
}

function calcStats() {
    adminData.stats.totalGames = adminData.games.length;
    adminData.stats.activeGames = adminData.games.filter(g => ['waiting', 'playing'].includes(g.gameState.status)).length;
}

function renderStats() {
    $('total-games').textContent = adminData.stats.totalGames;
    $('active-games').textContent = adminData.stats.activeGames;
}

function renderGames() {
    const list = $('games-list');
    if (!list) return;
    if (adminData.games.length === 0) {
        list.innerHTML = '<div class="loading-item">No games found</div>'; 
        return;
    }
    adminData.games.sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = adminData.games.map(g => `
        <div class="game-item">
            <div class="game-info">
                <div class="game-pin-admin">PIN: ${sanitizeHTML(g.gamePin)}</div>
                <div>Quiz: ${sanitizeHTML(g.quiz.title) || 'Untitled'}</div>
                <div>Players: ${g.playerCount}</div>
                <div>Created: ${fmtDate(g.createdAt)}</div>
            </div>
            <div><span class="game-status-admin ${sanitizeHTML(g.gameState.status) || 'unknown'}">${(sanitizeHTML(g.gameState.status) || 'unknown').toUpperCase()}</span></div>
            <div>
                <button class="action-btn" onclick="viewPlayers('${sanitizeHTML(g.gamePin)}')">View Players</button>
                <button class="action-btn danger" onclick="endGame('${sanitizeHTML(g.gamePin)}')">End</button>
            </div>
        </div>
    `).join('');
}

window.viewPlayers = gamePin => {
    const g = adminData.games.find(x => x.gamePin === gamePin);
    if (!g) { 
        toast('Game not found', 'error'); 
        return; 
    }
    let html = `<h3 style="margin-top:0">Players - Game ${sanitizeHTML(gamePin)}</h3>`;
    if (g.playerCount === 0) {
        html += '<p>No players joined this game.</p>';
    } else {
        html += `<table>
            <tr>
                <th>Player Name</th>
                <th>Score</th>
                <th>Status</th>
            </tr>` +
            g.players.map(p => `
                <tr>
                    <td>${sanitizeHTML(p.name) || '?'}</td>
                    <td style="text-align:center; font-weight:bold;">${p.score || 0}</td>
                    <td>${sanitizeHTML(p.status) || 'waiting'}</td>
                </tr>
            `).join('') +
            '</table>';
    }
    $('players-content').innerHTML = html;
    show('players-modal');
};

window.closeModal = id => hide(id);

window.endGame = async pin => {
    if (!confirm('End game ' + pin + ' ?')) return;
    try {
        await database.ref('games/' + pin + '/gameState').update({
            status: 'finished', 
            endedAt: Date.now(), 
            endReason: 'admin'
        });
        toast('Game ended', 'success');
    } catch (e) { 
        toast('Error', 'error'); 
    }
};

function realTimeGames() {
    let first = true;
    const ref = database.ref('games');
    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;

    ref.on('child_added', snap => {
        if (first) return;          
        const pin = snap.key, data = snap.val();
        
        if (data.hostUid !== currentUserId) return;
        
        if (adminData.games.find(g => g.gamePin === pin)) return;      
        adminData.games.unshift({
            gamePin: pin, 
            quiz: data.quiz || {}, 
            gameState: data.gameState || {},
            createdAt: data.createdAt || 0,
            players: data.players ? Object.values(data.players) : [], 
            playerCount: data.players ? Object.keys(data.players).length : 0
        });
        calcStats(); 
        renderStats(); 
        renderGames();
    });
    
    ref.on('child_changed', snap => {
        const pin = snap.key, data = snap.val();
        
        if (data.hostUid !== currentUserId) return;
        
        const idx = adminData.games.findIndex(g => g.gamePin === pin);
        if (idx > -1) {
            adminData.games[idx] = { 
                gamePin: pin, 
                quiz: data.quiz || {}, 
                gameState: data.gameState || {},
                createdAt: data.createdAt || 0,
                players: data.players ? Object.values(data.players) : [], 
                playerCount: data.players ? Object.keys(data.players).length : 0
            };
            calcStats(); 
            renderStats(); 
            renderGames();
        }
    });
    
    ref.on('child_removed', snap => {
        adminData.games = adminData.games.filter(g => g.gamePin !== snap.key);
        calcStats(); 
        renderStats(); 
        renderGames();
    });
    
    setTimeout(() => { first = false; }, 1500);   
}

window.filterGames = () => {
    const statusFilter = $('game-status-filter').value;
    const games = document.querySelectorAll('.game-item');
    
    games.forEach(game => {
        const status = game.querySelector('.game-status-admin').textContent.toLowerCase();
        if (statusFilter === 'all' || status.includes(statusFilter)) {
            game.style.display = '';
        } else {
            game.style.display = 'none';
        }
    });
};

window.switchTab = name => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    $(name + '-tab').classList.add('active');
};

function fmtDate(ts) { 
    if (!ts) return '-'; 
    const d = new Date(ts); 
    return d.toLocaleDateString() + " " + d.toLocaleTimeString(); 
}