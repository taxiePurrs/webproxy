const http = require('http');
const https = require('https');

const PORT = 8080;

const server = http.createServer((req, res) => {
    // 1. Hook up the log parsing endpoint to stream console logs to terminal
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

    // Handle incoming proxy requests
    if (req.url.startsWith('/proxy')) {
        try {
            // Robust parsing of the base64 URL parameter
            const queryIndex = req.url.indexOf('?url=');
            if (queryIndex === -1) {
                res.writeHead(400);
                return res.end("Missing URL parameter.");
            }
            const base64Url = req.url.substring(queryIndex + 5);
            const decodedUrl = Buffer.from(base64Url, 'base64').toString('utf-8');
            
            console.log(`[PROXYING TARGET] -> ${decodedUrl}`);

            // Parse destination settings using modern WHATWG API internally without warnings
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

                        // Injection engine captures client console events and pipes them to the backend server terminal
                        const loggerScript = `
                            <script>
                                (function() {
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

                                    // Intercept direct clicks to stop pages from leaving your proxy tab container
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

                        // Drop the telemetry script cleanly inside the page head block
                        htmlContent = htmlContent.replace('<head>', `<head>${loggerScript}`);
                        
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(htmlContent);
                    });
                } else {
                    // Straight streaming pipeline for assets, images, icons (how the first version did it)
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
        // Fallback layout dashboard screen view
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
