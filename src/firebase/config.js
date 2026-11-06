// Firebase configuration - Ciancia Producciones
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBecMe6t_MjooYlykEXZ0QDZAbYnPP0RNo",
  authDomain: "ciancia-producciones.firebaseapp.com",
  projectId: "ciancia-producciones",
  storageBucket: "ciancia-producciones.firebasestorage.app",
  messagingSenderId: "182759843627",
  appId: "1:182759843627:web:02c88542e007c0a472d05a",
  measurementId: "G-XPTU5MX98M"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export default app;
