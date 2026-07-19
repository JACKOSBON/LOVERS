const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  GITHUB CONFIG — from environment variables
// ============================================================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Render env variable
const GITHUB_REPO = process.env.GITHUB_REPO || 'JACKOSBON/LOVERS';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

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
//  GITHUB AUTO-PUSH FUNCTION
// ============================================================
async function pushToGitHub() {
    if (!GITHUB_TOKEN) {
        console.log('⚠️ No GITHUB_TOKEN set. Skipping push.');
        return;
    }

    try {
        const repoUrl = `https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;
        
        // Check if git is initialized
        if (!fs.existsSync(path.join(__dirname, '.git'))) {
            console.log('📦 Initializing git...');
            exec(`git init`, { cwd: __dirname }, (err) => {
                if (err) console.error('Git init error:', err);
            });
            exec(`git remote add origin ${repoUrl}`, { cwd: __dirname }, (err) => {
                if (err) console.error('Remote add error:', err);
            });
            exec(`git pull origin ${GITHUB_BRANCH} --allow-unrelated-histories`, { cwd: __dirname }, (err) => {
                if (err) console.error('Pull error:', err);
            });
        }

        // Add, commit, push
        exec(`git add wallets.json`, { cwd: __dirname }, (err) => {
            if (err) return console.error('Add error:', err);
            
            exec(`git commit -m "Auto update wallets ${new Date().toISOString()}"`, { cwd: __dirname }, (err) => {
                if (err) return console.error('Commit error:', err);
                
                exec(`git push origin ${GITHUB_BRANCH}`, { cwd: __dirname }, (err, stdout, stderr) => {
                    if (err) return console.error('Push error:', err);
                    console.log('✅ Pushed to GitHub:', stdout);
                });
            });
        });
    } catch (e) {
        console.error('GitHub push error:', e);
    }
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
//  API CONFIG
// ============================================================
const APIS = {
    bitcoin: {
        endpoints: [(addr) => `https://blockchain.info/balance?active=${addr}`],
        parse: (data, addr) => {
            if (data.balance !== undefined) return data.balance / 1e8;
            if (data.data && data.data[addr]) return data.data[addr].balance / 1e8;
            return null;
        }
    },
    ethereum: {
        endpoints: [(addr) => `https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest&apikey=YourApiKeyToken`],
        parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; }
    },
    bsc: {
        endpoints: [(addr) => `https://api.bscscan.com/api?module=account&action=balance&address=${addr}&apikey=YourApiKeyToken`],
        parse: (data) => { if (data.result !== undefined) return parseInt(data.result) / 1e18; return null; }
    },
    polygon: {
        endpoints: [(addr) => `https://api.polygonscan.com/api?module=account&action=balance&address=${addr}&apikey=YourApiKeyToken`],
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

// ============================================================
//  SCAN FUNCTION
// ============================================================
async function scanAddress(address, chain) {
    const config = APIS[chain];
    if (!config) return null;
    for (const urlFn of config.endpoints) {
        try {
            const url = urlFn(address);
            const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!resp.ok) continue;
            const data = await resp.json();
            const balance = config.parse(data, address);
            if (balance !== null && balance !== undefined && !isNaN(balance) && balance > 0) {
                return balance;
            }
        } catch (e) { continue; }
    }
    return null;
}

// ============================================================
//  GENERATE + SCAN
// ============================================================
async function generateAndScan(chain) {
    const pk = generatePrivateKey();
    const addr = deriveAddress(pk, chain);
    const balance = await scanAddress(addr, chain);

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
            // Push to GitHub immediately when found
            await pushToGitHub();
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
    startTime: Date.now()
};

async function loop() {
    console.log('🔥 Farm started 24x7');
    console.log(`📁 GitHub Repo: ${GITHUB_REPO}`);
    console.log(`🔑 Token: ${GITHUB_TOKEN ? '✅ Set' : '❌ Not Set'}`);
    
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
        // Push to GitHub every 5 minutes (even if no new wallets)
        if (stats.generated % 100 === 0) {
            await pushToGitHub();
        }
    }
}

// ============================================================
//  ROUTES
// ============================================================
app.get('/', (req, res) => {
    res.send(`
        <h1>🔥 BruteForce Farm</h1>
        <p>✅ Running 24x7</p>
        <p>📊 <a href="/api/stats">Stats</a> | 💰 <a href="/api/wallets">Wallets</a></p>
        <p>Found: ${loadWallets().length} wallets</p>
        <p>📁 Auto-push to: <a href="https://github.com/${GITHUB_REPO}">${GITHUB_REPO}</a></p>
        <hr/>
        <p><a href="/dashboard">📱 Open Dashboard</a></p>
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
        github_repo: GITHUB_REPO,
        github_token_set: !!GITHUB_TOKEN
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
    console.log(`📁 Data file: ${DATA_FILE}`);
    console.log(`📁 GitHub Repo: ${GITHUB_REPO}`);
    console.log(`🔑 Token: ${GITHUB_TOKEN ? '✅ Set' : '❌ Not Set'}`);
    setTimeout(loop, 2000);
});
