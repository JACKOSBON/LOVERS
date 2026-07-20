const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

// ============================================================
//  BITCOIN CRYPTO (Pure JS — No external heavy libs)
// ============================================================

// --- secp256k1 constants ---
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;

// --- Modular inverse ---
function modinv(a, m = N) {
    let t = 0n, newt = 1n;
    let r = m, newr = a;
    while (newr !== 0n) {
        let q = r / newr;
        [t, newt] = [newt, t - q * newt];
        [r, newr] = [newr, r - q * newr];
    }
    if (t < 0n) t += m;
    return t;
}

// --- Point addition ---
function pointAdd(P1, P2) {
    if (P1 === null) return P2;
    if (P2 === null) return P1;
    const [x1, y1] = P1;
    const [x2, y2] = P2;
    if (x1 === x2) {
        if (y1 !== y2) return null;
        const lam = (3n * x1 * x1) * modinv(2n * y1, P) % P;
        const x3 = (lam * lam - x1 - x2) % P;
        const y3 = (lam * (x1 - x3) - y1) % P;
        return [x3, y3];
    }
    const lam = (y2 - y1) * modinv(x2 - x1, P) % P;
    const x3 = (lam * lam - x1 - x2) % P;
    const y3 = (lam * (x1 - x3) - y1) % P;
    return [x3, y3];
}

// --- Point multiplication ---
function pointMul(k, P = [Gx, Gy]) {
    let R = null;
    let Q = P;
    let k_bits = k;
    while (k_bits > 0n) {
        if (k_bits & 1n) R = pointAdd(R, Q);
        Q = pointAdd(Q, Q);
        k_bits >>= 1n;
    }
    return R;
}

// --- Private key to public key ---
function privToPub(d) {
    const pt = pointMul(d);
    if (pt === null) return null;
    const [x, y] = pt;
    const xHex = x.toString(16).padStart(64, '0');
    const yHex = y.toString(16).padStart(64, '0');
    const prefix = (y & 1n) === 0n ? '02' : '03';
    return prefix + xHex;
}

// --- SHA256 ---
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

// --- RIPEMD160 ---
function ripemd160(data) {
    return crypto.createHash('ripemd160').update(data).digest();
}

// --- Base58 encoding ---
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer) {
    let num = BigInt('0x' + buffer.toString('hex'));
    let result = '';
    while (num > 0n) {
        const rem = Number(num % 58n);
        result = BASE58_ALPHABET[rem] + result;
        num = num / 58n;
    }
    const pad = buffer.length - buffer.toString('hex').replace(/^0+/, '').length / 2;
    return '1'.repeat(pad) + result;
}

// --- Derive Bitcoin address from private key ---
function deriveAddress(privateKeyHex) {
    try {
        const d = BigInt('0x' + privateKeyHex);
        if (d === 0n || d >= N) return null;
        
        const pubKeyHex = privToPub(d);
        if (!pubKeyHex) return null;
        
        const pubKeyBuffer = Buffer.from(pubKeyHex, 'hex');
        const hash160 = ripemd160(sha256(pubKeyBuffer));
        const payload = Buffer.concat([Buffer.from('00', 'hex'), hash160]);
        const checksum = sha256(sha256(payload)).slice(0, 4);
        const addressBuffer = Buffer.concat([payload, checksum]);
        
        return base58Encode(addressBuffer);
    } catch (e) {
        return null;
    }
}

// ============================================================
//  CONFIG
// ============================================================
const TARGET_FILE = path.join(__dirname, 'target_addresses.txt');
const MATCHED_FILE = path.join(__dirname, 'matched_wallets.txt');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'JACKOSBON/LOVERS';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// ============================================================
//  LOAD TARGET ADDRESSES
// ============================================================
let targetAddresses = new Set();

function loadTargets() {
    try {
        if (fs.existsSync(TARGET_FILE)) {
            const data = fs.readFileSync(TARGET_FILE, 'utf8');
            const lines = data.split('\n').filter(l => l.trim());
            targetAddresses = new Set(lines.map(l => l.trim()));
            console.log(`📊 Loaded ${targetAddresses.size} target addresses`);
        } else {
            // Create default file with sample addresses
            const sample = [
                '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
                '1LqVpVj2qLH6hqXGxE9UQbyy4Gz6KXG2zV',
                '1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF'
            ];
            fs.writeFileSync(TARGET_FILE, sample.join('\n'));
            targetAddresses = new Set(sample);
            console.log('📁 Created sample target_addresses.txt');
        }
    } catch (e) {
        console.error('❌ Load targets error:', e);
    }
}

