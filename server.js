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

            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                const contentType = proxyRes.headers['content-type'] || '';

                // --- NEW LINK REWRITING ENGINE ---
                // Only buffer and edit the text if the file is an actual HTML web page
                if (contentType.includes('text/html')) {
                    let chunks = [];
                    
                    proxyRes.on('data', (chunk) => {
                        chunks.push(chunk);
                    });

                    proxyRes.on('end', () => {
                        let htmlContent = Buffer.concat(chunks).toString('utf-8');

                        // Dynamically grab whatever host URL your Codespace is running right now
                        const proxyHost = `http://${req.headers.host}`;

                        // Look for all common variations of roblox links and rewrite them into your base64 proxy format
                        htmlContent = htmlContent.replaceAll('https://roblox.com', `${proxyHost}/proxy?url=${Buffer.from('https://roblox.com').toString('base64')}`);
                        htmlContent = htmlContent.replaceAll('https://roblox.com', `${proxyHost}/proxy?url=${Buffer.from('https://roblox.com').toString('base64')}`);
                        htmlContent = htmlContent.replaceAll('//www.roblox.com', `${proxyHost}/proxy?url=${Buffer.from('https://roblox.com').toString('base64')}`);

                        // Send headers and the rewritten code straight to your Chromebook tab
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(htmlContent);
                    });
                } else {
                    // Fast pipeline: Stream images, scripts, styling sheets, and fonts directly
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
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

server.listen(PORT, () => console.log(`Proxy from scratch listening on port ${PORT}`));
