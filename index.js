const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode')
const fs = require('fs')

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    const sock = makeWASocket({ auth: state, printQRInTerminal: false })
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        if (update.qr) {
            const qrImage = await qrcode.toDataURL(update.qr)
            fs.writeFileSync('qr.png', qrImage.replace(/^data:image\/png;base64,/, ""), 'base64')
            console.log('📲 QR code generato! Scarica il file qr.png da Railway per scannerizzarlo.')
        }
        if (update.connection === 'open') console.log('✅ Bot connesso!')
    })
}

    // Database in memoria per alcune funzionalità
    let userData = {}
    let groupSettings = {}
    let games = {}
    let polls = {}

    // ===== ANTI-NUKE (monitor aggiornamenti gruppo) =====
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action, author } = update
        if (action === "remove") {
            const groupMetadata = await sock.groupMetadata(id)
            const botNumber = (await sock.user.id.split(":")[0]) + "@s.whatsapp.net"

            if (author !== botNumber) {
                await sock.sendMessage(id, {
                    text: `🚨 **ANTI-NUKE ATTIVATO** 🚨\nUn admin (${author}) ha espulso ${participants[0]} senza usare il bot!`
                })

                const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id)
                for (let adm of admins) {
                    try {
                        await sock.groupParticipantsUpdate(id, [adm], "demote")
                    } catch (err) {
                        console.log("Errore nel demote:", err)
                    }
                }

                try {
                    await sock.groupSettingUpdate(id, "announcement")
                    await sock.sendMessage(id, {
                        text: "🔒 Il gruppo è stato chiuso per sicurezza."
                    })
                } catch (err) {
                    console.log("Errore chiusura gruppo:", err)
                }
            }
        }
    })

    // ===== HELPER FUNCTIONS =====
    function getUserData(userId) {
        if (!userData[userId]) {
            userData[userId] = { points: 0, level: 1, warnings: 0 }
        }
        return userData[userId]
    }

    function getRandomItem(array) {
        return array[Math.floor(Math.random() * array.length)]
    }

    // ===== ASCOLTO MESSAGGI =====
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0]
        if (!m.message) return
        if (m.key.fromMe) return

        const from = m.key.remoteJid
        const sender = m.key.participant || m.key.remoteJid
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim()

        if (!text.startsWith(".")) return

        const groupMetadata = await sock.groupMetadata(from)
        const senderIsAdmin = groupMetadata.participants.find(p => p.id === sender)?.admin !== null
        const args = text.split(" ")
        const command = args[0].toLowerCase()

        // ===== COMANDI ADMIN =====

        // 1. Kick utente
        if (command === ".kick") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .kick @utente" })

            await sock.groupParticipantsUpdate(from, [mentioned[0]], "remove")
            await sock.sendMessage(from, { text: `✅ Utente espulso!`, mentions: mentioned })
        }

        // 2. Promuovi admin
        if (command === ".p") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .p @utente" })

            await sock.groupParticipantsUpdate(from, [mentioned[0]], "promote")
            await sock.sendMessage(from, { text: `✅ Promosso admin!`, mentions: mentioned })
        }

        // 3. Rimuovi admin
        if (command === ".demote") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .demote @utente" })

            await sock.groupParticipantsUpdate(from, [mentioned[0]], "demote")
            await sock.sendMessage(from, { text: `✅ Admin rimosso!`, mentions: mentioned })
        }

        // 4. Warn utente
        if (command === ".warn") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .warn @utente motivo" })

            const user = getUserData(mentioned[0])
            user.warnings++
            const motivo = args.slice(1).join(" ") || "Nessun motivo"

            await sock.sendMessage(from, { 
                text: `⚠️ Warning ${user.warnings}/3 per @${mentioned[0].split('@')[0]}\nMotivo: ${motivo}`,
                mentions: mentioned 
            })

            if (user.warnings >= 3) {
                await sock.groupParticipantsUpdate(from, [mentioned[0]], "remove")
                await sock.sendMessage(from, { text: `🚫 Utente espulso per troppi warning!` })
            }
        }

        // 5. Chiudi gruppo
        if (command === ".chiudi") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            await sock.groupSettingUpdate(from, "announcement")
            await sock.sendMessage(from, { text: "🔒 Gruppo chiuso! Solo admin possono scrivere." })
        }

        // 6. Apri gruppo
        if (command === ".apri") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            await sock.groupSettingUpdate(from, "not_announcement")
            await sock.sendMessage(from, { text: "🔓 Gruppo aperto! Tutti possono scrivere." })
        }

        // 7. Cambia nome gruppo
        if (command === ".nome") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            const newName = args.slice(1).join(" ")
            if (!newName) return sock.sendMessage(from, { text: "Usa: .nome Nuovo Nome" })

            await sock.groupUpdateSubject(from, newName)
            await sock.sendMessage(from, { text: `✅ Nome gruppo cambiato in: ${newName}` })
        }

        // 8. Cambia descrizione
        if (command === ".desc") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            const newDesc = args.slice(1).join(" ")
            if (!newDesc) return sock.sendMessage(from, { text: "Usa: .desc Nuova descrizione" })

            await sock.groupUpdateDescription(from, newDesc)
            await sock.sendMessage(from, { text: `✅ Descrizione aggiornata!` })
        }

        // ===== GIOCHI E DIVERTIMENTO =====

        // 9. Dado
        if (command === ".dado") {
            const result = Math.floor(Math.random() * 6) + 1
            await sock.sendMessage(from, { text: `🎲 Hai ottenuto: ${result}` })
        }

        // 10. Moneta
        if (command === ".moneta") {
            const result = Math.random() > 0.5 ? "Testa" : "Croce"
            await sock.sendMessage(from, { text: `🪙 Risultato: ${result}!` })
        }

        // 11. 8ball
        if (command === ".8ball") {
            const responses = [
                "Sì", "No", "Forse", "Certamente", "Mai", "Probabilmente", 
                "Non credo", "Assolutamente sì", "Impossibile", "Chiedimelo più tardi"
            ]
            const question = args.slice(1).join(" ")
            if (!question) return sock.sendMessage(from, { text: "Fai una domanda!" })

            await sock.sendMessage(from, { text: `🎱 ${question}\n📮 ${getRandomItem(responses)}` })
        }

        // 12. Quiz
        if (command === ".quiz") {
            const questions = [
                { q: "Capitale d'Italia?", a: "roma" },
                { q: "2+2?", a: "4" },
                { q: "Colore del sole?", a: "giallo" },
                { q: "Quanti giorni ha un anno?", a: "365" },
                { q: "Chi ha inventato la lampadina?", a: "edison" }
            ]
            const quiz = getRandomItem(questions)
            games[from] = { type: "quiz", answer: quiz.a, points: 10 }

            await sock.sendMessage(from, { text: `❓ QUIZ (10 punti)\n${quiz.q}\n\nRispondi con .risposta <la tua risposta>` })
        }

        // 13. Risposta quiz
        if (command === ".risposta") {
            const game = games[from]
            if (!game || game.type !== "quiz") return sock.sendMessage(from, { text: "Nessun quiz attivo!" })

            const answer = args.slice(1).join(" ").toLowerCase()
            const user = getUserData(sender)

            if (answer === game.answer) {
                user.points += game.points
                await sock.sendMessage(from, { 
                    text: `✅ Corretto! @${sender.split('@')[0]} ha guadagnato ${game.points} punti!\nTotale: ${user.points} punti`, 
                    mentions: [sender] 
                })
                delete games[from]
            } else {
                await sock.sendMessage(from, { text: `❌ Sbagliato! Riprova.` })
            }
        }

        // 14. Indovina numero
        if (command === ".numero") {
            const number = Math.floor(Math.random() * 100) + 1
            games[from] = { type: "number", answer: number, attempts: 0, maxAttempts: 7 }

            await sock.sendMessage(from, { text: `🔢 Ho pensato un numero tra 1 e 100!\nHai 7 tentativi. Usa .prova <numero>` })
        }

        // 15. Prova numero
        if (command === ".prova") {
            const game = games[from]
            if (!game || game.type !== "number") return sock.sendMessage(from, { text: "Nessun gioco attivo!" })

            const guess = parseInt(args[1])
            if (!guess || guess < 1 || guess > 100) return sock.sendMessage(from, { text: "Numero non valido!" })

            game.attempts++
            const user = getUserData(sender)

            if (guess === game.answer) {
                const points = Math.max(20 - game.attempts * 2, 5)
                user.points += points
                await sock.sendMessage(from, { 
                    text: `🎉 BRAVO! @${sender.split('@')[0]} ha indovinato ${game.answer} in ${game.attempts} tentativi!\n+${points} punti!`, 
                    mentions: [sender] 
                })
                delete games[from]
            } else if (game.attempts >= game.maxAttempts) {
                await sock.sendMessage(from, { text: `😞 Hai finito i tentativi! Il numero era ${game.answer}` })
                delete games[from]
            } else {
                const hint = guess > game.answer ? "più basso" : "più alto"
                await sock.sendMessage(from, { text: `${hint}! Tentativi rimasti: ${game.maxAttempts - game.attempts}` })
            }
        }

        // ===== UTILITÀ =====

        // 16. Info utente
        if (command === ".info") {
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [sender]
            const user = getUserData(mentioned[0])
            const target = mentioned[0].split('@')[0]

            await sock.sendMessage(from, { 
                text: `👤 Info di @${target}\n📊 Punti: ${user.points}\n🏆 Livello: ${user.level}\n⚠️ Warning: ${user.warnings}/3`, 
                mentions: [mentioned[0]] 
            })
        }

        // 17. Classifica
        if (command === ".top") {
            const sorted = Object.entries(userData).sort((a, b) => b[1].points - a[1].points).slice(0, 10)
            let text = "🏆 TOP 10 PUNTI\n\n"
            sorted.forEach((user, i) => {
                const username = user[0].split('@')[0]
                text += `${i + 1}. @${username} - ${user[1].points} punti\n`
            })

            await sock.sendMessage(from, { text, mentions: sorted.map(u => u[0]) })
        }

        // 18. Calcoli
        if (command === ".calc") {
            const expression = args.slice(1).join(" ")
            try {
                // Semplice eval per operazioni basic (attenzione: eval può essere pericoloso!)
                const result = Function('"use strict"; return (' + expression.replace(/[^0-9+\-*/().]/g, '') + ')')()
                await sock.sendMessage(from, { text: `🧮 ${expression} = ${result}` })
            } catch {
                await sock.sendMessage(from, { text: "❌ Espressione non valida!" })
            }
        }

        // 19. Timer/Promemoria
        if (command === ".timer") {
            const minutes = parseInt(args[1])
            const message = args.slice(2).join(" ") || "Tempo scaduto!"

            if (!minutes || minutes > 60) return sock.sendMessage(from, { text: "Usa: .timer <minuti> <messaggio>" })

            await sock.sendMessage(from, { text: `⏰ Timer impostato per ${minutes} minuti!` })

            setTimeout(async () => {
                await sock.sendMessage(from, { text: `⏰ TIMER SCADUTO!\n📝 ${message}` })
            }, minutes * 60000)
        }

        // 20. Sondaggio
        if (command === ".sondaggio") {
            const question = args.slice(1).join(" ")
            if (!question) return sock.sendMessage(from, { text: "Usa: .sondaggio Domanda?" })

            polls[from] = { question, yes: 0, no: 0, voters: [] }

            await sock.sendMessage(from, { 
                text: `📊 SONDAGGIO\n${question}\n\n👍 Vota SÌ: .vota si\n👎 Vota NO: .vota no` 
            })
        }

        // 21. Vota sondaggio
        if (command === ".vota") {
            const poll = polls[from]
            if (!poll) return sock.sendMessage(from, { text: "Nessun sondaggio attivo!" })
            if (poll.voters.includes(sender)) return sock.sendMessage(from, { text: "Hai già votato!" })

            const vote = args[1]?.toLowerCase()
            if (vote === "si" || vote === "sì") {
                poll.yes++
                poll.voters.push(sender)
                await sock.sendMessage(from, { text: `✅ Voto registrato: SÌ` })
            } else if (vote === "no") {
                poll.no++
                poll.voters.push(sender)
                await sock.sendMessage(from, { text: `✅ Voto registrato: NO` })
            } else {
                await sock.sendMessage(from, { text: "Usa: .vota si oppure .vota no" })
            }
        }

        // 22. Risultati sondaggio
        if (command === ".risultati") {
            const poll = polls[from]
            if (!poll) return sock.sendMessage(from, { text: "Nessun sondaggio attivo!" })

            const total = poll.yes + poll.no
            const yesPercent = total > 0 ? Math.round((poll.yes / total) * 100) : 0
            const noPercent = total > 0 ? Math.round((poll.no / total) * 100) : 0

            await sock.sendMessage(from, { 
                text: `📊 RISULTATI SONDAGGIO\n${poll.question}\n\n👍 SÌ: ${poll.yes} (${yesPercent}%)\n👎 NO: ${poll.no} (${noPercent}%)\n📝 Totale voti: ${total}` 
            })
        }

        // ===== INTERAZIONE SOCIALE =====

        // 23. Saluta tutti
        if (command === ".saluta") {
            const greetings = ["Ciao a tutti! 👋", "Salve gruppo! 🙋‍♀️", "Buongiorno! ☀️", "Ciao ciao! 😊"]
            await sock.sendMessage(from, { text: getRandomItem(greetings) })
        }

        // 24. Complimento casuale
        if (command === ".complimento") {
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [sender]
            const compliments = [
                "sei fantastico!", "hai un'energia incredibile!", "sei molto intelligente!",
                "hai un gran senso dell'umorismo!", "sei una persona speciale!", "illumini la giornata!"
            ]

            await sock.sendMessage(from, { 
                text: `💫 @${mentioned[0].split('@')[0]} ${getRandomItem(compliments)}`, 
                mentions: mentioned 
            })
        }

        // 25. Frase motivazionale
        if (command === ".motiva") {
            const quotes = [
                "Il successo è la somma di piccoli sforzi ripetuti giorno dopo giorno! 💪",
                "Non arrenderti mai! Ogni esperto è stato un principiante! 🌟",
                "Le sfide sono ciò che rendono la vita interessante! 🚀",
                "Credi in te stesso e tutto sarà possibile! ✨",
                "Ogni giorno è una nuova opportunità per migliorare! 🌅"
            ]
            await sock.sendMessage(from, { text: getRandomItem(quotes) })
        }

        // 26. Chi è più probabile che...
        if (command === ".chie") {
            const participants = groupMetadata.participants.map(p => p.id)
            const randomUser = getRandomItem(participants)
            const action = args.slice(1).join(" ") || "faccia qualcosa di divertente"

            await sock.sendMessage(from, { 
                text: `🤔 Chi è più probabile che ${action}?\n\n👉 @${randomUser.split('@')[0]}!`, 
                mentions: [randomUser] 
            })
        }

        // 27. Accoppia utenti
        if (command === ".ship") {
            const participants = groupMetadata.participants.map(p => p.id)
            if (participants.length < 2) return sock.sendMessage(from, { text: "Servono almeno 2 persone!" })

            const user1 = getRandomItem(participants)
            let user2 = getRandomItem(participants)
            while (user2 === user1 && participants.length > 1) {
                user2 = getRandomItem(participants)
            }

            const percentage = Math.floor(Math.random() * 101)
            const hearts = "💕".repeat(Math.floor(percentage / 20))

            await sock.sendMessage(from, { 
                text: `💘 SHIP ALERT!\n@${user1.split('@')[0]} + @${user2.split('@')[0]}\nCompatibilità: ${percentage}% ${hearts}`, 
                mentions: [user1, user2] 
            })
        }

        // ===== DIVERTIMENTO E MEME =====

        // 28. Meme random
        if (command === ".meme") {
            const memes = [
                "This is fine 🔥☕", "Stonks 📈", "Big brain time 🧠",
                "It's Wednesday my dudes 🐸", "Ah yes, enslaved moisture 💧",
                "I see this as an absolute win! 💪", "Outstanding move! ♟️"
            ]
            await sock.sendMessage(from, { text: getRandomItem(memes) })
        }

        // 29. Barzelletta
        if (command === ".barza") {
            const jokes = [
                "Perché i pesci non parlano? Perché sono sotto l'acqua! 🐟",
                "Come si chiama un gatto che cade dalla finestra? Micio-micio! 🐱",
                "Cosa fa un pesce al computer? Nuota in internet! 🐠💻",
                "Perché gli elefanti non usano il computer? Perché hanno paura del mouse! 🐘🐭",
                "Come si chiama un dinosauro che dorme? Dino-ronf! 🦕😴"
            ]
            await sock.sendMessage(from, { text: `😂 ${getRandomItem(jokes)}` })
        }

        // 30. Emoji casuale
        if (command === ".emoji") {
            const emojis = ["😀", "😂", "🤣", "😊", "😍", "🤔", "😎", "🤪", "🥳", "😴", "🤖", "👻", "💖", "🔥", "⭐", "🎉", "🦄", "🌈", "☀️", "🌙"]
            await sock.sendMessage(from, { text: getRandomItem(emojis).repeat(3) })
        }

        // ===== INFORMAZIONI E CULTURA =====

        // 31. Fatto del giorno
        if (command === ".fatto") {
            const facts = [
                "I polpi hanno tre cuori! 🐙",
                "Le banane sono tecnicamente bacche! 🍌",
                "Un gruppo di fenicotteri si chiama 'flamboyance'! 🦩",
                "Gli squali esistono da più tempo degli alberi! 🦈",
                "Il miele non scade mai! 🍯"
            ]
            await sock.sendMessage(from, { text: `💡 FATTO DEL GIORNO:\n${getRandomItem(facts)}` })
        }

        // 32. Consiglio del giorno
        if (command === ".consiglio") {
            const tips = [
                "Bevi almeno 8 bicchieri d'acqua al giorno! 💧",
                "Fai una pausa di 5 minuti ogni ora di lavoro! ⏰",
                "Sorridi almeno 10 volte al giorno! 😊",
                "Impara una parola nuova ogni giorno! 📚",
                "Fai 10 minuti di meditazione! 🧘"
            ]
            await sock.sendMessage(from, { text: `💭 CONSIGLIO DEL GIORNO:\n${getRandomItem(tips)}` })
        }

        // ===== RANDOMIZZATORI =====

        // 33. Scegli per me
        if (command === ".scegli") {
            const options = args.slice(1).join(" ").split(",").map(s => s.trim())
            if (options.length < 2) return sock.sendMessage(from, { text: "Usa: .scegli opzione1, opzione2, opzione3..." })

            const choice = getRandomItem(options)
            await sock.sendMessage(from, { text: `🎯 Ho scelto: **${choice}**` })
        }

        // 34. Numero casuale
        if (command === ".random") {
            const min = parseInt(args[1]) || 1
            const max = parseInt(args[2]) || 100
            const result = Math.floor(Math.random() * (max - min + 1)) + min

            await sock.sendMessage(from, { text: `🎲 Numero casuale tra ${min} e ${max}: **${result}**` })
        }

        // 35. Colore casuale
        if (command === ".colore") {
            const colors = ["Rosso", "Blu", "Verde", "Giallo", "Viola", "Arancione", "Rosa", "Nero", "Bianco", "Grigio", "Marrone", "Turchese"]
            await sock.sendMessage(from, { text: `🎨 Colore del giorno: **${getRandomItem(colors)}**` })
        }

        // ===== GESTIONE GRUPPO =====

        // 36. Lista admin
        if (command === ".admins") {
            const admins = groupMetadata.participants.filter(p => p.admin !== null)
            let text = "👑 ADMIN DEL GRUPPO:\n\n"
            admins.forEach((admin, i) => {
                text += `${i + 1}. @${admin.id.split('@')[0]}\n`
            })

            await sock.sendMessage(from, { text, mentions: admins.map(a => a.id) })
        }

        // 37. Lista membri
        if (command === ".membri") {
            const count = groupMetadata.participants.length
            await sock.sendMessage(from, { text: `👥 Questo gruppo ha **${count}** membri` })
        }

        // 38. Link gruppo
        if (command === ".link") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            try {
                const code = await sock.groupInviteCode(from)
                await sock.sendMessage(from, { text: `🔗 Link del gruppo:\nhttps://chat.whatsapp.com/${code}` })
            } catch {
                await sock.sendMessage(from, { text: "❌ Errore nel generare il link" })
            }
        }

        // 39. Resetta link
        if (command === ".resetlink") {
            if (!senderIsAdmin) return sock.sendMessage(from, { text: "❌ Solo admin" })
            try {
                await sock.groupRevokeInvite(from)
                await sock.sendMessage(from, { text: "✅ Link del gruppo resettato!" })
            } catch {
                await sock.sendMessage(from, { text: "❌ Errore nel resettare il link" })
            }
        }

        // ===== MEDIA E STICKER =====

        // 40. Testo artistico
        if (command === ".ascii") {
            const text = args.slice(1).join(" ")
            if (!text) return sock.sendMessage(from, { text: "Usa: .ascii testo" })

            // Semplice conversione in caratteri artistici
            const artistic = text.toUpperCase().split('').map(char => {
                const ascii = {
                    'A': '🅰️', 'B': '🅱️', 'C': '©️', 'D': 'D', 'E': 'E', 'F': 'F',
                    'G': 'G', 'H': 'H', 'I': '🅸', 'J': 'J', 'K': 'K', 'L': 'L',
                    'M': '🅼', 'N': 'N', 'O': '⭕', 'P': '🅿️', 'Q': 'Q', 'R': 'R',
                    'S': 'S', 'T': 'T', 'U': 'U', 'V': 'V', 'W': 'W', 'X': '❌',
                    'Y': 'Y', 'Z': 'Z', ' ': '   '
                }
                return ascii[char] || char
            }).join(' ')

            await sock.sendMessage(from, { text: artistic })
        }

        // ===== AIUTO E INFORMAZIONI =====

        // 41. Help generale
        if (command === ".help" || command === ".aiuto") {
            const helpText = `🤖 **COMANDI BOT** 🤖

👑 **ADMIN**
.kick @utente - Espelli utente
.p @utente - Promuovi admin  
.demote @utente - Rimuovi admin
.warn @utente - Avvisa utente
.chiudi/.apri - Chiudi/apri gruppo
.nome <nome> - Cambia nome
.desc <testo> - Cambia descrizione
.admins - Lista admin
.link - Link gruppo
.resetlink - Reset link

🎮 **GIOCHI**
.dado - Lancia dado
.moneta - Testa o croce  
.8ball <domanda> - Palla magica
.quiz - Quiz cultura
.numero - Indovina numero
.ship - Accoppia utenti

🛠️ **UTILITÀ**
.info [@utente] - Info utente
.top - Classifica punti
.calc <operazione> - Calcolatrice
.timer <min> <msg> - Timer
.sondaggio <domanda> - Crea sondaggio
.vota si/no - Vota sondaggio
.risultati - Risultati sondaggio

💬 **SOCIALE**
.saluta - Saluta gruppo
.complimento [@utente] - Complimento
.motiva - Frase motivazionale
.chie <azione> - Chi è più probabile

😂 **DIVERTIMENTO**
.meme - Meme casuale
.barza - Barzelletta
.emoji - Emoji casuali
.fatto - Fatto interessante
.consiglio - Consiglio utile

🎲 **RANDOM**
.scegli opt1,opt2,opt3 - Scegli opzione
.random <min> <max> - Numero casuale
.colore - Colore casuale
.ascii <testo> - Testo artistico

📊 **INFO**
.membri - Conta membri
.regole - Regole gruppo
.stats - Statistiche bot

Scrivi .help2 per altri comandi!`

            await sock.sendMessage(from, { text: helpText })
        }

        // 42. Help esteso
        if (command === ".help2") {
            const helpText2 = `🤖 **ALTRI COMANDI** 🤖

🎯 **SFIDE**
.sfida @utente - Sfida a battaglia
.accetta - Accetta sfida
.rifiuta - Rifiuta sfida
.battaglia - Battaglia pokemon

🌟 **LIVELLI**
.daily - Bonus giornaliero  
.lavoro - Guadagna punti
.shop - Negozio virtuale
.buy <item> - Compra oggetto
.inventario - I tuoi oggetti

🔮 **PREDIZIONI**
.futuro - Predici il futuro
.amore - Percentuale amore
.fortuna - Livello fortuna
.morte - Quando morirai (scherzo!)

🎵 **MUSIC & MEDIA**  
.canzone - Canzone del giorno
.film - Film consigliato
.libro - Libro consigliato
.ricetta - Ricetta casuale

⚡ **AZIONI**
.schiaffo @utente - Schiaffeggia
.abbraccio @utente - Abbraccia  
.bacio @utente - Bacia
.pizza @utente - Offri pizza

🌍 **MONDO**
.meteo <città> - Meteo città
.traduce <testo> - Traduci testo
.news - Notizie del giorno
.crypto - Prezzi crypto

🤖 **BOT INFO**
.ping - Test velocità
.uptime - Tempo online  
.version - Versione bot
.credits - Crediti sviluppatore`

            await sock.sendMessage(from, { text: helpText2 })
        }

        // 43. Regole gruppo
        if (command === ".regole") {
            const rules = `📋 **REGOLE DEL GRUPPO**

1. ❌ No spam o flood
2. 🚫 No contenuti offensivi  
3. 👥 Rispetta tutti i membri
4. 🔞 No contenuti per adulti
5. 📵 No pubblicità non autorizzata
6. 🤝 Sii gentile e cortese
7. 🎯 Resta in topic
8. 🚨 Segnala comportamenti scorretti

⚠️ Chi non rispetta le regole riceverà warning!
❌ 3 warning = espulsione automatica`

            await sock.sendMessage(from, { text: rules })
        }

        // 44. Statistiche bot
        if (command === ".stats") {
            const totalUsers = Object.keys(userData).length
            const totalPoints = Object.values(userData).reduce((sum, user) => sum + user.points, 0)
            const activeGames = Object.keys(games).length
            const activePolls = Object.keys(polls).length

            await sock.sendMessage(from, { 
                text: `📊 **STATISTICHE BOT**\n\n👤 Utenti registrati: ${totalUsers}\n⭐ Punti totali: ${totalPoints}\n🎮 Giochi attivi: ${activeGames}\n📊 Sondaggi attivi: ${activePolls}` 
            })
        }

        // 45. Daily bonus
        if (command === ".daily") {
            const user = getUserData(sender)
            const now = new Date()
            const today = now.toDateString()

            if (user.lastDaily === today) {
                return sock.sendMessage(from, { text: "❌ Hai già ritirato il bonus giornaliero!" })
            }

            const bonus = Math.floor(Math.random() * 50) + 25 // 25-74 punti
            user.points += bonus
            user.lastDaily = today

            await sock.sendMessage(from, { 
                text: `🎁 Daily bonus ritirato!\n+${bonus} punti!\nTotale: ${user.points} punti`, 
                mentions: [sender] 
            })
        }

        // 46. Lavoro per punti
        if (command === ".lavoro") {
            const user = getUserData(sender)
            const jobs = [
                { name: "Programmatore", points: Math.floor(Math.random() * 30) + 20 },
                { name: "Cuoco", points: Math.floor(Math.random() * 25) + 15 },
                { name: "Dottore", points: Math.floor(Math.random() * 35) + 25 },
                { name: "Insegnante", points: Math.floor(Math.random() * 20) + 10 },
                { name: "Artista", points: Math.floor(Math.random() * 40) + 10 }
            ]

            const job = getRandomItem(jobs)
            user.points += job.points

            await sock.sendMessage(from, { 
                text: `💼 Hai lavorato come ${job.name}!\n+${job.points} punti!\nTotale: ${user.points} punti` 
            })
        }

        // 47. Sfida battaglia
        if (command === ".sfida") {
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .sfida @utente" })

            games[from] = { 
                type: "battle_request", 
                challenger: sender, 
                challenged: mentioned[0],
                timeout: Date.now() + 60000 // 1 minuto per accettare
            }

            await sock.sendMessage(from, { 
                text: `⚔️ @${sender.split('@')[0]} ha sfidato @${mentioned[0].split('@')[0]} a battaglia!\n\nUsa .accetta o .rifiuta entro 1 minuto!`, 
                mentions: [sender, mentioned[0]] 
            })
        }

        // 48. Accetta sfida
        if (command === ".accetta") {
            const game = games[from]
            if (!game || game.type !== "battle_request") return sock.sendMessage(from, { text: "Nessuna sfida attiva!" })
            if (sender !== game.challenged) return sock.sendMessage(from, { text: "Non sei stato sfidato!" })
            if (Date.now() > game.timeout) return sock.sendMessage(from, { text: "Tempo scaduto!" })

            // Inizia battaglia
            const challenger = getUserData(game.challenger)
            const challenged = getUserData(game.challenged)

            const challengerPower = Math.floor(Math.random() * 100) + challenger.level * 10
            const challengedPower = Math.floor(Math.random() * 100) + challenged.level * 10

            const winner = challengerPower > challengedPower ? game.challenger : game.challenged
            const loser = winner === game.challenger ? game.challenged : game.challenger
            const winnerData = getUserData(winner)

            winnerData.points += 50

            await sock.sendMessage(from, { 
                text: `⚔️ BATTAGLIA EPICA!\n\n💪 ${game.challenger.split('@')[0]}: ${challengerPower} power\n💪 ${game.challenged.split('@')[0]}: ${challengedPower} power\n\n🏆 VINCITORE: @${winner.split('@')[0]}!\n+50 punti!`, 
                mentions: [winner] 
            })

            delete games[from]
        }

        // 49. Ping test
        if (command === ".ping") {
            const start = Date.now()
            await sock.sendMessage(from, { text: "🏓 Pong!" })
            const ping = Date.now() - start

            setTimeout(async () => {
                await sock.sendMessage(from, { text: `⚡ Latenza: ${ping}ms` })
            }, 500)
        }

        // 50. Informazioni bot
        if (command === ".version") {
            const uptime = process.uptime()
            const hours = Math.floor(uptime / 3600)
            const minutes = Math.floor((uptime % 3600) / 60)

            await sock.sendMessage(from, { 
                text: `🤖 **BOT INFO**\n\n📱 Versione: 2.0.0\n⚡ Uptime: ${hours}h ${minutes}m\n🔧 Comandi: 50+\n👨‍💻 Sviluppato con Baileys\n❤️ Made with love` 
            })
        }

        // BONUS COMANDI EXTRA:

        // Meteo (simulato)
        if (command === ".meteo") {
            const city = args.slice(1).join(" ") || "Roma"
            const temp = Math.floor(Math.random() * 35) + 5
            const conditions = ["Soleggiato ☀️", "Nuvoloso ☁️", "Piovoso 🌧️", "Nevoso ❄️", "Tempestoso ⛈️"]

            await sock.sendMessage(from, { 
                text: `🌡️ **METEO ${city.toUpperCase()}**\n\n🌡️ Temperatura: ${temp}°C\n🌤️ Condizioni: ${getRandomItem(conditions)}\n💧 Umidità: ${Math.floor(Math.random() * 40) + 30}%` 
            })
        }

        // Predici futuro
        if (command === ".futuro") {
            const predictions = [
                "Riceverai una bella sorpresa! 🎁",
                "Incontrerai una persona speciale! 💕", 
                "Avrai una giornata fortunata! 🍀",
                "Risolverai un problema importante! ✅",
                "Riceverai buone notizie! 📰",
                "Farai una scoperta interessante! 🔍"
            ]

            await sock.sendMessage(from, { 
                text: `🔮 **PREDIZIONE DEL FUTURO**\n\n${getRandomItem(predictions)}` 
            })
        }

        // Ricetta casuale
        if (command === ".ricetta") {
            const recipes = [
                { name: "Pasta Carbonara", ing: "uova, pancetta, pecorino, pepe" },
                { name: "Pizza Margherita", ing: "mozzarella, pomodoro, basilico" },
                { name: "Risotto ai funghi", ing: "riso, funghi, brodo, parmigiano" },
                { name: "Tiramisù", ing: "mascarpone, caffè, savoiardi, cacao" }
            ]

            const recipe = getRandomItem(recipes)
            await sock.sendMessage(from, { 
                text: `👨‍🍳 **RICETTA DEL GIORNO**\n\n🍽️ ${recipe.name}\n📝 Ingredienti: ${recipe.ing}\n\nBuon appetito! 😋` 
            })
        }

        // Abraccio virtuale
        if (command === ".abbraccio") {
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .abbraccio @utente" })

            const hugs = ["🤗", "🫂", "💝", "🤗💕", "🌟🤗🌟"]
            await sock.sendMessage(from, { 
                text: `${getRandomItem(hugs)} @${sender.split('@')[0]} ha abbracciato @${mentioned[0].split('@')[0]}! Che dolce! 💖`, 
                mentions: [sender, mentioned[0]] 
            })
        }

        // Casino e scommesse
        if (command === ".slot") {
            const user = getUserData(sender)
            const bet = parseInt(args[1]) || 10

            if (user.points < bet) return sock.sendMessage(from, { text: "❌ Non hai abbastanza punti!" })

            const slots = ["🍒", "🍋", "🍊", "⭐", "💎", "7️⃣"]
            const result = [getRandomItem(slots), getRandomItem(slots), getRandomItem(slots)]

            user.points -= bet
            let win = 0

            if (result[0] === result[1] && result[1] === result[2]) {
                // Jackpot!
                if (result[0] === "💎") win = bet * 10
                else if (result[0] === "7️⃣") win = bet * 8
                else if (result[0] === "⭐") win = bet * 5
                else win = bet * 3
            } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
                // Due uguali
                win = bet * 2
            }

            user.points += win
            const profit = win - bet

            await sock.sendMessage(from, {
                text: `🎰 SLOT MACHINE 🎰\n\n${result.join(" | ")}\n\n💰 Scommessa: ${bet} punti\n${profit > 0 ? `🎉 HAI VINTO ${win} punti! (+${profit})` : profit < 0 ? `😞 Hai perso ${bet} punti!` : "🤝 Pareggio!"}\n💼 Saldo: ${user.points} punti`
            })
        }

        // Blackjack semplice
        if (command === ".blackjack" || command === ".bj") {
            const user = getUserData(sender)
            const bet = parseInt(args[1]) || 20

            if (user.points < bet) return sock.sendMessage(from, { text: "❌ Non hai abbastanza punti!" })

            const cards = [1,2,3,4,5,6,7,8,9,10,10,10,10,11]
            const playerCard1 = getRandomItem(cards)
            const playerCard2 = getRandomItem(cards)
            const dealerCard = getRandomItem(cards)

            let playerTotal = playerCard1 + playerCard2
            let dealerTotal = dealerCard + getRandomItem(cards)

            // Aggiusta gli assi
            if (playerTotal > 21 && (playerCard1 === 11 || playerCard2 === 11)) playerTotal -= 10
            if (dealerTotal > 21 && dealerCard === 11) dealerTotal -= 10

            user.points -= bet
            let result = ""

            if (playerTotal === 21) {
                user.points += bet * 2.5
                result = `🎉 BLACKJACK! Hai vinto ${bet * 1.5} punti!`
            } else if (playerTotal > 21) {
                result = `💥 SBALLATO! Hai perso ${bet} punti!`
            } else if (dealerTotal > 21) {
                user.points += bet * 2
                result = `🎉 Dealer sballato! Hai vinto ${bet} punti!`
            } else if (playerTotal > dealerTotal) {
                user.points += bet * 2
                result = `🎉 HAI VINTO! (+${bet} punti)`
            } else if (playerTotal < dealerTotal) {
                result = `😞 Hai perso ${bet} punti!`
            } else {
                user.points += bet
                result = `🤝 PAREGGIO! Scommessa restituita`
            }

            await sock.sendMessage(from, {
                text: `🃏 BLACKJACK 🃏\n\n🎯 Tu: ${playerTotal}\n🤖 Dealer: ${dealerTotal}\n\n${result}\n💼 Saldo: ${user.points} punti`
            })
        }

        // Sistema economico avanzato
        if (command === ".shop") {
            const items = [
                { name: "🎭 Titolo Personalizzato", price: 500, desc: "Scegli il tuo titolo!" },
                { name: "🌟 Boost XP x2", price: 300, desc: "Doppi punti per 1 ora" },
                { name: "🛡️ Protezione Kick", price: 800, desc: "Immune ai kick per 24h" },
                { name: "💎 Status VIP", price: 1000, desc: "Accesso comandi VIP" },
                { name: "🎨 Colore Nome", price: 200, desc: "Nome colorato" },
                { name: "🔥 Streak Bonus", price: 150, desc: "Bonus streak daily" }
            ]

            let text = "🛒 **NEGOZIO BOT**\n\n"
            items.forEach((item, i) => {
                text += `${i+1}. ${item.name}\n💰 Prezzo: ${item.price} punti\n📝 ${item.desc}\n\n`
            })
            text += "Usa: .buy <numero> per comprare!"

            await sock.sendMessage(from, { text })
        }

        if (command === ".buy") {
            const itemNum = parseInt(args[1])
            const items = [
                { name: "🎭 Titolo Personalizzato", price: 500 },
                { name: "🌟 Boost XP x2", price: 300 },
                { name: "🛡️ Protezione Kick", price: 800 },
                { name: "💎 Status VIP", price: 1000 },
                { name: "🎨 Colore Nome", price: 200 },
                { name: "🔥 Streak Bonus", price: 150 }
            ]

            if (!itemNum || itemNum < 1 || itemNum > items.length) {
                return sock.sendMessage(from, { text: "❌ Oggetto non valido! Usa .shop per vedere la lista" })
            }

            const user = getUserData(sender)
            const item = items[itemNum - 1]

            if (user.points < item.price) {
                return sock.sendMessage(from, { text: `❌ Non hai abbastanza punti! Ti servono ${item.price} punti` })
            }

            user.points -= item.price
            if (!user.inventory) user.inventory = []
            user.inventory.push(item.name)

            await sock.sendMessage(from, {
                text: `✅ Hai comprato ${item.name}!\n💰 Spesi: ${item.price} punti\n💼 Saldo: ${user.points} punti`
            })
        }

        if (command === ".inventario" || command === ".inv") {
            const user = getUserData(sender)
            if (!user.inventory || user.inventory.length === 0) {
                return sock.sendMessage(from, { text: "🎒 Il tuo inventario è vuoto!\nVai al .shop per comprare oggetti!" })
            }

            let text = "🎒 **IL TUO INVENTARIO**\n\n"
            user.inventory.forEach((item, i) => {
                text += `${i+1}. ${item}\n`
            })

            await sock.sendMessage(from, { text })
        }

        // Sistema matrimoni virtuali
        if (command === ".sposa") {
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []
            if (!mentioned.length) return sock.sendMessage(from, { text: "Usa: .sposa @utente" })

            const user = getUserData(sender)
            if (user.married) return sock.sendMessage(from, { text: "❌ Sei già sposato/a!" })

            games[from] = {
                type: "marriage_proposal",
                proposer: sender,
                proposed: mentioned[0],
                timeout: Date.now() + 120000
            }

            await sock.sendMessage(from, {
                text: `💍 @${sender.split('@')[0]} ha chiesto la mano a @${mentioned[0].split('@')[0]}!\n\n💒 Vuoi sposarti? Rispondi con .accettosposa o .rifiutosposa`,
                mentions: [sender, mentioned[0]]
            })
        }

        if (command === ".accettosposa") {
            const game = games[from]
            if (!game || game.type !== "marriage_proposal") return sock.sendMessage(from, { text: "Nessuna proposta di matrimonio!" })
            if (sender !== game.proposed) return sock.sendMessage(from, { text: "Non è per te questa proposta!" })

            const user1 = getUserData(game.proposer)
            const user2 = getUserData(game.proposed)

            user1.married = game.proposed
            user2.married = game.proposer
            user1.marriageDate = new Date().toLocaleDateString()
            user2.marriageDate = user1.marriageDate

            await sock.sendMessage(from, {
                text: `💒🎉 MATRIMONIO CELEBRATO! 🎉💒\n\n👰 @${game.proposed.split('@')[0]} e 🤵 @${game.proposer.split('@')[0]} sono ora marito e moglie!\n\n💝 +100 punti per entrambi!\n📅 Data matrimonio: ${user1.marriageDate}`,
                mentions: [game.proposer, game.proposed]
            })

            user1.points += 100
            user2.points += 100
            delete games[from]
        }

        if (command === ".divorzio") {
            const user = getUserData(sender)
            if (!user.married) return sock.sendMessage(from, { text: "❌ Non sei sposato/a!" })

            const spouse = getUserData(user.married)
            spouse.married = null
            spouse.marriageDate = null
            user.married = null
            user.marriageDate = null

            await sock.sendMessage(from, {
                text: `💔 Divorzio completato! Ora sei single di nuovo.\n😢 -50 punti per il dramma...`
            })
            user.points -= 50
        }

        // Sistema pets virtuali
        if (command === ".adotta") {
            const user = getUserData(sender)
            if (user.pet) return sock.sendMessage(from, { text: "❌ Hai già un pet!" })

            const pets = [
                { name: "🐶 Cane", happiness: 50, hunger: 30 },
                { name: "🐱 Gatto", happiness: 60, hunger: 20 },
                { name: "🐹 Criceto", happiness: 70, hunger: 40 },
                { name: "🐰 Coniglio", happiness: 55, hunger: 35 },
                { name: "🐦 Uccellino", happiness: 80, hunger: 15 }
            ]

            const pet = getRandomItem(pets)
            pet.name += ` ${["Buddy", "Luna", "Max", "Bella", "Charlie"][Math.floor(Math.random() * 5)]}`
            user.pet = pet
            user.points -= 100

            await sock.sendMessage(from, {
                text: `🎉 Hai adottato ${pet.name}!\n❤️ Felicità: ${pet.happiness}%\n🍽️ Fame: ${pet.hunger}%\n\n💰 Costo adozione: 100 punti\n💼 Saldo: ${user.points} punti`
            })
        }

        if (command === ".pet" || command === ".animale") {
            const user = getUserData(sender)
            if (!user.pet) return sock.sendMessage(from, { text: "❌ Non hai nessun pet! Usa .adotta" })

            const pet = user.pet
            await sock.sendMessage(from, {
                text: `${pet.name}\n\n❤️ Felicità: ${pet.happiness}%\n🍽️ Fame: ${pet.hunger}%\n\nUsa .cibo o .gioca per prendertene cura!`
            })
        }

        if (command === ".cibo") {
            const user = getUserData(sender)
            if (!user.pet) return sock.sendMessage(from, { text: "❌ Non hai nessun pet!" })
            if (user.points < 10) return sock.sendMessage(from, { text: "❌ Ti servono 10 punti per il cibo!" })

            user.pet.hunger = Math.max(0, user.pet.hunger - 30)
            user.pet.happiness += 10
            user.points -= 10

            await sock.sendMessage(from, {
                text: `🍖 Hai dato da mangiare al tuo ${user.pet.name}!\n❤️ Felicità: ${user.pet.happiness}%\n🍽️ Fame: ${user.pet.hunger}%`
            })
        }

        if (command === ".gioca") {
            const user = getUserData(sender)
            if (!user.pet) return sock.sendMessage(from, { text: "❌ Non hai nessun pet!" })

            user.pet.happiness += 15
            user.pet.hunger += 10
            const bonusPoints = Math.floor(Math.random() * 20) + 5
            user.points += bonusPoints

            await sock.sendMessage(from, {
                text: `🎾 Hai giocato con il tuo ${user.pet.name}!\n❤️ Felicità: +15% (ora ${user.pet.happiness}%)\n🍽️ Fame: +10% (ora ${user.pet.hunger}%)\n💰 Hai guadagnato ${bonusPoints} punti giocando!`
            })
        }

        // Mini-giochi avanzati
        if (command === ".memory") {
            const sequence = []
            for (let i = 0; i < 4; i++) {
                sequence.push(Math.floor(Math.random() * 9) + 1)
            }

            games[from] = {
                type: "memory",
                sequence: sequence,
                attempts: 0,
                maxAttempts: 3
            }

            await sock.sendMessage(from, {
                text: `🧠 MEMORY GAME!\n\nMemorizza questa sequenza:\n🔢 ${sequence.join(" - ")}\n\n⏰ Hai 10 secondi... poi dimmi la sequenza con .memoria <numeri>`
            })

            setTimeout(() => {
                if (games[from]?.type === "memory") {
                    sock.sendMessage(from, { text: "⏰ Tempo scaduto! Ora dimmi la sequenza con .memoria <numeri>" })
                }
            }, 10000)
        }

        if (command === ".memoria") {
            const game = games[from]
            if (!game || game.type !== "memory") return sock.sendMessage(from, { text: "Nessun gioco memory attivo!" })

            const userSequence = args.slice(1).map(n => parseInt(n))
            const correct = JSON.stringify(userSequence) === JSON.stringify(game.sequence)
            const user = getUserData(sender)

            if (correct) {
                const points = 100
                user.points += points
                await sock.sendMessage(from, {
                    text: `🎉 PERFETTO! Sequenza corretta!\n💰 +${points} punti!\n🧠 La tua memoria è incredibile!`
                })
                delete games[from]
            } else {
                game.attempts++
                if (game.attempts >= game.maxAttempts) {
                    await sock.sendMessage(from, {
                        text: `❌ Sbagliato! La sequenza era: ${game.sequence.join(" - ")}\n🧠 Allenati di più!`
                    })
                    delete games[from]
                } else {
                    await sock.sendMessage(from, {
                        text: `❌ Sequenza sbagliata! Tentativi rimasti: ${game.maxAttempts - game.attempts}`
                    })
                }
            }
        }

        // Sistema achievements
        if (command === ".achievements" || command === ".trofei") {
            const user = getUserData(sender)
            if (!user.achievements) user.achievements = []

            const allAchievements = [
                { id: "first_points", name: "🌟 Primi Passi", desc: "Ottieni i primi 100 punti", req: () => user.points >= 100 },
                { id: "gambler", name: "🎰 Scommettitore", desc: "Gioca 10 volte alla slot", req: () => (user.slotPlayed || 0) >= 10 },
                { id: "married", name: "💒 Sposato", desc: "Sposati virtualmente", req: () => user.married },
                { id: "pet_owner", name: "🐕 Proprietario", desc: "Adotta un pet", req: () => user.pet },
                { id: "high_level", name: "🏆 Alto Livello", desc: "Raggiungi livello 10", req: () => user.level >= 10 }
            ]

            let text = "🏆 **I TUOI ACHIEVEMENTS**\n\n"
            allAchievements.forEach(achievement => {
                const unlocked = user.achievements.includes(achievement.id) || achievement.req()
                if (unlocked && !user.achievements.includes(achievement.id)) {
                    user.achievements.push(achievement.id)
                    user.points += 50 // Bonus per achievement
                }
                text += `${unlocked ? "✅" : "❌"} ${achievement.name}\n📝 ${achievement.desc}\n\n`
            })

            await sock.sendMessage(from, { text })
        }

        // Livello utente (calcolo automatico basato sui punti)
        const user = getUserData(sender)
        const newLevel = Math.floor(user.points / 100) + 1
        if (newLevel > user.level) {
            user.level = newLevel
            await sock.sendMessage(from, { 
                text: `🎉 LEVEL UP! @${sender.split('@')[0]} è ora livello ${newLevel}! 🏆\n💰 Bonus: +25 punti!`, 
                mentions: [sender] 
            })
            user.points += 25
        }

        // Aggiorna statistiche slot
        if (command === ".slot") {
            const user = getUserData(sender)
            if (!user.slotPlayed) user.slotPlayed = 0
            user.slotPlayed++
        }

    })

startBot()