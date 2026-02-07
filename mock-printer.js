const net = require('net');
const fs = require('fs');

const PORT = 9100;
const LOG_FILE = 'print_jobs.log';

const server = net.createServer((socket) => {
    console.log('\n========================================');
    console.log('🖨️  Printer connection received');
    console.log(`   From: ${socket.remoteAddress}:${socket.remotePort}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('========================================\n');

    let data = Buffer.alloc(0);

    socket.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
    });

    socket.on('end', () => {
        console.log('📄 Print job received!');
        console.log(`   Size: ${data.length} bytes`);

        // Save raw data to file
        const filename = `print_job_${Date.now()}.bin`;
        fs.writeFileSync(filename, data);
        console.log(`   Saved to: ${filename}`);

        // Try to display readable text
        console.log('\n--- Print Content (readable parts) ---');
        const readable = extractReadableText(data);
        console.log(readable);
        console.log('--- End of Content ---\n');

        // Log to file
        const logEntry = `\n[${new Date().toISOString()}] Job received - ${data.length} bytes\n${readable}\n${'='.repeat(50)}\n`;
        fs.appendFileSync(LOG_FILE, logEntry);

        console.log('✅ Print job processed successfully\n');
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err.message);
    });
});

function extractReadableText(buffer) {
    // Remove ESC/POS control characters and extract readable text
    let text = '';
    let i = 0;

    while (i < buffer.length) {
        const byte = buffer[i];

        // Skip ESC sequences
        if (byte === 0x1B) { // ESC
            i += 2; // Skip ESC + command
            continue;
        }

        // Skip GS sequences
        if (byte === 0x1D) { // GS
            // GS commands vary in length, skip until next printable
            i++;
            while (i < buffer.length && buffer[i] < 32 && buffer[i] !== 10) {
                i++;
            }
            continue;
        }

        // Newline
        if (byte === 0x0A || byte === 0x0D) {
            text += '\n';
            i++;
            continue;
        }

        // Printable ASCII
        if (byte >= 32 && byte < 127) {
            text += String.fromCharCode(byte);
        }

        // Handle ₹ symbol (UTF-8: E2 82 B9)
        if (byte === 0xE2 && buffer[i + 1] === 0x82 && buffer[i + 2] === 0xB9) {
            text += '₹';
            i += 3;
            continue;
        }

        i++;
    }

    // Clean up multiple newlines
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║         MOCK THERMAL PRINTER               ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  Listening on port ${PORT}                    ║`);
    console.log('║  Waiting for print jobs...                 ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('\nYour laptop IP addresses:');

    const interfaces = require('os').networkInterfaces();
    Object.keys(interfaces).forEach((name) => {
        interfaces[name].forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`  ${name}: ${iface.address}`);
            }
        });
    });

    console.log(`\nUse one of these IPs as the printer IP in your app/test.`);
    console.log(`Example: 192.168.x.x:9100\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Kill existing process or use different port.`);
    } else {
        console.error('Server error:', err);
    }
});