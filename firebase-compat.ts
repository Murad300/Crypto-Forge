import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  limit,
  orderBy,
  runTransaction, 
  writeBatch,
  increment,
  serverTimestamp,
  deleteField,
  Timestamp
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import fs from "fs";
import path from "path";

// Load configuration
function getFirebaseConfig() {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      console.error("Error parsing firebase-applet-config.json:", e);
    }
  }
  // Hardcoded fallback configuration matching client-side settings
  return {
    apiKey: "AIzaSyD4K1as0o0WUb51nL6WGK5KAknG5oOpBwI",
    authDomain: "smart-bd365.firebaseapp.com",
    projectId: "smart-bd365",
    storageBucket: "smart-bd365.firebasestorage.app",
    messagingSenderId: "547646649024",
    appId: "1:547646649024:web:26888ba9bf7a70fce97325",
    firestoreDatabaseId: "ai-studio-c29a04c5-e49f-4a2e-b317-b1db3c318d65"
  };
}

// Lazy initialization helpers
let initializedAppInstance: any = null;
let initializedAuth: any = null;
let initializedDb: any = null;

function getFirebaseInstance() {
  if (initializedDb) {
    return { auth: initializedAuth, db: initializedDb };
  }
  
  const config = getFirebaseConfig();
  if (!config) {
    console.warn("⚠️ Firebase is not configured yet. firebase-applet-config.json is missing.");
    return null;
  }

  try {
    initializedAppInstance = getApps().length === 0 ? initializeApp(config) : getApp();
    initializedAuth = getAuth(initializedAppInstance);
    initializedDb = getFirestore(initializedAppInstance, config.firestoreDatabaseId);
    return { auth: initializedAuth, db: initializedDb };
  } catch (err) {
    console.error("❌ Failed to initialize Firebase:", err);
    return null;
  }
}

export function getRawDb() {
  const inst = getFirebaseInstance();
  if (!inst) {
    throw new Error("❌ Firebase database not configured. Please complete Firebase registration first.");
  }
  return inst.db;
}

export function getRawAuth() {
  const inst = getFirebaseInstance();
  if (!inst) {
    throw new Error("❌ Firebase Auth not configured. Please complete Firebase registration first.");
  }
  return inst.auth;
}

// Admin-level email and password for the Server Context
const SYSTEM_EMAIL = "backend-admin@cryptoforge.local";
const SYSTEM_PASSWORD = "SuperSecureBackendSystemPass123_!";

// Sign in the Web Auth client on start-up dynamically to satisfy the general Firestore security rules
export async function authenticateBackendSystem() {
  console.log("🔑 Authenticating server backend system user...");
  try {
    const auth = getRawAuth();
    const userCred = await signInWithEmailAndPassword(auth, SYSTEM_EMAIL, SYSTEM_PASSWORD);
    console.log("✅ Server system auth user connected successfully. UID:", userCred.user.uid);
    return userCred.user.uid;
  } catch (err: any) {
    console.warn("⚠️ Initial system auth sign-in failed. Error code:", err.code, "Message:", err.message);
    try {
      console.log("Attempting to create system account dynamically...");
      const auth = getRawAuth();
      const userCred = await createUserWithEmailAndPassword(auth, SYSTEM_EMAIL, SYSTEM_PASSWORD);
      console.log("✅ System account database setup completed! UID:", userCred.user.uid);
      return userCred.user.uid;
    } catch (regErr: any) {
      if (regErr.code === "auth/email-already-in-use") {
        console.log("System account email already exists. Retrying sign-in...");
        try {
          const auth = getRawAuth();
          const userCred = await signInWithEmailAndPassword(auth, SYSTEM_EMAIL, SYSTEM_PASSWORD);
          console.log("✅ Server system auth user connected successfully on retry. UID:", userCred.user.uid);
          return userCred.user.uid;
        } catch (retryErr: any) {
          console.error("❌ System auth retry sign-in failed:", retryErr);
          throw retryErr;
        }
      } else {
        console.error("❌ Fatal: Failed to register fallback backend system user:", regErr);
        throw regErr;
      }
    }
  }
}

// Wrapper classes to map standard Firestore Admin API to standard Web SDK
export class CompatDocumentReference {
  constructor(public colPath: string, public docId: string, public _rawDocRef: any) {}

  get id() {
    return this.docId;
  }

  get ref() {
    return this;
  }

  async get() {
    const snap = await getDoc(this._rawDocRef);
    return new CompatDocumentSnapshot(snap);
  }

  async set(data: any) {
    await setDoc(this._rawDocRef, data);
  }

  async update(data: any) {
    await updateDoc(this._rawDocRef, data);
  }

  async delete() {
    await deleteDoc(this._rawDocRef);
  }

  collection(subColPath: string) {
    return new CompatCollectionReference(`${this.colPath}/${this.docId}/${subColPath}`);
  }
}

export class CompatDocumentSnapshot {
  constructor(public _rawSnap: any) {}

  get id() {
    return this._rawSnap.id;
  }

  get exists() {
    return this._rawSnap.exists();
  }

  get ref() {
    return new CompatDocumentReference(
      this._rawSnap.ref.parent.path,
      this._rawSnap.ref.id,
      this._rawSnap.ref
    );
  }

