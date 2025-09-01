const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sock.ev.on('creds.update', saveCreds);

    // Generazione QR code
    sock.ev.on('connection.update', async (update) => {
        if (update.qr) {
            const qrImage = await qrcode.toDataURL(update.qr);
            fs.writeFileSync('qr.png', qrImage.replace(/^data:image\/png;base64,/, ''), 'base64');
            console.log('📲 QR code generato: apri qr.png e scannerizzalo con WhatsApp.');
        }
        if (update.connection === 'open') console.log('✅ Bot connesso!');
    });

    // Gestione messaggi
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!text.startsWith('.')) return;

        const args = text.split(' ');
        const cmd = args[0].toLowerCase();

        // Recupera info gruppo
        let isAdmin = false;
        let groupMembers = [];
        if (from.endsWith('@g.us')) {
            const metadata = await sock.groupMetadata(from).catch(() => ({ participants: [] }));
            const participant = metadata.participants.find(p => p.id === sender);
            isAdmin = participant?.admin !== null;
            groupMembers = metadata.participants.map(p => p.id);
        }

        // ===== COMANDO .tag =====
        if (cmd === '.tag') {
            if (!from.endsWith('@g.us')) return;
            const mentions = groupMembers;
            await sock.sendMessage(from, { text: '📢 Tag di tutti i membri:', mentions });
        }

        // ===== COMANDO .p =====
        if (cmd === '.p') {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Devi essere admin per usare questo comando!' });
            const mention = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mention) return sock.sendMessage(from, { text: 'Usa: .p @utente' });
            await sock.groupParticipantsUpdate(from, [mention], 'promote');
            await sock.sendMessage(from, { text: `✅ Utente promosso ad admin!`, mentions: [mention] });
        }

        // ===== COMANDO .kick =====
        if (cmd === '.kick') {
            if (!isAdmin) return sock.sendMessage(from, { text: '❌ Devi essere admin per usare questo comando!' });
            const mention = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mention) return sock.sendMessage(from, { text: 'Usa: .kick @utente' });
            await sock.groupParticipantsUpdate(from, [mention], 'remove');
            await sock.sendMessage(from, { text: `✅ Utente espulso!`, mentions: [mention] });
        }

        // ===== COMANDO .coppia =====
        if (cmd === '.coppia') {
            if (!from.endsWith('@g.us')) return;
            let shuffled = groupMembers.sort(() => Math.random() - 0.5);
            let pairs = [];
            while (shuffled.length >= 2) {
                const a = shuffled.pop();
                const b = shuffled.pop();
                pairs.push([a, b]);
            }
            // Se c'è un utente rimasto senza coppia
            if (shuffled.length === 1) pairs.push([shuffled.pop(), 'Nessuno']);
            let message = '💞 Coppie del gruppo:\n';
            pairs.forEach(pair => {
                message += `@${pair[0].split('@')[0]} ❤️ @${pair[1] === 'Nessuno' ? 'Nessuno' : pair[1].split('@')[0]}\n`;
            });
            await sock.sendMessage(from, { text: message, mentions: groupMembers });
        }
    });
}

startBot().catch(console.error);