// ============================================================
//  SAVE MATCHED WALLET
// ============================================================
function saveMatched(privateKey, address) {
    try {
        const line = `${address}:${privateKey}\n`;
        fs.appendFileSync(MATCHED_FILE, line);
        console.log(`✅ MATCH FOUND! ${address}`);
        pushToGitHub();
    } catch (e) {
        console.error('❌ Save error:', e);
    }
}

// ============================================================
//  LOAD EXISTING MATCHES (to avoid duplicates)
// ============================================================
let matchedSet = new Set();

function loadMatches() {
    try {
        if (fs.existsSync(MATCHED_FILE)) {
            const data = fs.readFileSync(MATCHED_FILE, 'utf8');
            const lines = data.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    matchedSet.add(parts[0]);
                }
            }
            console.log(`📊 Already matched: ${matchedSet.size} wallets`);
        }
    } catch (e) {}
}

// ============================================================
//  GENERATE AND MATCH
// ============================================================
let stats = {
    generated: 0,
    matched: 0,
    startTime: Date.now()
};

async function generateAndMatch() {
    const privateKey = crypto.randomBytes(32).toString('hex');
    stats.generated++;
    
    const address = deriveAddress(privateKey);
    if (!address) return;
    
    // Check if address matches target
    if (targetAddresses.has(address) && !matchedSet.has(address)) {
        matchedSet.add(address);
        stats.matched++;
        saveMatched(privateKey, address);
        console.log(`💰 MATCH! ${address} -> ${privateKey}`);
    }
    
    // Log every 1000 attempts
    if (stats.generated % 1000 === 0) {
        console.log(`⏳ Generated ${stats.generated}, Matched ${stats.matched}`);
    }
}

// ============================================================
//  PUSH TO GITHUB
// ============================================================
async function pushToGitHub() {
    if (!GITHUB_TOKEN) return;

    try {
        const repoUrl = `https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;
        
        if (!fs.existsSync(path.join(__dirname, '.git'))) {
            exec(`git init`, { cwd: __dirname }, () => {});
            exec(`git remote add origin ${repoUrl}`, { cwd: __dirname }, () => {});
            exec(`git pull origin ${GITHUB_BRANCH} --allow-unrelated-histories`, { cwd: __dirname }, () => {});
        }

        exec(`git add matched_wallets.txt target_addresses.txt`, { cwd: __dirname }, (err) => {
            if (err) return;
            exec(`git commit -m "Auto update matched ${new Date().toISOString()}"`, { cwd: __dirname }, (err) => {
                if (err) return;
                exec(`git push origin ${GITHUB_BRANCH}`, { cwd: __dirname }, (err) => {
                    if (err) console.error('Push error:', err);
                    else console.log('✅ Pushed to GitHub');
                });
            });
        });
    } catch (e) {
        console.error('GitHub error:', e);
    }
}

// ============================================================
//  BACKGROUND LOOP
// ============================================================
async function loop() {
    console.log('🔥 Wallet Matcher started 24x7');
    console.log(`📁 Target addresses: ${targetAddresses.size}`);
    console.log(`📁 Already matched: ${matchedSet.size}`);
    
    while (true) {
        await generateAndMatch();
        // Small delay to avoid CPU overload
        await new Promise(r => setTimeout(r, 10));
    }
}

// ============================================================
//  WEB SERVER
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    res.send(`
        <h1>🔓 Wallet Matcher</h1>
        <p>✅ Running 24x7</p>
        <p>📊 Generated: ${stats.generated}</p>
        <p>💰 Matched: ${stats.matched}</p>
        <p>🎯 Targets: ${targetAddresses.size}</p>
        <p>⏳ Runtime: ${Math.floor(elapsed)}s</p>
        <p>📁 <a href="/dashboard">Dashboard</a></p>
        <p>📁 <a href="/matched_wallets.txt">Matched Wallets</a></p>
        <p>📁 <a href="/target_addresses.txt">Target Addresses</a></p>
    `);
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/stats', (req, res) => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    res.json({
        generated: stats.generated,
        matched: stats.matched,
        targets: targetAddresses.size,
        runtime: Math.floor(elapsed),
        matched_list: matchedSet.size
    });
});

app.get('/matched_wallets.txt', (req, res) => {
    if (fs.existsSync(MATCHED_FILE)) {
        res.sendFile(MATCHED_FILE);
    } else {
        res.send('No matches yet');
    }
});

app.get('/target_addresses.txt', (req, res) => {
    if (fs.existsSync(TARGET_FILE)) {
        res.sendFile(TARGET_FILE);
    } else {
        res.send('No target addresses');
    }
});

app.use(express.static('public'));

// ============================================================
//  START
// ============================================================
loadTargets();
loadMatches();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server on port ${PORT}`);
    setTimeout(loop, 2000);
});