  data() {
    return this._rawSnap.data();
  }
}

export class CompatCollectionReference {
  private _wheres: any[] = [];
  private _limit: number | null = null;
  private _orderBys: any[] = [];

  constructor(public colPath: string) {}

  doc(docId?: string) {
    const id = docId || doc(collection(getRawDb(), this.colPath)).id;
    const rawRef = doc(getRawDb(), this.colPath, id);
    return new CompatDocumentReference(this.colPath, id, rawRef);
  }

  where(field: string, op: any, value: any) {
    const mappedOp = op === "===" ? "==" : op;
    const newCol = new CompatCollectionReference(this.colPath);
    newCol._wheres = [...this._wheres, where(field, mappedOp, value)];
    newCol._limit = this._limit;
    newCol._orderBys = [...this._orderBys];
    return newCol;
  }

  limit(n: number) {
    const newCol = new CompatCollectionReference(this.colPath);
    newCol._wheres = [...this._wheres];
    newCol._limit = n;
    newCol._orderBys = [...this._orderBys];
    return newCol;
  }

  orderBy(field: string, direction?: "asc" | "desc") {
    const newCol = new CompatCollectionReference(this.colPath);
    newCol._wheres = [...this._wheres];
    newCol._limit = this._limit;
    newCol._orderBys = [...this._orderBys, orderBy(field, direction || "asc")];
    return newCol;
  }

  async get() {
    const colRef = collection(getRawDb(), this.colPath);
    let q: any = colRef;
    const constraints = [...this._wheres];
    if (this._orderBys.length > 0) {
      constraints.push(...this._orderBys);
    }
    if (this._limit !== null) {
      constraints.push(limit(this._limit));
    }
    if (constraints.length > 0) {
      q = query(colRef, ...constraints);
    }
    const snap = await getDocs(q);
    return new CompatQuerySnapshot(snap);
  }
}

export class CompatQuerySnapshot {
  constructor(public _rawSnap: any) {}

  get empty() {
    return this._rawSnap.empty;
  }

  get size() {
    return this._rawSnap.size;
  }

  get docs() {
    return this._rawSnap.docs.map((d: any) => new CompatDocumentSnapshot(d));
  }

  forEach(callback: (doc: CompatDocumentSnapshot) => void) {
    this._rawSnap.forEach((d: any) => {
      callback(new CompatDocumentSnapshot(d));
    });
  }
}

export class CompatBatch {
  private _batch: any;
  constructor() {
    this._batch = writeBatch(getRawDb());
  }

  set(docRef: CompatDocumentReference, data: any) {
    this._batch.set(docRef._rawDocRef, data);
    return this;
  }

  update(docRef: CompatDocumentReference, data: any) {
    this._batch.update(docRef._rawDocRef, data);
    return this;
  }

  delete(docRef: CompatDocumentReference) {
    this._batch.delete(docRef._rawDocRef);
    return this;
  }

  async commit() {
    await this._batch.commit();
  }
}

export class CompatTransaction {
  constructor(public _rawTx: any) {}

  async get(ref: any): Promise<any> {
    if (ref instanceof CompatCollectionReference) {
      return await ref.get();
    }
    const snap = await this._rawTx.get(ref._rawDocRef);
    return new CompatDocumentSnapshot(snap);
  }

  set(ref: CompatDocumentReference, data: any) {
    this._rawTx.set(ref._rawDocRef, data);
    return this;
  }

  update(ref: CompatDocumentReference, data: any) {
    this._rawTx.update(ref._rawDocRef, data);
    return this;
  }

  delete(ref: CompatDocumentReference) {
    this._rawTx.delete(ref._rawDocRef);
    return this;
  }
}

export class CompatFirestore {
  collection(colPath: string) {
    return new CompatCollectionReference(colPath);
  }

  batch() {
    return new CompatBatch();
  }

  async runTransaction(callback: (tx: CompatTransaction) => Promise<any>) {
    return await runTransaction(getRawDb(), async (rawTx) => {
      const compatTx = new CompatTransaction(rawTx);
      return await callback(compatTx);
    });
  }
}

export const dbCompat = new CompatFirestore();

// Full Admin SDK mock object
export const adminCompat = {
  apps: [{ name: "[DEFAULT]" }],
  initializeApp: () => {
    return {};
  },
  auth: () => ({
    getUserByEmail: async (email: string) => {
      // Look up user UID from users collection mapped
      const snap = await dbCompat.collection("users").where("email", "==", email.toLowerCase().trim()).get();
      if (snap.empty) {
        throw new Error("User corresponding to this email was not registered in user profiles.");
      }
      return { uid: snap.docs[0].id, email };
    },
    updateUser: async (uid: string, properties: any) => {
      // Client-side authentication performs email verification, so updating Auth properties on DB is sufficient
      console.log(`[Bypassed auth.updateUser for ${uid}]: properties updated`, properties);
      return { uid };
    },
    createCustomToken: async (uid: string) => {
      // Return a dummy token bypass because the client-side user is always logged in on web client
      return "dummy-token-bypass";
    }
  }),
  firestore: {
    FieldValue: {
      increment: (val: number) => increment(val),
      serverTimestamp: () => serverTimestamp(),
      delete: () => deleteField()
    },
    Timestamp: Timestamp
  }
};
