import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } from '@whiskeysockets/baileys';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);
    
    // Remove existing session if present
    await removeFile(dirs);
    
    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            let Serverx = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Firefox'),
            });

            if (!Serverx.authState.creds.registered) {
                await delay(2000);
                // Remove any non-digit characters except plus sign
                num = num.replace(/[^\d+]/g, '');
                
                // If number starts with +, remove it
                if (num.startsWith('+')) {
                    num = num.substring(1);
                }
                
                // If number doesn't start with a country code, add default
                if (!num.match(/^[1-9]\d{1,2}/)) {
                    num = '62' + num;
                }
                
                const code = await Serverx.requestPairingCode(num);
                if (!res.headersSent) {
                    console.log({ num, code });
                    await res.send({ code });
                }
            }

            Serverx.ev.on('creds.update', saveCreds);
            Serverx.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    await delay(10000);
                    const sessionKnight = fs.readFileSync(dirs + '/creds.json');

                    // Send session file to user
                    const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                    await Serverx.sendMessage(userJid, { 
                        document: sessionKnight, 
                        mimetype: 'application/json', 
                        fileName: 'creds.json' 
                    });

                    // Send warning message
                    await Serverx.sendMessage(userJid, { 
                        text: `Here Is Your WhatsApp Cred.json ❤️\n 
©2025 Serverx Inc All Rights Reserved.\n\n` 
                    });

                    // Clean up session after use
                    await delay(100);
                    removeFile(dirs);
                    process.exit(0);
                }
                if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    initiateSession();
                }
            });
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    console.log('Caught exception: ', err);
});

export default router;
