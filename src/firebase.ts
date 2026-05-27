import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const ADMIN_UIDS = ["YKzK471nwRcztvOjpHZp78hA5cz1", "admin@gmail.com", "admin@cryptoforge.online", "admin@smartbd.com"];
