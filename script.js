// server.js — 24x7 Wallet Farm with Persistent Storage

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
//  CONFIG
// ================================================================
const DATA_FILE = path.join(__dirname, 'wallets.json');
const LOG_FILE = path.join(__dirname, 'farm.log');

// Chains to scan
const CHAINS = ['bitcoin', 'ethereum', 'bsc', 'polygon', 'solana', 'tron', 'monero'];

// ================================================================
//  STORAGE
// ================================================================
function loadWallets() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { console.error('Load error:', e); }
    return [];
}

function saveWallets(wallets) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
    } catch (e) { console.error('Save error:', e); }
}

function logToFile(msg) {
    try {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    } catch (e) {}
}

// ================================================================
//  CRYPTO FUNCTIONS
// ================================================================
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
        const hexAddr = withPrefix + checksum;
        const buffer = Buffer.from(hexAddr, 'hex');
        return base58Encode(buffer);
    } else if (['ethereum', 'bsc', 'polygon'].includes(chain)) {
        return '0x' + hash.slice(-40);
    } else if (chain === 'solana') {
        const buffer = Buffer.from(hash.slice(0, 44), 'hex');
        return base58Encode(buffer);
    } else if (chain === 'tron') {
        return 'T' + hash.slice(0, 33);
    } else if (chain === 'monero') {
        return '4' + hash.slice(0, 94);
    }
    return hash.slice(0, 42);
}

// ================================================================
//  API CONFIG — WITH FALLBACKS
// ================================================================
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

// ================================================================
//  SCAN FUNCTION — WITH ERROR HANDLING
// ================================================================
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
            if (balance !== null && balance !== undefined && !isNaN(balance)) {
                return { balance, error: null };
            }
        } catch (e) {
            continue;
        }
    }
    return { balance: null, error: 'All APIs failed' };
}

// ================================================================
//  GENERATE + SCAN ONE WALLET
// ================================================================
async function generateAndScan(chain) {
    const privateKey = generatePrivateKey();
    const address = deriveAddress(privateKey, chain);

    const result = await scanAddress(address, chain);
    const balance = result.balance;
    const error = result.error;

    const logMsg = `${chain.toUpperCase()} | PK: ${privateKey.slice(0,8)}... | Addr: ${address.slice(0,12)}... | Bal: ${balance !== null ? balance.toFixed(8) : 'ERROR'}`;
    console.log(logMsg);
    logToFile(logMsg);

    if (balance !== null && balance > 0 && !isNaN(balance)) {
        const wallets = loadWallets();
        // Check if already exists
        const exists = wallets.some(w => w.address === address && w.chain === chain);
        if (!exists) {
            wallets.push({
                address,
                privateKey,
                chain,
                balance: parseFloat(balance.toFixed(8)),
                found_at: new Date().toISOString()
            });
            saveWallets(wallets);
            console.log(`💰 FOUND! ${address} | ${balance} ${chain}`);
            logToFile(`💰 FOUND! ${address} | ${balance} ${chain}`);
        }
        return { address, privateKey, chain, balance, found: true };
    }

    return { address, privateKey, chain, balance: balance || 0, found: false, error };
}

// ================================================================
//  BACKGROUND LOOP — 24x7
// ================================================================
let stats = {
    generated: 0,
    scanned: 0,
    found: 0,
    errors: 0,
    startTime: Date.now()
};

async function backgroundLoop() {
    console.log('[Farm] Started 24x7 generation + scanning');
    logToFile('[Farm] Started 24x7 generation + scanning');

    while (true) {
        for (const chain of CHAINS) {
            try {
                const result = await generateAndScan(chain);
                stats.generated++;
                stats.scanned++;
                if (result.found) stats.found++;
                if (result.error) stats.errors++;
            } catch (e) {
                stats.errors++;
                console.error(`[Error] ${chain}:`, e.message);
                logToFile(`[Error] ${chain}: ${e.message}`);
            }
            // Delay to avoid rate limits
            await new Promise(r => setTimeout(r, 500));
        }
        // Update stats every cycle
        const elapsed = (Date.now() - stats.startTime) / 1000 / 60;
        const speed = elapsed > 0 ? Math.round(stats.generated / elapsed) : 0;
        stats.speed = speed;
    }
}

// ================================================================
//  API ROUTES
// ================================================================
app.get('/api/stats', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    res.json({
        ...stats,
        runtime: Math.floor(elapsed),
        wallets_found: loadWallets().length
    });
});

app.get('/api/wallets', (req, res) => {
    const wallets = loadWallets();
    res.json(wallets);
});

app.get('/api/wallets/recent', (req, res) => {
    const wallets = loadWallets();
    const recent = wallets.slice(-20).reverse();
    res.json(recent);
});

app.get('/api/scan', async (req, res) => {
    const chain = req.query.chain || 'bitcoin';
    const address = req.query.address;
    if (!address) {
        return res.status(400).json({ error: 'Address required' });
    }
    const result = await scanAddress(address, chain);
    res.json({ address, chain, ...result });
});

app.get('/api/generate', async (req, res) => {
    const chain = req.query.chain || 'bitcoin';
    const result = await generateAndScan(chain);
    res.json(result);
});

// ================================================================
//  FRONTEND — Serve Dashboard
// ================================================================
app.use(express.static('public'));

// ================================================================
//  START SERVER
// ================================================================
app.listen(PORT, () => {
    console.log(`[Farm] Server running on http://localhost:${PORT}`);
    logToFile(`[Farm] Server started on port ${PORT}`);

    // Start background loop after server starts
    setTimeout(() => {
        backgroundLoop();
    }, 2000);
});
