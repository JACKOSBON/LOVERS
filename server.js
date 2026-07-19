const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  DATA STORAGE
// ============================================================
const DATA_FILE = path.join(__dirname, 'wallets.json');

function loadWallets() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) { console.error('Load error:', e); }
    return [];
}

function saveWallets(wallets) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
    } catch (e) { console.error('Save error:', e); }
}

// ============================================================
//  API HEALTH STATUS
// ============================================================
let apiStatus = {};

async function checkAPIHealth() {
    const results = {};
    
    // Bitcoin
    try {
        const resp = await fetch('https://blockchain.info/balance?active=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', { signal: AbortSignal.timeout(5000) });
        results.bitcoin = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.bitcoin = '❌ Dead';
    }
    
    // Ethereum
    try {
        const resp = await fetch('https://api.etherscan.io/api?module=account&action=balance&address=0x742d35Cc6634C0532925a3b844Bc454e4438f44e&tag=latest&apikey=YourApiKeyToken', { signal: AbortSignal.timeout(5000) });
        results.ethereum = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.ethereum = '❌ Dead';
    }
    
    // BSC
    try {
        const resp = await fetch('https://api.bscscan.com/api?module=account&action=balance&address=0x742d35Cc6634C0532925a3b844Bc454e4438f44e&apikey=YourApiKeyToken', { signal: AbortSignal.timeout(5000) });
        results.bsc = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.bsc = '❌ Dead';
    }
    
    // Polygon
    try {
        const resp = await fetch('https://api.polygonscan.com/api?module=account&action=balance&address=0x742d35Cc6634C0532925a3b844Bc454e4438f44e&apikey=YourApiKeyToken', { signal: AbortSignal.timeout(5000) });
        results.polygon = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.polygon = '❌ Dead';
    }
    
    // Solana
    try {
        const resp = await fetch('https://api.solscan.io/account/9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWVb', { signal: AbortSignal.timeout(5000) });
        results.solana = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.solana = '❌ Dead';
    }
    
    // Tron
    try {
        const resp = await fetch('https://api.trongrid.io/v1/accounts/TQpM7XG8ZyHMVBmCozr9kLxUoY6j5xL4mJ', { signal: AbortSignal.timeout(5000) });
        results.tron = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.tron = '❌ Dead';
    }
    
    // Monero
    try {
        const resp = await fetch('https://xmrchain.net/api/address/4', { signal: AbortSignal.timeout(5000) });
        results.monero = resp.ok ? '✅ Working' : '❌ Dead';
    } catch (e) {
        results.monero = '❌ Dead';
    }
    
    apiStatus = results;
    console.log('📊 API Health Check:', results);
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
//  API CONFIG — WITH FALLBACKS
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
            { url: (addr) => `https://api.solscan.io/account/${addr}`,
                parse: (data) => { if (data.data && data.data.lamports !== undefined) return data.data.lamports / 1e9; return null; } }
        ]
    },
    tron: {
        label: 'TRX',
        endpoints: [
            { url: (addr) => `https://api.trongrid.io/v1/accounts/${addr}`,
                parse: (data) => { if (data.balance !== undefined) return data.balance / 1e6; return null; } }
        ]
    },
    monero: {
        label: 'XMR',
        endpoints: [
            { url: (addr) => `https://xmrchain.net/api/address/${addr}`,
                parse: (data) => { if (data.balance !== undefined) return data.balance / 1e12; return null; } }
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
            console.log(`💰 FOUND! ${addr} | ${balance} ${chain}`);
        }
        return true;
    }
    return false;
}

// ============================================================
//  BACKGROUND LOOP — 24x7
// ============================================================
let stats = {
    generated: 0,
    scanned: 0,
    found: 0,
    errors: 0,
    startTime: Date.now(),
    apiStatus: {}
};

async function loop() {
    console.log('🔥 Farm started 24x7');
    
    // Initial API health check
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
                console.error('Error:', e.message);
            }
            await new Promise(r => setTimeout(r, 400));
        }
        
        // Check API health every 5 minutes
        if (stats.generated % 100 === 0) {
            await checkAPIHealth();
        }
    }
}

// ============================================================
//  ROUTES
// ============================================================
app.get('/', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const wallets = loadWallets();
    res.send(`
        <h1>🔥 BruteForce Farm</h1>
        <p>✅ Running 24x7</p>
        <p>📊 Generated: ${stats.generated}</p>
        <p>💰 Found: ${wallets.length}</p>
        <p>⏳ Runtime: ${Math.floor(elapsed)}s</p>
        <p>📁 <a href="/dashboard">📱 Open Dashboard</a></p>
        <p>📊 <a href="/api/health">API Health</a></p>
        <p>📊 <a href="/api/stats">Stats</a></p>
    `);
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/stats', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const speed = elapsed > 0 ? Math.round(stats.generated / (elapsed / 60)) : 0;
    res.json({
        ...stats,
        runtime: Math.floor(elapsed),
        speed: speed,
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
