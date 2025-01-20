const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require("./serviceAccountKey.json");
const  jp = require('jsonpath')
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
require('dotenv').config();


const { Client, createClient} = require('@libsql/client');

const app = express();

app.use(express.json());
app.use(cors());

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.listen(process.env.PORT, () => {});


const tursoClient = createClient({
    authToken: process.env.AUTH_TOKEN,
    url: "libsql://planify-planify.turso.io",
});

const db = admin.firestore();

const noReplyEmail = '"Planify" <no-reply@eduni.dev>';
const subjectEmail = 'Verificación de Cuenta - Planify';

let transporter = nodemailer.createTransport({
    service: 'smtp',
    host: 'smtp.dondominio.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const templatePath = path.join(__dirname, 'plantilla-verificacion.html');

function authenticateAPIKey(req, res, next) {
    const apiKey = req.header('x-api-key');

    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(403).json({ message: 'Acceso no autorizado' });
    }

    next();
}

app.post('/api/verification', authenticateAPIKey, async (req, res) => {
    try {
        const userToken = req.body.token

        const usuariosSnapshot = await db.collection('Usuarios').doc(userToken).get();

        if (!usuariosSnapshot.exists) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        await db.collection('Usuarios').doc(userToken).update({
            verificacion: true
        });

        const nombreUsuario = usuariosSnapshot.data().nombre_usuario;

        res.status(200).json({ message: "Usuario " + nombreUsuario + " verificado con éxito" });

    } catch (error) {
        console.error("Error al obtener usuarios:", error);
        res.status(500).json({ error: "Error al obtener usuarios" });
    }
})

app.get('/api/login', authenticateAPIKey, async (req, res) => {
    try {
        const correoHash = HashText(req.body.correo)
        const contrasena = HashText(req.body.contrasena)

        const usuariosSnapshot = await db.collection('Usuarios').doc(correoHash).get();
        if (usuariosSnapshot.data().contrasena === contrasena && usuariosSnapshot.data().correo === correoHash && usuariosSnapshot.data().verificacion === true) {
            res.json({ status: true, message: "Sesión iniciada con éxito" });
        } else if (usuariosSnapshot.data().verificacion === false){
            res.json({status: false, message: "Este usuario no está verificado"});
        } else {
            res.json({status: false, message: "Contraseña o correo electrónico incorrectos"});
        }

    }catch (error) {
        console.error("Error al obtener usuarios:", error);
        res.status(500).json({ error: "Error al obtener usuarios" });
    }
})

app.post('/api/register', authenticateAPIKey, async (req, res) => {
    try {
        const data = {
            name: req.body.nombre,
            verification_link: `https://planify.eduni.dev/verificar?token=${HashText(req.body.correo)}`
        };

        ejs.renderFile(templatePath, data, async (err, htmlContent) => {
            if (err) {
                res.status(500).json({ error: "Error al procesar el correo de verificación" });
            }

            const mailOptions = {
                from: noReplyEmail,
                to: req.body.correo,
                subject: subjectEmail,
                html: htmlContent
            };

            const correoHash = HashText(req.body.correo);
            const infoUsuario = {
                contrasena: HashText(req.body.contrasena),
                correo: req.body.correo,
                nombre: req.body.nombre,
                nombre_usuario: req.body.nombre_usuario,
                verificacion: false,
                quedadas: []
            };

            const usuariosSnapshot = await db.collection('Usuarios').doc(correoHash).get();
            if (usuariosSnapshot.exists) {
                res.json({ status: false, message: "Este correo electrónico ya ha sido registrado en Planify" });
            } else {
                await db.collection('Usuarios').doc(correoHash).set(infoUsuario);

                await transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.log('Error al enviar el correo: ', error);
                    } else {
                        console.log('Correo enviado: ' + info.response);
                    }
                });
                res.json({ status: true, message: "Usuario " + req.body.nombre_usuario + " registrado con éxito" });
            }
        });
    } catch (error) {
        console.error("Error al registrar usuario:", error);
        res.status(500).json({ error: "Error al registrar usuario: " + req.body.nombre_usuario });
    }
});


app.get('/api/getQuedadasUser', authenticateAPIKey, async (req, res) => {
    try {
        const correoHash = HashText(req.body.correo);
        const usuariosSnapshot = await db.collection('Usuarios').doc(correoHash).get();
        const quedadas = usuariosSnapshot.data().quedadas;
        const quedadasFinal = await Promise.all(
            quedadas.map(async (idQuedada) => {
                const query = `SELECT id, nombre_quedada, descripcion_quedada,fecha_hora_inicio,link_imagen FROM quedadas WHERE id = ?`;
                try {
                    const result = await tursoClient.execute({
                        sql: query,
                        args: [idQuedada],
                    })
                    return result.rows.length > 0 ? result.rows[0] : null;
                } catch (error) {
                    console.error(`Error al obtener la quedada ${idQuedada}: ` + error);
                    return null;
                }

            })
        );
        res.json(quedadasFinal.filter((q) => q !== null));
    } catch (error) {
        res.status(error)
    }
});

app.get('/api/getQuedadaById', authenticateAPIKey, async (req, res) => {
    try {
        const idQuedada = req.body.id;
        const query = `SELECT * FROM quedadas WHERE id = ?`;
        const result = await tursoClient.execute({
            sql: query,
            args: [idQuedada],
        })
        console.log(result.rows)
        res.json(result.rows);
    } catch (error) {
        res.status(error)
    }
});

app.get('/api/getEventosUser', authenticateAPIKey, async (req, res) => {
    try {
        const correoHash = HashText(req.body.correo);
        const usuariosSnapshot = await db.collection('Usuarios').doc(correoHash).get();
        const quedadas = usuariosSnapshot.data().quedadas;
        const eventos = await Promise.all(
            quedadas.map(async (idQuedada) => {
                const query = `SELECT * FROM eventos WHERE id_quedada = ?`;
                try {
                    const result = await tursoClient.execute({
                        sql: query,
                        args: [idQuedada],
                    })
                    return result.rows.length > 0 ? result.rows : null;
                } catch (error) {
                    console.error(`Error al obtener el evento ${idQuedada}: ` + error);
                    return null;
                }

            })
        );
        res.json(eventos.filter(evento => evento !== null));
    } catch (error) {
        res.status(error)
    }
});

app.get('/api/getUsersQuedada', authenticateAPIKey, async (req, res) => {
    try {
        const idQuedada = req.body.id;

        const query = `SELECT id_usuario FROM usuarios_quedada WHERE id_quedada = ?`;
        const result = await tursoClient.execute({
            sql: query,
            args: [idQuedada],
        })

        const usuariosQuedada = await Promise.all(
            result.rows.map(async (idUsuario) => {
                try {
                    const usuariosSnapshot = await db.collection('Usuarios').doc(idUsuario).get();
                    return usuariosSnapshot.exists ? usuariosSnapshot.data() : null;
                } catch (error) {
                    console.error(`Error al obtener el usuario ${idUsuario}: ` + error);
                    return null;
                }

            })
        );
        res.json(usuariosQuedada);
    } catch (error) {
        res.status(error)
    }
});

function HashText(text){
    const hash = crypto.createHash('sha256');
    hash.update(text);
    return hash.digest('hex');
}