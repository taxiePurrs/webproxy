const http = require('http');
const https = require('https');

const PORT = 8080;

const server = http.createServer((req, res) => {
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
                    'accept-encoding': 'identity' // Forces raw plaintext strings
                }
            };

            delete proxyOptions.headers['if-none-match'];
            delete proxyOptions.headers['if-modified-since'];

            const proxyRequest = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

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

                        // --- THE ADVANCED JAVASCRIPT MONKEY PATCH ---
                        // We override the pushState, replaceState, and window routing functions
                        // so JavaScript frameworks cannot break out of our proxy tunnel container.
                        const advancedRouterHook = `
                            <script>
                                (function() {
                                    const proxyOrigin = window.location.origin;

                                    function wrapUrlInProxy(rawUrl) {
                                        if (!rawUrl) return rawUrl;
                                        try {
                                            // Resolve relative roots automatically based on our active target
                                            const absoluteUrl = new URL(rawUrl, window.location.href).href;
                                            if (absoluteUrl.includes(window.location.host + '/proxy')) return absoluteUrl;
                                            return proxyOrigin + '/proxy?url=' + btoa(absoluteUrl);
                                        } catch(e) {
                                            return rawUrl;
                                        }
                                    }

                                    // 1. Monkey patch the HTML5 History Navigation framework API
                                    const originalPushState = history.pushState;
                                    const originalReplaceState = history.replaceState;

                                    history.pushState = function(state, title, url) {
                                        return originalPushState.apply(this, [state, title, wrapUrlInProxy(url)]);
                                    };

                                    history.replaceState = function(state, title, url) {
                                        return originalReplaceState.apply(this, [state, title, wrapUrlInProxy(url)]);
                                    };

                                    // 2. Global background DOM tap to catch raw framework click event loops
                                    document.addEventListener('click', function(event) {
                                        const link = event.target.closest('a');
                                        if (link && link.href) {
                                            if (link.href.startsWith('javascript:') || link.getAttribute('href') === '#') return;
                                            event.preventDefault();
                                            window.location.href = wrapUrlInProxy(link.href);
                                        }
                                    }, true);
                                })();
                            </script>
                        `;

                        // Inject at the absolute top of <head> before any Roblox frameworks execute
                        htmlContent = htmlContent.replace('<head>', `<head>${advancedRouterHook}`);

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
            res.end("Invalid target URL syntax layout.");
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

server.listen(PORT, () => console.log(`Proxy engine matching live navigation on port ${PORT}`));
