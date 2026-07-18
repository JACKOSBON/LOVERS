const express = require('express');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== DATA STORAGE ==========
const DATA_FILE = 'wallets.json';

function loadWallets() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE));
        }
    } catch (e) {}
    return [];
}

function saveWallets(wallets) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
}

// ========== CRYPTO ==========
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
        return base58Encode(Buffer.from(hexAddr, 'hex'));
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

// ========== API CONFIG ==========
const APIS = {
    bitcoin: {
        endpoints: [
            (addr) => `https://blockchain.info/balance?active=${addr}`,
            (addr) => `https://chain.api.btc.com/v3/address/${addr}`
        ],
        parse: (data, addr) => {
            if (data.balance !== undefined) return data.balance / 1e8;
            if (data.data && data.data[addr]) return data.data[addr].balance / 1e8;
            if (data.data && data.data.balance !== undefined) return data.data.balance / 1e8;
            return null;
        }
    },
    ethereum: {
        endpoints: [(addr) =>
            `https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest&apikey=YourApiKeyToken`
        ],
        parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; }
    },
    bsc: {
        endpoints: [(addr) =>
            `https://api.bscscan.com/api?module=account&action=balance&address=${addr}&apikey=YourApiKeyToken`
        ],
        parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; }
    },
    polygon: {
        endpoints: [(addr) =>
            `https://api.polygonscan.com/api?module=account&action=balance&address=${addr}&apikey=YourApiKeyToken`
        ],
        parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; }
    },
    solana: {
        endpoints: [(addr) => `https://api.solscan.io/account/${addr}`],
        parse: (data) => { if (data.data && data.data.lamports !== undefined) return data.data.lamports / 1e9; return null; }
    },
    tron: {
        endpoints: [(addr) => `https://api.trongrid.io/v1/accounts/${addr}`],
        parse: (data) => { if (data.balance !== undefined) return data.balance / 1e6; return null; }
    },
    monero: {
        endpoints: [(addr) => `https://xmrchain.net/api/address/${addr}`],
        parse: (data) => { if (data.balance !== undefined) return data.balance / 1e12; return null; }
    }
};

const CHAINS = ['bitcoin', 'ethereum', 'bsc', 'polygon', 'solana', 'tron', 'monero'];

// ========== SCAN ==========
async function scanAddress(address, chain) {
    const config = APIS[chain];
    if (!config) return null;

    for (const urlFn of config.endpoints) {
        try {
            const url = urlFn(address);
            const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!resp.ok) continue;
            const data = await resp.json();
            const balance = config.parse(data, address);
            if (balance !== null && balance !== undefined && !isNaN(balance) && balance > 0) {
                return balance;
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

// ========== GENERATE + SCAN ==========
async function generateAndScan(chain) {
    const pk = generatePrivateKey();
    const addr = deriveAddress(pk, chain);
    const balance = await scanAddress(addr, chain);

    console.log(`${chain} | ${addr.slice(0, 12)}... | Bal: ${balance !== null ? balance : '0'}`);

    if (balance !== null && balance > 0) {
        const wallets = loadWallets();
        const exists = wallets.some(w => w.address === addr);
        if (!exists) {
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

// ========== BACKGROUND LOOP ==========
let stats = { generated: 0, scanned: 0, found: 0, startTime: Date.now() };

async function loop() {
    console.log('🔥 Farm started!');
    while (true) {
        for (const chain of CHAINS) {
            const found = await generateAndScan(chain);
            stats.generated++;
            stats.scanned++;
            if (found) stats.found++;
            await new Promise(r => setTimeout(r, 400));
        }
    }
}

// ========== API ==========
app.get('/api/stats', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const speed = elapsed > 0 ? Math.round(stats.generated / (elapsed / 60)) : 0;
    res.json({ ...stats, runtime: Math.floor(elapsed), speed, wallets_found: loadWallets().length });
});

app.get('/api/wallets', (req, res) => {
    res.json(loadWallets());
});

app.get('/api/wallets/recent', (req, res) => {
    const wallets = loadWallets();
    res.json(wallets.slice(-20).reverse());
});

// ========== SERVE FRONTEND ==========
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Server on port ${PORT}`);
    setTimeout(loop, 2000);
});
