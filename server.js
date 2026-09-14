const http = require('http');
const https = require('https');

const PORT = 8080;

const server = http.createServer((req, res) => {
    // 1. Log parsing endpoint to stream console logs to terminal
    if (req.url === '/log' && req.method === 'POST') {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
            try {
                const log = JSON.parse(Buffer.concat(body).toString('utf-8'));
                const prefix = `[BROWSER ${log.type.toUpperCase()}]`;
                
                if (log.type === 'error') {
                    console.log(`\x1b[31m${prefix} ${log.message}\x1b[0m`);
                } else if (log.type === 'warn') {
                    console.log(`\x1b[33m${prefix} ${log.message}\x1b[0m`);
                } else {
                    console.log(`${prefix} ${log.message}`);
                }
            } catch (e) {}
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ status: 'logged' }));
        });
        return;
    }

    // 2. Handle incoming proxy requests
    if (req.url.startsWith('/proxy')) {
        try {
            const queryIndex = req.url.indexOf('?url=');
            if (queryIndex === -1) {
                res.writeHead(400);
                return res.end("Missing URL parameter.");
            }
            const base64Url = req.url.substring(queryIndex + 5);
            const decodedUrl = Buffer.from(base64Url, 'base64').toString('utf-8');
            
            console.log(`[PROXYING TARGET] -> ${decodedUrl}`);

            const target = new URL(decodedUrl);
            const clientEngine = target.protocol === 'https:' ? https : http;

            const proxyOptions = {
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.pathname + target.search,
                method: req.method,
                headers: {
                    ...req.headers,
                    host: target.hostname
                }
            };

            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // Only buffer and inject code if it's the main web page (HTML)
                if (contentType.includes('text/html')) {
                    let bodyBuffer = [];
                    proxyRes.on('data', (chunk) => bodyBuffer.push(chunk));
                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(bodyBuffer).toString('utf-8');

                        // This script intercepts console events AND overrides all link elements on load
                        const proxyScriptHook = `
                            <script>
                                (function() {
                                    // Live Terminal Logging Engine
                                    function sendLog(type, args) {
                                        const msg = Array.from(args).map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(' ');
                                        fetch('/log', {
                                            method: 'POST',
                                            body: JSON.stringify({ type: type, message: msg }),
                                            headers: { 'Content-Type': 'application/json' }
                                        }).catch(() => {});
                                    }

                                    const _warn = console.warn;
                                    const _error = console.error;
                                    console.warn = function() { sendLog('warn', arguments); _warn.apply(console, arguments); };
                                    console.error = function() { sendLog('error', arguments); _error.apply(console, arguments); };

                                    window.addEventListener('error', function(e) {
                                        sendLog('error', [e.message, 'at', e.filename, 'line:', e.lineno]);
                                    });

                                    // --- THE ONLOAD LINK REWRITER ---
                                    window.addEventListener('load', function() {
                                        const links = document.querySelectorAll('a');
                                        const currentProxyHost = window.location.origin; // Automatically gets your Codespace URL
                                        
                                        links.forEach(link => {
                                            // Check if the link exists and doesn't already point to your proxy
                                            if (link.href && !link.href.includes(window.location.host) && !link.href.startsWith('javascript:')) {
                                                const originalDestination = link.href;
                                                
                                                // Convert the absolute link destination to Base64
                                                const obfuscatedUrl = btoa(originalDestination);
                                                
                                                // Rewrite the literal href tag on the fly
                                                link.href = currentProxyHost + '/proxy?url=' + obfuscatedUrl;
                                            }
                                        });
                                        sendLog('log', ['Successfully rewrote ' + links.length + ' links on the client side!']);
                                    });

                                    // Fallback backup: Intercept clicks just in case new links are injected by scripts later
                                    document.addEventListener('click', function(e) {
                                        const link = e.target.closest('a');
                                        if (link && link.href && !link.href.includes(window.location.host) && !link.href.startsWith('javascript:')) {
                                            e.preventDefault();
                                            window.location.href = '/proxy?url=' + btoa(link.href);
                                        }
                                    }, true);
                                })();
                            </script>
                        `;

                        // Drop the script into the page head block
                        htmlContent = htmlContent.replace('<head>', `<head>${proxyScriptHook}`);
                        
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(htmlContent);
                    });
                } else {
                    // Straight streaming pipeline for assets, images, icons, and fonts
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    proxyRes.pipe(res);
                }
            });

            proxyReq.on('error', (err) => {
                res.writeHead(500);
                res.end(`Proxy routing failed: ${err.message}`);
            });

            req.pipe(proxyReq);

        } catch (error) {
            res.writeHead(400);
            res.end("Malformed target tracking payload.");
        }
    } else {
        // Fallback main panel dashboard layout view
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <h1>Local Development Sandbox</h1>
            <input type="text" id="target" value="https://roblox.com" placeholder="Enter full URL">
            <button onclick="go()">Browse</button>
            <script>
                function go() {
                    const target = document.getElementById('target').value;
                    window.location.href = '/proxy?url=' + btoa(target);
                }
            </script>
        `);
    }
});

server.listen(PORT, () => console.log(`[SYS ENGINE] Proxy node actively processing traffic on port ${PORT}`));
