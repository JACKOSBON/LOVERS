const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  LIVE LOGS — Server-Sent Events
// ============================================================
let logClients = [];

function sendLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, message, type };
    
    // Save to file
    fs.appendFileSync('farm.log', `[${timestamp}] ${message}\n`);
    
    // Send to all connected clients
    logClients.forEach(client => {
        client.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    });
    
    console.log(`[${timestamp}] ${message}`);
}

// SSE endpoint for live logs
app.get('/api/logs', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Send initial log
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString(), message: '✅ Connected to live logs', type: 'info' })}\n\n`);
    
    logClients.push(res);
    
    req.on('close', () => {
        logClients = logClients.filter(client => client !== res);
    });
});

// ============================================================
//  DATA STORAGE
// ============================================================
const DATA_FILE = path.join(__dirname, 'wallets.json');

function loadWallets() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) { sendLog(`Load error: ${e.message}`, 'error'); }
    return [];
}

function saveWallets(wallets) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
    } catch (e) { sendLog(`Save error: ${e.message}`, 'error'); }
}

// ============================================================
//  CRYPTO FUNCTIONS
// ============================================================
function sha256(msg) {
    return crypto.createHash('sha256').update(msg).digest('hex');
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer) {
    let num = BigInt('0x' + buffer.toString('hex'));
    let result = '';
    while (num > 0) {
        const rem = Number(num % 58n);
        result = BASE58[rem] + result;
        num = num / 58n;
    }
    return result || '1';
}

function generatePrivateKey() {
    return crypto.randomBytes(32).toString('hex');
}

function deriveAddress(privateKey, chain) {
    const hash = sha256(privateKey);
    if (chain === 'bitcoin') {
        const pubKeyHash = hash.slice(0, 40);
        const withPrefix = '00' + pubKeyHash;
        const checksum = sha256(sha256(withPrefix)).slice(0, 8);
        return base58Encode(Buffer.from(withPrefix + checksum, 'hex'));
    } else if (['ethereum', 'bsc', 'polygon'].includes(chain)) {
        return '0x' + hash.slice(-40);
    } else if (chain === 'solana') {
        return base58Encode(Buffer.from(hash.slice(0, 44), 'hex'));
    } else if (chain === 'tron') {
        return 'T' + hash.slice(0, 33);
    } else if (chain === 'monero') {
        return '4' + hash.slice(0, 94);
    }
    return hash.slice(0, 42);
}

// ============================================================
//  API CONFIG — FIXED FOR ALL CHAINS
// ============================================================
const API_CONFIG = {
    bitcoin: {
        label: 'BTC',
        endpoints: [
            { url: (addr) => `https://blockchain.info/balance?active=${addr}`, parse: (data, addr) => {
                    if (data.balance !== undefined) return data.balance / 1e8;
                    if (data.data && data.data[addr]) return data.data[addr].balance / 1e8;
                    return null;
                } },
            { url: (addr) => `https://chain.api.btc.com/v3/address/${addr}`, parse: (data) => {
                    if (data.data && data.data.balance !== undefined) return data.data.balance / 1e8;
                    return null;
                } }
        ]
    },
    ethereum: {
        label: 'ETH',
        endpoints: [
            { url: (addr) => `https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest&apikey=YourApiKeyToken`,
                parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; } },
            { url: (addr) => `https://api.blockcypher.com/v1/eth/main/addrs/${addr}`,
                parse: (data) => { if (data.balance !== undefined) return data.balance / 1e18; return null; } }
        ]
    },
    bsc: {
        label: 'BNB',
        endpoints: [
            { url: (addr) => `https://api.bscscan.com/api?module=account&action=balance&address=${addr}&apikey=YourApiKeyToken`,
                parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; } }
        ]
    },
    polygon: {
        label: 'MATIC',
        endpoints: [
            { url: (addr) => `https://api.polygonscan.com/api?module=account&action=balance&address=${addr}&apikey=YourApiKeyToken`,
                parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; } }
        ]
    },
    solana: {
        label: 'SOL',
        endpoints: [
            { url: (addr) => `https://api.solscan.io/account/${addr}`, parse: (data) => {
                    if (data.data && data.data.lamports !== undefined) return data.data.lamports / 1e9;
                    if (data.lamports !== undefined) return data.lamports / 1e9;
                    return null;
                } },
            { url: (addr) => `https://public-api.solscan.io/account/${addr}`, parse: (data) => {
                    if (data.data && data.data.lamports !== undefined) return data.data.lamports / 1e9;
                    return null;
                } }
        ]
    },
    tron: {
        label: 'TRX',
        endpoints: [
            { url: (addr) => `https://api.trongrid.io/v1/accounts/${addr}`, parse: (data) => {
                    if (data.balance !== undefined) return data.balance / 1e6;
                    if (data.data && data.data.balance !== undefined) return data.data.balance / 1e6;
                    return null;
                } },
            { url: (addr) => `https://api.tronscan.org/api/account?address=${addr}`, parse: (data) => {
                    if (data.balance !== undefined) return data.balance / 1e6;
                    return null;
                } }
        ]
    },
    monero: {
        label: 'XMR',
        endpoints: [
            { url: (addr) => `https://xmrchain.net/api/address/${addr}`, parse: (data) => {
                    if (data.balance !== undefined) return data.balance / 1e12;
                    if (data.data && data.data.balance !== undefined) return data.data.balance / 1e12;
                    return null;
                } },
            { url: (addr) => `https://moneroblocks.info/api/address/${addr}`, parse: (data) => {
                    if (data.balance !== undefined) return data.balance / 1e12;
                    return null;
                } }
        ]
    }
};

