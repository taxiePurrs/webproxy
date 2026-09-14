const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8080;
const DB_FILE = path.join(__dirname, 'database.json');
const SECRET_SALT = "gentoo_linux_6.18_crypto_salt_2026";
const MAX_ATTEMPTS = 3;

const failTracker = {};

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 4), 'utf-8');
}

function readDB() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4), 'utf-8'); }

function getActive12DigitToken() {
    const timeBlock = Math.floor(Date.now() / 1000 / 30);
    const hash = crypto.createHmac('sha256', SECRET_SALT).update(timeBlock.toString()).digest('hex');
    return (parseInt(hash.substring(0, 12), 16) % 1000000000000).toString().padStart(12, '0');
}

const server = http.createServer((req, res) => {
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${hostHeader}`);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // --- LOG COLLECTION ENDPOINT ---
    if (parsedUrl.pathname === '/log' && req.method === 'POST') {
        let logBody = [];
        req.on('data', chunk => logBody.push(chunk));
        req.on('end', () => {
            try {
                const logPayload = JSON.parse(Buffer.concat(logBody).toString('utf-8'));
                const prefix = `[BROWSER ${logPayload.type.toUpperCase()}]`;
                
                // Color codes for the Linux terminal output
                if (logPayload.type === 'error') {
                    console.log(`\x1b[31%m${prefix} ${logPayload.message}\x1b[0m`);
                } else if (logPayload.type === 'warn') {
                    console.log(`\x1b[33%m${prefix} ${logPayload.message}\x1b[0m`);
                } else {
                    console.log(`${prefix} ${logPayload.message}`);
                }
            } catch (e) {}
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ status: 'logged' }));
        });
        return;
    }

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

                        const hostAddress = `http://${req.headers.host}`;
                        // Expanded domain definitions list to attempt to catch more paths
                        const domainsToRewrite = ['roblox.com', '://roblox.com', '://roblox.com', 'rbxcdn.com', '://rbxcdn.com'];
                        
                        domainsToRewrite.forEach(domain => {
                            const rawUrlPattern = `https://${domain}`;
                            const regex = new RegExp(rawUrlPattern, 'g');
                            contentString = contentString.replace(regex, `${hostAddress}/proxy?url=${Buffer.from(rawUrlPattern).toString('base64')}`);
                        });

                        if (contentType.includes('text/html')) {
                            // Injected script intercepts console behavior and pushes messages out over POST requests
                            const clientScriptHook = `
                                <script>
                                    (function() {
                                        function sendTerminalLog(type, args) {
                                            const msg = Array.from(args).map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ');
                                            fetch('/log', {
                                                method: 'POST',
                                                body: JSON.stringify({ type: type, message: msg }),
                                                headers: { 'Content-Type': 'application/json' }
                                            }).catch(() => {});
                                        }

                                        const _log = console.log;
                                        const _warn = console.warn;
                                        const _error = console.error;

                                        console.log = function() { sendTerminalLog('log', arguments); _log.apply(console, arguments); };
                                        console.warn = function() { sendTerminalLog('warn', arguments); _warn.apply(console, arguments); };
                                        console.error = function() { sendTerminalLog('error', arguments); _error.apply(console, arguments); };

                                        // Catch global unhandled script failures
                                        window.addEventListener('error', function(e) {
                                            sendTerminalLog('error', [e.message, 'at', e.filename, 'line:', e.lineno]);
                                        });

                                        document.addEventListener('click', function(e) {
                                            const link = e.target.closest('a');
                                            if (link && link.href && !link.href.includes(window.location.host)) {
                                                e.preventDefault();
                                                window.location.href = '/proxy?url=' + btoa(link.href);
                                            }
                                        }, true);
                                    })();
                                </script>
                            `;
                            contentString = contentString.replace('<head>', `<head>${clientScriptHook}`);
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
    // --- DASHBOARD HOOK ---
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
    } else {
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
