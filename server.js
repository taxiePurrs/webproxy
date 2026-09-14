const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8080;

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // Define the endpoint where the encoded URL is received
    if (parsedUrl.pathname === '/proxy' && parsedUrl.query.url) {
        try {
            // Decode the Base64 URL parameter back to plaintext
            const decodedUrl = Buffer.from(parsedUrl.query.url, 'base64').toString('utf-8');
            console.log(`[PROXYING TARGET] -> ${decodedUrl}`);

            const target = url.parse(decodedUrl);
            
            // Choose the engine depending on http vs https protocol
            const clientEngine = target.protocol === 'https:' ? https : http;

            const proxyOptions = {
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.path,
                method: req.method,
                headers: {
                    ...req.headers,
                    host: target.hostname, // Crucial: tricks the target into accepting the request
                }
            };

            // Fetch the target website from the host network
            const proxyReq = clientEngine.request(proxyOptions, (proxyRes) => {
                // Pass the original site response headers back to the browser
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                
                // Straight stream pipeline for ALL data chunks (HTML, JS, CSS, Images, Icons)
                proxyRes.pipe(res);
            });

            proxyReq.on('error', (err) => {
                res.writeHead(500);
                res.end(`Proxy connection failed: ${err.message}`);
            });

            // Forward any client data body onward (like POST form submissions)
            req.pipe(proxyReq);

        } catch (error) {
            res.writeHead(400);
            res.end("Invalid URL format.");
        }
    } else {
        // Fallback: Serve the main panel dashboard layout view
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