const CHAINS = ['bitcoin', 'ethereum', 'bsc', 'polygon', 'solana', 'tron', 'monero'];

// ============================================================
//  SCAN FUNCTION — WITH FALLBACK
// ============================================================
async function scanAddress(address, chain) {
    const config = API_CONFIG[chain];
    if (!config) return { balance: null, error: 'Chain not supported' };

    for (const endpoint of config.endpoints) {
        try {
            const url = endpoint.url(address);
            const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!resp.ok) continue;
            const data = await resp.json();
            const balance = endpoint.parse(data, address);
            if (balance !== null && balance !== undefined && !isNaN(balance) && balance > 0) {
                return { balance, error: null };
            }
        } catch (e) {
            continue;
        }
    }
    return { balance: null, error: 'All APIs failed for ' + chain };
}

// ============================================================
//  GENERATE + SCAN
// ============================================================
async function generateAndScan(chain) {
    const pk = generatePrivateKey();
    const addr = deriveAddress(pk, chain);
    const result = await scanAddress(addr, chain);
    const balance = result.balance;

    if (balance !== null && balance > 0) {
        const wallets = loadWallets();
        if (!wallets.some(w => w.address === addr)) {
            wallets.push({
                address: addr,
                privateKey: pk,
                chain: chain,
                balance: parseFloat(balance.toFixed(8)),
                found_at: new Date().toISOString()
            });
            saveWallets(wallets);
            sendLog(`💰 FOUND! ${addr.slice(0,12)}... | ${balance.toFixed(6)} ${chain.toUpperCase()}`, 'found');
        }
        return true;
    } else {
        // Log every 50th wallet to avoid spam
        if (Math.random() < 0.02) {
            sendLog(`🔍 ${chain.toUpperCase()} | ${addr.slice(0,12)}... | Balance: ${balance !== null ? balance : '0'}`, 'info');
        }
        return false;
    }
}

// ============================================================
//  API HEALTH CHECK
// ============================================================
let apiStatus = {};

async function checkAPIHealth() {
    const results = {};
    const testAddresses = {
        bitcoin: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        ethereum: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        bsc: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        polygon: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        solana: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWVb',
        tron: 'TQpM7XG8ZyHMVBmCozr9kLxUoY6j5xL4mJ',
        monero: '4'
    };
    
    for (const [chain, addr] of Object.entries(testAddresses)) {
        const result = await scanAddress(addr, chain);
        results[chain] = result.balance !== null ? '✅ Working' : '❌ Dead';
    }
    
    apiStatus = results;
    sendLog(`📊 API Health Check: ${JSON.stringify(results)}`, 'info');
}

// ============================================================
//  BACKGROUND LOOP — 24x7
// ============================================================
let stats = {
    generated: 0,
    scanned: 0,
    found: 0,
    errors: 0,
    startTime: Date.now()
};

async function loop() {
    sendLog('🔥 Farm started 24x7', 'info');
    sendLog('📁 Data file: wallets.json', 'info');
    
    await checkAPIHealth();
    
    while (true) {
        for (const chain of CHAINS) {
            try {
                const found = await generateAndScan(chain);
                stats.generated++;
                stats.scanned++;
                if (found) stats.found++;
            } catch (e) {
                stats.errors++;
                sendLog(`❌ Error on ${chain}: ${e.message}`, 'error');
            }
            await new Promise(r => setTimeout(r, 400));
        }
        
        // Check API health every 2 minutes
        if (stats.generated % 50 === 0) {
            await checkAPIHealth();
        }
        
        // Update stats every cycle
        const elapsed = (Date.now() - stats.startTime) / 1000 / 60;
        const speed = elapsed > 0 ? Math.round(stats.generated / elapsed) : 0;
        stats.speed = speed;
    }
}

// ============================================================
//  ROUTES
// ============================================================
app.get('/', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    res.send(`
        <h1>🔥 BruteForce Farm</h1>
        <p>✅ Running 24x7</p>
        <p>📊 Generated: ${stats.generated}</p>
        <p>💰 Found: ${loadWallets().length}</p>
        <p>⏳ Runtime: ${Math.floor(elapsed)}s</p>
        <p>📁 <a href="/dashboard">📱 Open Dashboard</a></p>
        <p>📡 <a href="/api/logs">Live Logs (SSE)</a></p>
    `);
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/stats', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    res.json({
        ...stats,
        runtime: Math.floor(elapsed),
        wallets_found: loadWallets().length,
        apiStatus: apiStatus
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        apiStatus: apiStatus,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000),
        wallets_found: loadWallets().length
    });
});

app.get('/api/wallets', (req, res) => {
    res.json(loadWallets());
});

app.get('/api/wallets/recent', (req, res) => {
    const w = loadWallets();
    res.json(w.slice(-20).reverse());
});

app.use(express.static('public'));

// ============================================================
//  START
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    setTimeout(loop, 2000);
});
