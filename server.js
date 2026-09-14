const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8080;

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // 1. Define the endpoint where your Chromebook sends scrambled URLs
    if (parsedUrl.pathname === '/proxy' && parsedUrl.query.url) {
        try {
            // Decode the Base64 scrambled URL string back to plaintext
            const decodedUrl = Buffer.from(parsedUrl.query.url, 'base64').toString('utf-8');
            console.log(`[PROXYING TARGET] -> ${decodedUrl}`);

            const target = url.parse(decodedUrl);
            
            // Choose the matching engine depending on http vs https
            const clientEngine = target.protocol === 'https:' ? https : http;

            const proxyOptions = {
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.path,
                method: req.method,
                headers: {
                    ...req.headers,
                    host: target.hostname, // Crucial: tricks the target server into accepting the request
                }
            };

            // 2. Fetch the target data from your home internet line
            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                // Pass the original site headers back to your Chromebook
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                
                // Stream the data chunk by chunk directly to your browser tab
                proxyRes.pipe(res);
            });

            proxyReq.on('error', (err) => {
                res.writeHead(500);
                res.end(`Proxy connection failed: ${err.message}`);
            });

            // If the Chromebook sent a POST request, forward the data body onward
            req.pipe(proxyReq);

        } catch (error) {
            res.writeHead(400);
            res.end("Invalid URL format.");
        }
    } else {
        // Fallback: Serve your innocent dashboard index page if no proxy query is present
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <h1>Local Development Sandbox</h1>
            <input type="text" id="target" placeholder="Enter URL (e.g., https://example.com)">
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
