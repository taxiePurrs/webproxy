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
                    // Forces raw plaintext code so our text replacements don't corrupt binary chunks
                    'accept-encoding': 'identity' 
                }
            };

            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // Clone headers and strip Content Security Policies so our rewrites are accepted by Chrome
                const cleanHeaders = { ...proxyRes.headers };
                delete cleanHeaders['content-security-policy'];
                delete cleanHeaders['content-security-policy-report-only'];
                delete cleanHeaders['strict-transport-security'];
                delete cleanHeaders['x-frame-options'];

                if (contentType.includes('text/html')) {
                    let chunks = [];
                    
                    proxyRes.on('data', (chunk) => {
                        chunks.push(chunk);
                    });

                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(chunks).toString('utf-8');
                        const proxyHost = `http://${req.headers.host}`;

                        // 1. REWRITE ABSOLUTE LINKS (e.g., https://roblox.com)
                        htmlContent = htmlContent.replaceAll('https://www.roblox.com', `${proxyHost}/proxy?url=${Buffer.from('https://www.roblox.com').toString('base64')}`);
                        htmlContent = htmlContent.replaceAll('https://roblox.com', `${proxyHost}/proxy?url=${Buffer.from('https://roblox.com').toString('base64')}`);

                        // 2. REWRITE ROOT-RELATIVE LINKS (e.g., href="/login" becomes href="http://codespace/proxy?url=base64(https://roblox.com)")
                        // We intercept the href="/ string and prefix it with our proxy address pointing directly back to roblox
                        const baseProxyPath = `${proxyHost}/proxy?url=${Buffer.from('https://www.roblox.com').toString('base64')}`;
                        htmlContent = htmlContent.replaceAll('href="/', `href="${baseProxyPath}/`);
                        htmlContent = htmlContent.replaceAll('src="/', `src="${baseProxyPath}/`);

                        res.writeHead(proxyRes.statusCode, cleanHeaders);
                        res.end(htmlContent);
                    });
                } else {
                    // Straight stream pipeline for images, avatar assets, and stylesheets
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
