import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth } from '../firebase/config';

const AuthContext = createContext(null);

const googleProvider = new GoogleAuthProvider();

// Clave usada en localStorage para persistir el bypass de dev
const DEV_KEY = 'ciancia_dev_bypass';

// Credenciales de fallback de desarrollo para el administrador
const DEV_ADMIN_EMAIL = 'lucciancia20@gmail.com';
const DEV_ADMIN_PASS  = 'Ciancia2026#';

// Usuario simulado — nunca toca Firebase Auth
const DEV_USER = {
  uid: 'dev-local-admin',
  email: DEV_ADMIN_EMAIL,
  displayName: 'Luciano Ciancia (Admin)',
  isDevBypass: true,
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem(DEV_KEY) ? DEV_USER : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(DEV_KEY)) {
        setLoading(false);
        return;
      }
    } catch {
      // ignore storage errors
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Intenta autenticar con Firebase Auth primero; si el proveedor o el usuario
  // aún no están dados de alta en Firebase, permite el fallback seguro de desarrollo
  // cuando las credenciales coinciden exactamente con el administrador.
  const login = async (email, password) => {
    const cleanEmail = String(email || '').trim();
    const cleanPass  = String(password || '');

    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
      return cred;
    } catch (firebaseErr) {
      if (
        cleanEmail.toLowerCase() === DEV_ADMIN_EMAIL &&
        cleanPass === DEV_ADMIN_PASS
      ) {
        try {
          localStorage.setItem(DEV_KEY, '1');
        } catch {
          // ignore storage errors
        }
        setUser(DEV_USER);
        return { user: DEV_USER, isFallback: true };
      }
      throw firebaseErr;
    }
  };

  const loginWithGoogle = () =>
    signInWithPopup(auth, googleProvider);

  // Bypass 100% local — no toca Firebase
  const loginDev = () => {
    try {
      localStorage.setItem(DEV_KEY, '1');
    } catch {
      // ignore storage errors
    }
    setUser(DEV_USER);
  };

  const logout = () => {
    try {
      if (localStorage.getItem(DEV_KEY)) {
        localStorage.removeItem(DEV_KEY);
        setUser(null);
        return Promise.resolve();
      }
    } catch {
      setUser(null);
      return Promise.resolve();
    }
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, loginDev, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
