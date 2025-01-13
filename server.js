const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require("./serviceAccountKey.json");
const  jp = require('jsonpath')
const crypto = require('crypto');


const app = express();
const port = 3080;


app.use(express.json());
app.use(cors());

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.listen(port, () => {
    console.log(`Escuchando en el puerto: ${port}`);
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

app.post('api/register/registerUser', async (req, res) => {
    try {
        const correoHash = HashText(req.body.correo);
        const infoUsuario = {
            contrasena: HashText(req.body.contrasena),
            correo: req.body.correo,
            nombre: req.body.nombre,
            nombre_usuario: req.body.nombre_usuario,
            verificacion: req.body.verificacion
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