// auth.js — HU21/HU22: login real con Firebase Authentication
// (email + contraseña). Necesita que firebase-config.js ya haya
// cargado ANTES que este archivo, con tus datos reales de tu
// proyecto de Firebase (ver README, sección Firebase).

const auth = firebase.auth();

// MIDP-19 / MIDP-24: dos tipos de usuario con sesión iniciada.
// - Registrado: cualquiera que se registre (ve los datos avanzados).
// - Premium: los emails de esta lista (además puede descargar el historial
//   en CSV y sugerir datos nuevos a los creadores).
// COMPLETÁ ESTAS DOS LÍNEAS con los emails reales (en minúsculas):
const PREMIUM_EMAILS = ["albatatianaperalta2013@gmail.com"];
// Mail del administrador de la página, a donde llegan las sugerencias:
const ADMIN_EMAIL = "pablo.cau15@gmail.com";

function mostrarLogueado(email) {
  document.getElementById("auth-logged-out").classList.add("hidden");
  document.getElementById("auth-logged-in").classList.remove("hidden");
  document.getElementById("auth-user-email").textContent = email;
}

function mostrarDeslogueado() {
  document.getElementById("auth-logged-out").classList.remove("hidden");
  document.getElementById("auth-logged-in").classList.add("hidden");
}

function mostrarErrorAuth(mensaje) {
  const el = document.getElementById("auth-error");
  el.textContent = mensaje;
  el.classList.remove("hidden");
}

function limpiarErrorAuth() {
  const el = document.getElementById("auth-error");
  el.textContent = "";
  el.classList.add("hidden");
}

// Traduce los códigos de error de Firebase (vienen en inglés, tipo
// "auth/wrong-password") a un mensaje entendible en español.
function traducirErrorFirebase(err) {
  const mensajes = {
    "auth/email-already-in-use": "Ese email ya está registrado. Iniciá sesión en vez de registrarte.",
    "auth/invalid-email": "El email no es válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe una cuenta con ese email. Registrate primero.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/missing-password": "Ingresá una contraseña.",
  };
  return mensajes[err.code] || `Ocurrió un error: ${err.message}`;
}

// onAuthStateChanged (pronunciado "on óz estéit chéinchd", significa
// "cuando cambia el estado de autenticación"): Firebase llama esta
// función sola, automáticamente, cada vez que alguien inicia o cierra
// sesión, y también al recargar la página si ya había una sesión activa
// (Firebase la recuerda sola, no hace falta guardar nada a mano).
auth.onAuthStateChanged((user) => {
  window.usuarioLogueado = !!user;
  window.usuarioPremium = !!user && PREMIUM_EMAILS.includes(user.email.toLowerCase());
  if (user) {
    mostrarLogueado(user.email);
  } else {
    mostrarDeslogueado();
  }
  // Avisamos al resto de la página (script.js) que el login cambió,
  // para que pueda mostrar/ocultar los datos avanzados.
  window.dispatchEvent(new CustomEvent("authchange"));
});

document.getElementById("login-btn").addEventListener("click", async () => {
  limpiarErrorAuth();
  const email = document.getElementById("auth-email").value.trim();
  const pass = document.getElementById("auth-pass").value;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    mostrarErrorAuth(traducirErrorFirebase(err));
  }
});

document.getElementById("register-btn").addEventListener("click", async () => {
  limpiarErrorAuth();
  const email = document.getElementById("auth-email").value.trim();
  const pass = document.getElementById("auth-pass").value;
  try {
    await auth.createUserWithEmailAndPassword(email, pass);
  } catch (err) {
    mostrarErrorAuth(traducirErrorFirebase(err));
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  auth.signOut();
});