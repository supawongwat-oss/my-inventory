// firebase.js — วางไฟล์นี้ไว้ใน src/
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA6W7VGiYAjstNkmyKfvPccatH6LWRxtfQ",
  authDomain: "cpu-erp.firebaseapp.com",
  projectId: "cpu-erp",
  storageBucket: "cpu-erp.firebasestorage.app",
  messagingSenderId: "710178681062",
  appId: "1:710178681062:web:e61902474d003b7bca0b27",
  measurementId: "G-MLDJ4KE8T4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
