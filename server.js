const http = require('http');
const https = require('https');

const PORT = 8080;

const server = http.createServer((req, res) => {
    // Construct a modern WHATWG URL object cleanly to eliminate the deprecation warning
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${hostHeader}`);

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
                    // --- CRITICAL FIX 1: DISABLE GZIP/BROTLI COMPRESSION ---
                    // Forces the target server to send plaintext text/html instead of compressed binary chunks
                    'accept-encoding': 'identity' 
                }
            };

            // Remove internal caching headers that might interrupt our rewrites
            delete proxyOptions.headers['if-none-match'];
            delete proxyOptions.headers['if-modified-since'];

            const proxyRequest = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // --- CRITICAL FIX 2: STRIP CONTENT SECURITY POLICIES ---
                // We clone the original headers but delete security structures so our scripts can run
                const cleanHeaders = { ...proxyRes.headers };
                delete cleanHeaders['content-security-policy'];
                delete cleanHeaders['content-security-policy-report-only'];
                delete cleanHeaders['strict-transport-security']; // Stops HSTS from forcing real HTTPS
                delete cleanHeaders['x-frame-options']; // Prevents iframe blocking

                // Only buffer and rewrite text if the incoming asset is an actual HTML web page
                if (contentType.includes('text/html')) {
                    let chunks = [];
                    
                    proxyRes.on('data', (chunk) => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(chunks).toString('utf-8');

                        // The client-side click interceptor catches absolute and relative navigation paths dynamically
                        const dynamicScriptHook = `
                            <script>
                                (function() {
                                    document.addEventListener('click', function(event) {
                                        const link = event.target.closest('a');
                                        if (link && link.href) {
                                            // Ignore blank javascript anchors and template links
                                            if (link.href.startsWith('javascript:') || link.getAttribute('href') === '#') return;

                                            event.preventDefault();
                                            
                                            // Grab the browser-computed absolute link path (e.g., handles relative paths automatically)
                                            const targetDestination = link.href; 
                                            console.log("Proxy routing to:", targetDestination);
                                            window.location.href = '/proxy?url=' + btoa(targetDestination);
                                        }
                                    }, true); // Enforces prompt priority check execution
                                })();
                            </script>
                        `;

                        // Inject our interceptor code straight into the head element
                        htmlContent = htmlContent.replace('<head>', `<head>${dynamicScriptHook}`);

                        res.writeHead(proxyRes.statusCode, cleanHeaders);
                        res.end(htmlContent);
                    });
                } else {
                    // Straight stream pipeline for images, audio tracks, player textures, and styling sheets
                    res.writeHead(proxyRes.statusCode, cleanHeaders);
                    proxyRes.pipe(res);
                }
            });

            proxyRequest.on('error', (err) => {
                res.writeHead(500);
                res.end(`Proxy connection failed: ${err.message}`);
            });

            req.pipe(proxyRequest);

        } catch (error) {
            res.writeHead(400);
            res.end("Invalid target URL encoding format.");
        }
    } else if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <h1>Local Development Sandbox</h1>
            <p>Warning-Free Modern URL Core Pipeline Active.</p>
            <input type="text" id="target" value="https://www.roblox.com" placeholder="Enter full URL">
            <button onclick="go()">Browse</button>
            <script>
                function go() {
                    const target = document.getElementById('target').value;
                    window.location.href = '/proxy?url=' + btoa(target);
                }
            </script>
        `);
    } else {
        res.writeHead(404);
        res.end("Resource not found.");
    }
});

server.listen(PORT, () => console.log(`Proxy from scratch listening on port ${PORT}`));
