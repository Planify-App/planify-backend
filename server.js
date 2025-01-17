const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require("./serviceAccountKey.json");
const  jp = require('jsonpath')
const crypto = require('crypto');


const app = express();

const { Client, createClient} = require('@libsql/client'); // Asegúrate de tener esta línea

app.use(express.json());
app.use(cors());

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.listen(process.env.PORT, () => {});

const tursoClient = createClient({
    url: 'libsql://planify-planify.turso.io',
    authToken: process.env.AUTH_TOKEN,
});

//firebase
const db = admin.firestore();
app.get('/api/login/verification', async (req, res) => {
    try {
        const correoHash = HashText(req.body.correo)
        const contrasena = HashText(req.body.contrasena)

        const usuariosSnapshot = await db.collection('Usuarios').doc(correoHash).get();
        if (usuariosSnapshot.data().contrasena !== contrasena) {
            res.json({status: false, message: "Contraseña incorrecta"});
        }else if (usuariosSnapshot.data().verificacion === false){
            res.json({status: false, message: "Usuario no verificado"});
        }else {
            res.json({ status: true, message: "Usuario verificado" });
        }

    }catch (error) {
        console.error("Error al obtener usuarios:", error);
        res.status(500).json({ error: "Error al obtener usuarios" });
    }
})

app.post('/api/register', async (req, res) => {
    try {
        const correoHash = HashText(req.body.correo);
        const infoUsuario = {
            contrasena: HashText(req.body.contrasena),
            correo: req.body.correo,
            nombre: req.body.nombre,
            nombre_usuario: req.body.nombre_usuario,
            verificacion: req.body.verificacion,
            quedadas: []
        }

        const usuariosSnapshot = await db.collection('Usuarios').doc(correoHash).get();
        if (usuariosSnapshot.exists) {
            res.json({ status: false, message: "El usuario ya existe" });
        }else {
            await db.collection('Usuarios').doc(correoHash).set(infoUsuario);
            res.json({ status: true, message: "Usuario registrado" });
        }

    }catch (error) {
        console.error("Error al registrar usuario:", error);
        res.status(500).json({ error: "Error al registrar usuario" });
    }
});

// Hashear textos


function HashText(correo){
    const hash = crypto.createHash('sha256');
    hash.update(correo);
    return hash.digest('hex');
}


app.get('/api/getQuedadasUser', async (req, res) => {
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

app.get('/api/getQuedadaById', async (req, res) => {
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

app.get('/api/getEventosUser', async (req, res) => {
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

app.get('/api/getUsersQuedada', async (req, res) => {
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