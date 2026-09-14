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
                    'accept-encoding': 'identity' // Forces raw plaintext text code
                }
            };

            // Clear caching parameters that might interfere with our injections
            delete proxyOptions.headers['if-none-match'];
            delete proxyOptions.headers['if-modified-since'];

            const proxyRequest = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // Clone headers and remove security locks so ChromeOS allows our injected hooks to run
                const cleanHeaders = { ...proxyRes.headers };
                delete cleanHeaders['content-security-policy'];
                delete cleanHeaders['content-security-policy-report-only'];
                delete cleanHeaders['strict-transport-security'];
                delete cleanHeaders['x-frame-options'];

                if (contentType.includes('text/html')) {
                    let chunks = [];
                    proxyRes.on('data', (chunk) => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(chunks).toString('utf-8');

                        // --- THE ADVANCED MONKEY PATCH ROUTER ---
                        // We hijack the browser's History API so that when Roblox's internal 
                        // JavaScript framework attempts to change pages, it gets forced into our proxy.
                        const coreRouterPatch = `
                            <script>
                                (function() {
                                    const proxyOrigin = window.location.origin;

                                    function interceptUrl(rawUrl) {
                                        if (!rawUrl) return rawUrl;
                                        try {
                                            // Compute relative paths dynamically into absolute paths based on where we are
                                            const resolvedAbsoluteUrl = new URL(rawUrl, window.location.href).href;
                                            
                                            // If it's already a proxy address, let it pass
                                            if (resolvedAbsoluteUrl.includes(window.location.host + '/proxy')) return resolvedAbsoluteUrl;
                                            
                                            // Wrap it back into our base64 proxy tunnel pattern
                                            return proxyOrigin + '/proxy?url=' + btoa(resolvedAbsoluteUrl);
                                        } catch(e) {
                                            return rawUrl;
                                        }
                                    }

                                    // 1. Intercept the browser's dynamic SPA history hooks
                                    const originalPushState = history.pushState;
                                    const originalReplaceState = history.replaceState;

                                    history.pushState = function(state, title, url) {
                                        return originalPushState.apply(this, [state, title, interceptUrl(url)]);
                                    };

                                    history.replaceState = function(state, title, url) {
                                        return originalReplaceState.apply(this, [state, title, interceptUrl(url)]);
                                    };

                                    // 2. Global background click tap for catching any basic link components
                                    document.addEventListener('click', function(event) {
                                        const link = event.target.closest('a');
                                        if (link && link.href) {
                                            if (link.href.startsWith('javascript:') || link.getAttribute('href') === '#') return;
                                            event.preventDefault();
                                            window.location.href = interceptUrl(link.href);
                                        }
                                    }, true);
                                })();
                            </script>
                        `;

                        // Inject the script at the absolute top of the <head> block before any Roblox code runs
                        htmlContent = htmlContent.replace('<head>', `<head>${coreRouterPatch}`);

                        res.writeHead(proxyRes.statusCode, cleanHeaders);
                        res.end(htmlContent);
                    });
                } else {
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
            res.end("Invalid target URL encoding.");
        }
    } else if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <h1>Local Development Sandbox</h1>
            <input type="text" id="target" value="https://www.roblox.com" style="width:300px;">
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

server.listen(PORT, () => console.log(`Proxy running with history manipulation on port ${PORT}`));
