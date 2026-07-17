// =============================================
// CONFIGURATION
// =============================================

const ETHERSCAN_API = "1KSQ9JSV6B6ANY7E282GZQD3E1NNJXKKRP";
const GITHUB_TOKEN = "ghp_JRLbgP5YNMMvLVqr72bpmu-MU5bBMf03f2Ufo"; // Add your token for saving
const GITHUB_REPO = "JACKOSBON/LOVERS"; // e.g., "user/crypto-finder"

// =============================================
// STATE
// =============================================

let isRunning = false;
let stopRequested = false;
let totalChecked = 0;
let foundWallets = [];
let logs = [];
let foundWalletsData = [];

// =============================================
// UTILITY FUNCTIONS
// =============================================

function generateWallet() {
    // Simulate generating a random wallet address
    const chars = '0123456789abcdef';
    let address = '0x';
    for (let i = 0; i < 40; i++) {
        address += chars[Math.floor(Math.random() * 16)];
    }
    return address;
}

function generatePrivateKey() {
    const chars = '0123456789abcdef';
    let key = '';
    for (let i = 0; i < 64; i++) {
        key += chars[Math.floor(Math.random() * 16)];
    }
    return key;
}

// =============================================
// API FUNCTIONS
// =============================================

async function checkBalanceETH(address) {
    try {
        const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_API}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status === '1') {
            const balance = parseFloat(data.result) / 1e18; // Convert wei to ETH
            return balance;
        } else {
            return null;
        }
    } catch (error) {
        console.error('Etherscan error:', error);
        return null;
    }
}

async function checkBalanceBTC(address) {
    // Using blockchain.info public API (no key needed)
    try {
        const url = `https://blockchain.info/rawaddr/${address}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data.final_balance / 1e8; // Convert satoshi to BTC
    } catch {
        return null;
    }
}

// =============================================
// LOGGING
// =============================================

function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { timestamp, message, type };
    logs.unshift(entry);
    
    // Keep only last 100 logs
    if (logs.length > 100) logs.pop();
    
    // Update UI
    const logContainer = document.getElementById('logs');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    logContainer.prepend(logEntry);
    
    // Trim logs in UI
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// =============================================
// MAIN LOOP
// =============================================

async function processWallet() {
    const address = generateWallet();
    const privateKey = generatePrivateKey();
    
    // Check ETH balance
    const ethBalance = await checkBalanceETH(address);
    
    if (ethBalance !== null && ethBalance > 0) {
        // Found wallet with balance!
        const walletData = {
            address,
            privateKey,
            ethBalance,
            foundAt: new Date().toISOString()
        };
        foundWalletsData.push(walletData);
        foundWallets.push(walletData);
        
        addLog(`💰 FOUND! ${address} | ETH: ${ethBalance.toFixed(6)}`, 'live');
        updateFoundList();
        updateStats();
        return true;
    } else {
        addLog(`❌ Empty: ${address.substring(0, 10)}...`, 'dead');
        totalChecked++;
        updateStats();
        return false;
    }
}

async function runLoop() {
    isRunning = true;
    stopRequested = false;
    
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    
    addLog('🔄 Started scanning...', 'info');
    
    while (!stopRequested) {
        await processWallet();
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
    }
    
    isRunning = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    addLog('⏹️ Stopped scanning', 'info');
}

// =============================================
// UI UPDATES
// =============================================

function updateStats() {
    document.getElementById('totalChecked').textContent = totalChecked;
    document.getElementById('foundWallets').textContent = foundWallets.length;
    document.getElementById('counter').textContent = `Checked: ${totalChecked}`;
}

function updateFoundList() {
    const container = document.getElementById('foundWalletsList');
    if (foundWalletsData.length === 0) {
        container.innerHTML = '<div style="color:#667;padding:20px;text-align:center;">No wallets found yet</div>';
        return;
    }
    
    container.innerHTML = foundWalletsData.map(w => `
        <div class="found-item">
            <div class="address">📍 ${w.address}</div>
            <div class="balance">💰 ${w.ethBalance.toFixed(6)} ETH</div>
            <div style="color:#667;font-size:10px;">🔑 ${w.privateKey.substring(0, 16)}...</div>
            <div style="color:#667;font-size:10px;">📅 ${new Date(w.foundAt).toLocaleString()}</div>
        </div>
    `).join('');
}

// =============================================
// GITHUB SAVE
// =============================================

async function saveToGitHub() {
    if (foundWalletsData.length === 0) {
        addLog('⚠️ No wallets to save!', 'error');
        return;
    }
    
    addLog('💾 Saving to GitHub...', 'info');
    
    const data = {
        timestamp: new Date().toISOString(),
        totalChecked,
        foundWallets: foundWalletsData
    };
    
    const content = JSON.stringify(data, null, 2);
    const filename = `found_wallets_${Date.now()}.json`;
    
    try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Add found wallets ${new Date().toISOString()}`,
                content: btoa(content),
                branch: 'main'
            })
        });
        
        if (response.ok) {
            addLog(`✅ Saved to GitHub: ${filename}`, 'live');
        } else {
            addLog(`❌ GitHub save failed: ${response.status}`, 'error');
            // Fallback: download locally
            downloadJSON(content, filename);
        }
    } catch (error) {
        addLog(`❌ GitHub error: ${error.message}`, 'error');
        downloadJSON(content, filename);
    }
}

function downloadJSON(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`📁 Downloaded locally: ${filename}`, 'info');
}

// =============================================
// API STATUS CHECK
// =============================================

async function checkAPIStatus() {
    try {
        const testAddress = '0x0000000000000000000000000000000000000000';
        const url = `https://api.etherscan.io/api?module=account&action=balance&address=${testAddress}&tag=latest&apikey=${ETHERSCAN_API}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status === '1') {
            document.getElementById('apiStatus').textContent = '✅ Online';
            document.getElementById('apiStatus').style.color = '#00ff88';
            addLog('📡 Etherscan API: Online ✅', 'info');
        } else {
            document.getElementById('apiStatus').textContent = '⚠️ Error';
            document.getElementById('apiStatus').style.color = '#ff6644';
            addLog('📡 Etherscan API: Error ❌', 'error');
        }
    } catch {
        document.getElementById('apiStatus').textContent = '❌ Offline';
        document.getElementById('apiStatus').style.color = '#ff3355';
        addLog('📡 Etherscan API: Offline ❌', 'error');
    }
}

// =============================================
// EVENT LISTENERS
// =============================================

document.getElementById('startBtn').addEventListener('click', () => {
    if (!isRunning) {
        runLoop();
    }
});

document.getElementById('stopBtn').addEventListener('click', () => {
    if (isRunning) {
        stopRequested = true;
    }
});

document.getElementById('saveBtn').addEventListener('click', saveToGitHub);

// =============================================
// INIT
// =============================================

addLog('🟢 System initialized', 'info');
addLog(`🔑 API Key: ${ETHERSCAN_API.substring(0, 8)}...`, 'info');
checkAPIStatus();
updateFoundList();

// Update stats every second
setInterval(updateStats, 1000);
