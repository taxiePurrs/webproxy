const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8080;
const DB_FILE = path.join(__dirname, 'database.json');
const SECRET_SALT = "gentoo_linux_6.18_crypto_salt_2026";
const MAX_ATTEMPTS = 3;

// Transient memory structure to log failed strike attempts before a hard-ban
const failTracker = {};

// Ensure our JSON flat-file database exists with proper root brackets
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 4), 'utf-8');
}

function readDB() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4), 'utf-8'); }

// Cryptographic engine to compute our moving 12-digit security token (updates every 30s)
function getActive12DigitToken() {
    const timeBlock = Math.floor(Date.now() / 1000 / 30);
    const hash = crypto.createHmac('sha256', SECRET_SALT).update(timeBlock.toString()).digest('hex');
    return (parseInt(hash.substring(0, 12), 16) % 1000000000000).toString().padStart(12, '0');
}

const server = http.createServer((req, res) => {
    // Construct a modern WHATWG URL object cleanly
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${hostHeader}`);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // --- TEMPORARILY DISABLED GATEKEEPER PIPELINE ---
    /*
    if (parsedUrl.pathname === '/' && (parsedUrl.searchParams.has('sig') || parsedUrl.searchParams.has('otp'))) {
        const incomingSignature = parsedUrl.searchParams.get('sig');
        const clientDeviceID = parsedUrl.searchParams.get('id') || 'unknown';
        const rawOtp = parsedUrl.searchParams.get('otp');

        const fingerprint = crypto.createHash('sha256').update(`${clientIp}-${clientDeviceID}`).digest('hex');
        const db = readDB();

        if (!db[fingerprint]) {
            db[fingerprint] = { isbanned: false, useserverdata: false };
            writeDB(db);
        }

        if (db[fingerprint].isbanned) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(`
                <script>
                    localStorage.clear();
                    window.location.href = "https://sanomalearning.com";
                </script>
            `);
        }

        const currentCorrectOtp = getActive12DigitToken();
        
        let isValid = false;
        if (rawOtp === currentCorrectOtp) {
            isValid = true;
        } else if (incomingSignature) {
            const localCombinedString = `${currentCorrectOtp}|||${clientDeviceID}`;
            const serverCalculatedSignature = crypto.createHash('sha256').update(localCombinedString).digest('hex');
            if (incomingSignature === serverCalculatedSignature) isValid = true;
        }

        if (isValid) {
            delete failTracker[fingerprint];
            db[fingerprint].useserverdata = true; 
            writeDB(db);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(`
                <script>
                    localStorage.setItem("session_verified", "true");
                    localStorage.setItem("permanent_device_id", "${clientDeviceID}");
                    window.location.href = "/dashboard";
                </script>
            `);
        } else {
            failTracker[fingerprint] = (failTracker[fingerprint] || 0) + 1;
            if (failTracker[fingerprint] >= MAX_ATTEMPTS) {
                db[fingerprint].isbanned = true;
                db[fingerprint].useserverdata = false;
                writeDB(db);
                delete failTracker[fingerprint];
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(`<script>localStorage.clear(); window.location.href="https://sanomalearning.com";</script>`);
            }
            res.writeHead(500);
            return res.end("Authentication signature mismatch.");
        }
    }
    */

    // --- PROXY DATA PIPELINE ---
    if (parsedUrl.pathname === '/proxy' && parsedUrl.searchParams.has('url')) {
        try {
            const decodedUrlStr = Buffer.from(parsedUrl.searchParams.get('url'), 'base64').toString('utf-8');
            const target = new URL(decodedUrlStr);
            const clientEngine = target.protocol === 'https:' ? https : http;

            const proxyOptions = {
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.pathname + target.search,
                method: req.method,
                headers: {
                    ...req.headers,
                    host: target.hostname,
                    referer: target.protocol + '//' + target.hostname
                }
            };

            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';
                
                if (contentType.includes('text/html') || contentType.includes('application/javascript')) {
                    let bodyBuffer = [];

                    proxyRes.on('data', (chunk) => bodyBuffer.push(chunk));
                    proxyRes.on('end', () => {
                        let contentString = Buffer.concat(bodyBuffer).toString('utf-8');

                        // --- SERVER-SIDE REWRITER SYSTEM ---
                        const hostAddress = `http://${req.headers.host}`;
                        const domainsToRewrite = ['roblox.com', '://roblox.com', '://roblox.com'];
                        
                        domainsToRewrite.forEach(domain => {
                            const rawUrlPattern = `https://${domain}`;
                            const regex = new RegExp(rawUrlPattern, 'g');
                            contentString = contentString.replace(regex, `${hostAddress}/proxy?url=${Buffer.from(rawUrlPattern).toString('base64')}`);
                        });

                        if (contentType.includes('text/html')) {
                            const clientScriptHook = `
                                <script>
                                    document.addEventListener('click', function(e) {
                                        const link = e.target.closest('a');
                                        if (link && link.href && !link.href.includes(window.location.host)) {
                                            e.preventDefault();
                                            window.location.href = '/proxy?url=' + btoa(link.href);
                                        }
                                    }, true);
                                </script>
                            `;
                            contentString = contentString.replace('</body>', `${clientScriptHook}</body>`);
                        }

                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(contentString);
                    });
                } else {
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    proxyRes.pipe(res);
                }
            });

            proxyReq.on('error', (err) => {
                res.writeHead(500);
                res.end(`Target routing failed: ${err.message}`);
            });

            req.pipe(proxyReq);

        } catch (error) {
            res.writeHead(400);
            res.end("Invalid encoding schema payload.");
        }
    } 
    // --- PRIVATE DASHBOARD HOOK ---
    else if (parsedUrl.pathname === '/dashboard' || parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
            <head>
                <title>Secure Workspace Terminal</title>
                <style>
                    body { font-family: sans-serif; background: #121212; color: #fff; text-align: center; padding-top: 50px; }
                    input { padding: 10px; width: 300px; border-radius: 4px; border: 1px solid #444; background: #222; color: #fff; }
                    button { padding: 10px 20px; background: #007acc; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
                </style>
            </head>
            <body>
                <h1>Proxy Operational Node Dashboard</h1>
                <p>Gentoo Data pipeline verification complete. (Auth Bypass Mode Active)</p>
                <input type="text" id="target" placeholder="Enter target site URL (e.g., https://://roblox.com)">
                <button onclick="launch()">Connect</button>
                <script>
                    function launch() {
                        const target = document.getElementById('target').value;
                        if(target) window.location.href = '/proxy?url=' + btoa(target);
                    }
                </script>
            </body>
            </html>
        `);
    }
    // --- ROOT DEFAULT DECOY PATH (FALLBACK) ---
    else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
            <head><title>Sanoma Learning Portal</title></head>
            <body style="margin:0;"><iframe src="https://sanomalearning.com" style="width:100%; height:100vh; border:none;"></iframe></body>
            </html>
        `);
    }
});

server.listen(PORT, () => console.log(`[SYS ENGINE] Proxy node actively processing traffic on port ${PORT}`));
