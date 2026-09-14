const http = require('http');
const https = require('https');
const url = require('url');
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
    const parsedUrl = url.parse(req.url, true);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // --- GATEKEEPER PIPELINE ---
    // Handle the cryptographic credential handshake check
    if (parsedUrl.pathname === '/' && (req.url.includes('?sig=') || req.url.includes('?otp='))) {
        const incomingSignature = parsedUrl.query.sig;
        const clientDeviceID = parsedUrl.query.id || 'unknown';
        const rawOtp = parsedUrl.query.otp;

        const fingerprint = crypto.createHash('sha256').update(`${clientIp}-${clientDeviceID}`).digest('hex');
        const db = readDB();

        // 1. Initialize user footprint if completely new
        if (!db[fingerprint]) {
            db[fingerprint] = { isbanned: false, useserverdata: false };
            writeDB(db);
        }

        // 2. Reject if banned (Poison Pill Eviction)
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
        
        // Handle immediate raw parameter compilation fallback if they didn't hash client side yet
        let isValid = false;
        if (rawOtp === currentCorrectOtp) {
            isValid = true;
        } else if (incomingSignature) {
            const localCombinedString = `${currentCorrectOtp}|||${clientDeviceID}`;
            const serverCalculatedSignature = crypto.createHash('sha256').update(localCombinedString).digest('hex');
            if (incomingSignature === serverCalculatedSignature) isValid = true;
        }

        // 3. Process Authentication Result
        if (isValid) {
            delete failTracker[fingerprint];
            db[fingerprint].useserverdata = true; // Elevate node privilege
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
            // Log strikes for faulty validation payloads
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

    // --- PROXY DATA PIPELINE ---
    if (parsedUrl.pathname === '/proxy' && parsedUrl.query.url) {
        try {
            const decodedUrl = Buffer.from(parsedUrl.query.url, 'base64').toString('utf-8');
            const target = url.parse(decodedUrl);
            const clientEngine = target.protocol === 'https:' ? https : http;

            const proxyOptions = {
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.path,
                method: req.method,
                headers: {
                    ...req.headers,
                    host: target.hostname,
                    referer: target.protocol + '//' + target.hostname
                }
            };

            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';
                
                // If the response is basic text/html data, we buffer it to rewrite paths
                if (contentType.includes('text/html') || contentType.includes('application/javascript')) {
                    let bodyBuffer = [];

                    proxyRes.on('data', (chunk) => bodyBuffer.push(chunk));
                    proxyRes.on('end', () => {
                        let contentString = Buffer.concat(bodyBuffer).toString('utf-8');

                        // --- SERVER-SIDE REWRITER SYSTEM ---
                        // Automatically intercept literal links and bind them back into our Base64 engine
                        const hostAddress = `http://${req.headers.host}`;
                        
                        // Target domain match strings (Expand this list as needed)
                        const domainsToRewrite = ['roblox.com', '://roblox.com', '://roblox.com'];
                        
                        domainsToRewrite.forEach(domain => {
                            const rawUrlPattern = `https://${domain}`;
                            // This regex replaces instances of the domain links inside href or src values
                            const regex = new RegExp(rawUrlPattern, 'g');
                            contentString = contentString.replace(regex, `${hostAddress}/proxy?url=${Buffer.from(rawUrlPattern).toString('base64')}`);
                        });

                        // Inject an inline client-side hook as a backup layer to catch dynamic javascript clicks
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
                    // Fast pipeline piping for non-text components (images, audio channels, icons)
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
    else if (parsedUrl.pathname === '/dashboard') {
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
                <p>Gentoo Data pipeline verification complete.</p>
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
    // --- ROOT DEFAULT DECOY PATH ---
    else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><head><title>Sanoma Learning Portal</title></head><body style="margin:0;"><iframe src="https://sanomalearning.com" style="width:100%; height:100vh; border:none;"></iframe></body></html>`);
    }
});

server.listen(PORT, () => console.log("[SYS ENGINE] Proxy node actively processing traffic on port ${PORT}"));