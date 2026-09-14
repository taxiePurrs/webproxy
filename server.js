const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8080;

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/proxy' && parsedUrl.query.url) {
        try {
            const decodedUrl = Buffer.from(parsedUrl.query.url, 'base64').toString('utf-8');
            console.log(`[PROXYING TARGET] -> ${decodedUrl}`);

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
                }
            };

            // Remove headers that might mess with our backend calculations
            delete proxyOptions.headers['if-none-match'];
            delete proxyOptions.headers['if-modified-since'];

            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // --- THE CRITICAL FIX: STRIP ROBLOX SECURITY HEADERS ---
                // We clone the original headers but delete the security policies
                const cleanHeaders = { ...proxyRes.headers };
                delete cleanHeaders['content-security-policy'];
                delete cleanHeaders['content-security-policy-report-only'];
                delete cleanHeaders['strict-transport-security']; // Stops HSTS forcing real https://
                delete cleanHeaders['x-frame-options']; // Allows embedding

                if (contentType.includes('text/html')) {
                    let chunks = [];
                    proxyRes.on('data', (chunk) => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(chunks).toString('utf-8');

                        // This client script handles intercepting clicks smoothly
                        const dynamicScriptHook = `
                            <script>
                                (function() {
                                    document.addEventListener('click', function(event) {
                                        const link = event.target.closest('a');
                                        if (link && link.href) {
                                            // Ignore empty javascript buttons
                                            if (link.href.startsWith('javascript:') || link.getAttribute('href') === '#') return;

                                            event.preventDefault();
                                            
                                            // Handle relative paths accurately by fetching the computed absolute property
                                            const targetDestination = link.href; 
                                            window.location.href = '/proxy?url=' + btoa(targetDestination);
                                        }
                                    }, true);
                                })();
                            </script>
                        `;

                        // Drop the browser script cleanly inside the page head block
                        htmlContent = htmlContent.replace('<head>', `<head>${dynamicScriptHook}`);

                        res.writeHead(proxyRes.statusCode, cleanHeaders);
                        res.end(htmlContent);
                    });
                } else {
                    // Straight stream pipeline for your working images and secondary media files
                    res.writeHead(proxyRes.statusCode, cleanHeaders);
                    proxyRes.pipe(res);
                }
            });

            proxyReq.on('error', (err) => {
                res.writeHead(500);
                res.end(`Proxy connection failed: ${err.message}`);
            });

            req.pipe(proxyReq);

        } catch (error) {
            res.writeHead(400);
            res.end("Invalid URL format.");
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <h1>Local Development Sandbox</h1>
            <input type="text" id="target" value="https://www.roblox.com" placeholder="Enter full URL">
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

server.listen(PORT, () => console.log(`Proxy from scratch listening on port ${PORT}`));
