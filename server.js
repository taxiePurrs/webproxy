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
                }
            };

            const proxyRequest = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // Only buffer and inject code if it's the raw HTML web page framework
                if (contentType.includes('text/html')) {
                    let chunks = [];
                    
                    proxyRes.on('data', (chunk) => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(chunks).toString('utf-8');

                        // --- THE UNIVERSAL CLIENT INTERCEPTOR ---
                        // This script hooks into the browser lifecycle and dynamically translates 
                        // ALL clicks (absolute, relative, or domain-shifted) into proxy routes.
                        const dynamicScriptHook = `
                            <script>
                                (function() {
                                    document.addEventListener('click', function(event) {
                                        const link = event.target.closest('a');
                                        
                                        // Catch valid links that aren't javascript triggers
                                        if (link && link.href && !link.href.startsWith('javascript:')) {
                                            
                                            // Always check against window.location.host instead of a hardcoded string
                                            if (!link.href.includes(window.location.host + '/proxy')) {
                                                event.preventDefault();
                                                
                                                console.log("Proxy routing clicked link:", link.href);
                                                window.location.href = '/proxy?url=' + btoa(link.href);
                                            }
                                        }
                                    }, true); // 'true' forces our interceptor to execute first
                                })();
                            </script>
                        `;

                        // Drop the script cleanly right at the top of the HTML header initialization tree
                        htmlContent = htmlContent.replace('<head>', `<head>${dynamicScriptHook}`);

                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(htmlContent);
                    });
                } else {
                    // Straight stream pipeline for images, styles, player assets, and sound files
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
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
            <p>Warning-Free Modern URL Standard Core Engaged.</p>
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
