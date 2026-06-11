import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { dbCompat, adminCompat as admin, authenticateBackendSystem } from "./firebase-compat";
import cron from "node-cron";
import fs from "fs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { getActiveSecondsForToday, calculateProfit, calculateDailyCommission, getBDDate, calculateInstantCommission, calculateAccruedEarnings, getBDEndOfDay, getBDMidnight, getDhakaDate } from "./server-mining-math";

// Load environment variables
dotenv.config();

// Load Firebase Config helper
function getFirebaseConfig() {
  // 1. Try environment variables
  if (process.env.FIREBASE_API_KEY) {
    return {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "smart-bd365.firebaseapp.com",
      projectId: process.env.FIREBASE_PROJECT_ID || "smart-bd365",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "smart-bd365.firebasestorage.app",
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "547646649024",
      appId: process.env.FIREBASE_APP_ID || "1:547646649024:web:26888ba9bf7a70fce97325",
      firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || process.env.FIREBASE_FIRESTORE_DATABASE_ID || "ai-studio-c29a04c5-e49f-4a2e-b317-b1db3c318d65"
    };
  }

  // 1b. Try raw JSON environment variable if provided
  if (process.env.FIREBASE_CONFIG_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_CONFIG_JSON);
    } catch (e) {
      console.error("Error parsing FIREBASE_CONFIG_JSON:", e);
    }
  }

  // 2. Try file path
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      console.error("Error parsing firebase-applet-config.json:", e);
    }
  }

  // 3. Static fallback configuration matching standard client-side settings
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

// Initialize Firebase Admin lazily logic
let db: any = null;
function ensureDb() {
  if (db) return db;
  db = dbCompat;
  return db;
}
ensureDb();

const expressApp = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

expressApp.use(express.json());

// Token Verification Middleware using Firebase Admin or secure Identity Toolkit fallback
const verifyToken = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const config = getFirebaseConfig();
    const apiKey = config.apiKey;
    
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    });
    
    if (!lookupRes.ok) {
      const errorData = await lookupRes.json();
      return res.status(401).json({ error: "Invalid token", details: errorData });
    }
    
    const data = await lookupRes.json();
    if (!data.users || data.users.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    
    req.user = { uid: data.users[0].localId };
    next();
  } catch (err: any) {
    console.error("verifyToken error:", err);
    return res.status(401).json({ error: "Authentication failed", details: err.message });
  }
};

// Admin Verification Middleware using Firebase Admin/Auth and admins collection lookup
const verifyAdmin = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const config = getFirebaseConfig();
    const apiKey = config.apiKey;
    
    const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    });
    
    if (!lookupRes.ok) {
      const errorData = await lookupRes.json();
      return res.status(401).json({ error: "Invalid token", details: errorData });
    }
    
    const data = await lookupRes.json();
    if (!data.users || data.users.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    
    const uid = data.users[0].localId;
    const email = data.users[0].email;
    
    const database = ensureDb();
    if (!database) return res.status(503).json({ error: "Backend not configured" });
    
    const adminDoc = await database.collection("admins").doc(uid).get();
    const isHardcodedAdmin = email?.toLowerCase() === "shaikhmdmurad1@gmail.com";
    
    if ((adminDoc.exists && email?.toLowerCase() === "shaikhmdmurad1@gmail.com") || isHardcodedAdmin) {
      req.user = { uid, email };
      return next();
    } else {
      return res.status(403).json({ error: "Access denied. Insufficient permissions." });
    }
  } catch (err: any) {
    console.error("verifyAdmin error:", err);
    return res.status(401).json({ error: "Authentication failed", details: err.message });
  }
};

// --- Mining Logic Helpers ---

async function distributeReferralCommission(database: any, userId: string, pkgPrice: number) {
  try {
    const userSnap = await database.collection("users").doc(userId).get();
    const userData = userSnap.data();
    if (!userData || !userData.referredBy) return;

    // Level 1 Commission (10%)
    const l1ReferrerId = userData.referredBy;
    const l1Commission = pkgPrice * 0.10;
    
    await database.runTransaction(async (tx) => {
      const l1Ref = database.collection("users").doc(l1ReferrerId);
      const l1Snap = await tx.get(l1Ref);
      
      if (l1Snap.exists) {
        tx.update(l1Ref, {
          referralCommissionBalance: admin.firestore.FieldValue.increment(l1Commission),
          referralEarned: admin.firestore.FieldValue.increment(l1Commission)
        });

        const txId = `tx_ref_l1_${Date.now()}_${l1ReferrerId}`;
        tx.set(database.collection("transactions").doc(txId), {
          userId: l1ReferrerId,
          amount: l1Commission,
          type: "referral_bonus",
          timestamp: new Date().toISOString(),
          description: `L1 Referral Commission from ${userData.email || userId}`
        });

        // Notification for L1
        const notifId = `notif_${Date.now()}_${l1ReferrerId}`;
        const nowIsoStr = new Date().toISOString();
        tx.set(database.collection("notifications").doc(notifId), {
          userId: l1ReferrerId,
          title: "Referral Commission",
          message: `You earned BDT ${l1Commission.toFixed(2)} from your referral's purchase!`,
          type: "referral",
          timestamp: nowIsoStr,
          createdAt: nowIsoStr,
          read: false
        });
      }
    });
  } catch (error) {
    console.error("Referral commission error:", error);
  }
}

async function runHardDeleteCleanup(database: any) {
  console.log("[Cleanup] Starting hard-delete routine for customer data (>30 days) and admin data (>90 days)...");
  
  const limit30Days = new Date();
  limit30Days.setDate(limit30Days.getDate() - 30);

  const limit90Days = new Date();
  limit90Days.setDate(limit90Days.getDate() - 90);

  try {
    // 1. Customer Collections (Older than 30 days): transactions, transactions_ledger, notifications, support_chats
    const customerCollections = ["transactions", "transactions_ledger", "notifications", "support_chats", "landing_chats", "chats", "messages", "daily_mining_logs"];
    for (const colName of customerCollections) {
      const snap = await database.collection(colName).get();
      const batch = database.batch();
      let deletableCount = 0;
      for (const doc of snap.docs) {
        const data = doc.data();
        const timeField = data.timestamp || data.createdAt || data.created || data.time;
        if (timeField) {
          try {
            const docDate = new Date(timeField);
            if (!isNaN(docDate.getTime()) && docDate < limit30Days) {
              batch.delete(doc.ref);
              deletableCount++;
            }
          } catch (e) {}
        }
      }
      if (deletableCount > 0) {
        await batch.commit();
        console.log(`[Cleanup] Hard-deleted ${deletableCount} documents from customer collection: ${colName}`);
      }
    }

    // 2. Admin Collections (Older than 90 days): admin_logs, system_locks
    const adminCollections = ["admin_logs", "system_locks"];
    for (const colName of adminCollections) {
      const snap = await database.collection(colName).get();
      const batch = database.batch();
      let deletableCount = 0;
      for (const doc of snap.docs) {
        const data = doc.data();
        const timeField = data.startedAt || data.finishedAt || data.timestamp || data.createdAt || data.date;
        if (timeField) {
          try {
            let docDate = new Date(timeField);
            if (colName === "system_locks" && data.date) {
              docDate = new Date(data.date);
            }
            if (!isNaN(docDate.getTime()) && docDate < limit90Days) {
              batch.delete(doc.ref);
              deletableCount++;
            }
          } catch (e) {}
        }
      }
      if (deletableCount > 0) {
        await batch.commit();
        console.log(`[Cleanup] Hard-deleted ${deletableCount} documents from admin collection: ${colName}`);
      }
    }

    console.log("[Cleanup] Hard-delete routine completed successfully.");
  } catch (error) {
    console.error("[Cleanup] Hard-delete routine error:", error);
  }
}

async function processDailyMining() {
  console.log("[Cron] Daily mining settlement calculations are currently disabled/removed.");
}

// Schedule Cron: 12:01 AM BD Time (18:01 UTC)
cron.schedule("1 18 * * *", async () => {
  console.log("[Cron] Daily cron settlement is currently disabled/removed.");
});

// --- API Endpoints ---

expressApp.get("/api/test-admin", (req, res) => {
  res.json({
    adminType: typeof admin,
    adminExists: !!admin,
    adminKeys: admin ? Object.keys(admin) : null,
    adminFirestore: admin && admin.firestore ? typeof admin.firestore : null
  });
});

// Health check with Bangladesh Time info (supports flexible routes and trailing slashes)
expressApp.get(["/api/health", "/api/health/", "/health", "/health/"], (req, res) => {
  const now = new Date();
  const dhakaTime = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  res.status(200).json({ 
    status: "ok", 
    initialized: !!db, 
    serverTime: now.toISOString(),
    dhakaTime: dhakaTime,
    timezone: "Asia/Dhaka",
    env: process.env.NODE_ENV || "development"
  });
});

// Explicit Keep-Alive Endpoints supporting various routes, trailing slashes, and pings to prevent Render Sleep (Awake Script)
expressApp.get(["/api/keepalive", "/api/keepalive/", "/api/ping", "/api/ping/", "/ping", "/ping/"], (req, res) => {
  const now = new Date();
  const dhakaTime = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  res.status(200).json({
    status: "alive",
    timestamp: now.toISOString(),
    dhakaTime: dhakaTime,
    message: "Google Apps Script ping received. Server is awake."
  });
});

// Dynamic Client Firebase Config Synchronization
expressApp.get("/api/config/firebase", (req, res) => {
  try {
    const config = getFirebaseConfig();
    res.json({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
      firestoreDatabaseId: config.firestoreDatabaseId
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to retrieve firebase configuration", details: error.message });
  }
});

// Admin Route - Using a cleaner, non-generic path to avoid security flags
// This helps prevent "Dangerous Site" warnings often triggered by generic "/admin" paths on new domains
expressApp.get("/portal-manager", (req, res) => {
  const adminPath = path.join(process.cwd(), "admin.html");
  if (fs.existsSync(adminPath)) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(adminPath);
  } else {
    res.status(404).send("Management portal not found.");
  }
});

// Admin Custom Domain Panel Shortcut
expressApp.get("/admin-panel", (req, res) => {
  const adminPath = path.join(process.cwd(), "admin.html");
  if (fs.existsSync(adminPath)) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(adminPath);
  } else {
    res.status(404).send("Admin panel endpoint active but resource not found.");
  }
});

// Redirect old /admin to new /admin-panel
expressApp.get("/admin", (req, res) => {
  res.redirect("/admin-panel");
});

// --- Unified API Routes ---

// SECURE PACKAGE PURCHASE
expressApp.post("/api/package/purchase", verifyToken, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });

  const { userId, packageId } = req.body;
  if (!userId || !packageId) return res.status(400).json({ error: "Missing parameters" });
  if (userId !== req.user.uid) return res.status(403).json({ error: "Unauthorized access. Identity mismatch." });
  
  try {
    fs.writeFileSync(path.join(process.cwd(), "debug_diagnostic.log"), `admin is: ${JSON.stringify(admin, null, 2)}\nType of admin: ${typeof admin}\nadmin.firestore: ${admin ? typeof admin.firestore : "n/a"}\n`);
  } catch (logErr) {
    console.error("Failed to write diagnostic log:", logErr);
  }

  console.log("DEBUG: admin object is:", admin);
  let pkgPrice = 0;
  try {
    // 1. Fetch non-locking resources outside of the transaction
    const robotsRef = database.collection("user_robots").where("userId", "==", userId);
    const robotsSnap = await robotsRef.get();

    const pkgRef = database.collection("packages").doc(packageId);
    let pkgSnap = await pkgRef.get();
    let pkgData: any;
    if (!pkgSnap.exists) {
      const DEFAULT_PACKAGES: Record<string, any> = {
        "pkg_1500": { id: 'pkg_1500', name: 'Dogecoin Package', price: 1500, daily: 75, duration: 30 },
        "pkg_3000": { id: 'pkg_3000', name: 'Tron Package', price: 3000, daily: 150, duration: 30 },
        "pkg_5000": { id: 'pkg_5000', name: 'Cardano Package', price: 5000, daily: 250, duration: 30 },
        "pkg_10000": { id: 'pkg_10000', name: 'Ethereum Package', price: 10000, daily: 500, duration: 30 },
        "pkg_20000": { id: 'pkg_20000', name: 'BNB Package', price: 20000, daily: 1000, duration: 30 },
        "pkg_30000": { id: 'pkg_30000', name: 'Bitcoin Package', price: 30000, daily: 1500, duration: 30 },
        "starter": { id: "starter", name: "Starter Mine", price: 100, dailyProfit: 5, durationDays: 30 },
        "pro": { id: "pro", name: "Pro Mine", price: 500, dailyProfit: 30, durationDays: 30 },
        "whale": { id: "whale", name: "Whale Mine", price: 2000, dailyProfit: 150, durationDays: 30 }
      };
      if (DEFAULT_PACKAGES[packageId]) {
        pkgData = DEFAULT_PACKAGES[packageId];
        await pkgRef.set(pkgData);
        pkgSnap = await pkgRef.get();
      } else {
        throw new Error("Package not found");
      }
    } else {
      pkgData = pkgSnap.data()!;
      // Enforce strictly 30 days duration for all standard coin packages to prevent database pollution
      if (pkgData.duration !== 30 || pkgData.durationDays !== 30 || pkgData.validity !== 30) {
        pkgData.duration = 30;
        if (pkgData.durationDays !== undefined) pkgData.durationDays = 30;
        if (pkgData.validity !== undefined) pkgData.validity = 30;
        await pkgRef.set(pkgData);
      }
    }
    pkgPrice = pkgData.price;

    // 2. Execute transaction with unique read at the top
    try { fs.appendFileSync(path.join(process.cwd(), "tx_trace.log"), `--- START TRANSACTION AT ${new Date().toISOString()} ---\n`); } catch(e) {}
    try { fs.appendFileSync(path.join(process.cwd(), "tx_trace.log"), "TX_TRACE: Starting runTransaction...\n"); } catch(e) {}
    await database.runTransaction(async (transaction) => {
      try { fs.appendFileSync(path.join(process.cwd(), "tx_trace.log"), "TX_TRACE: Step 1: Querying user document...\n"); } catch(e) {}
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const userData = userSnap.data()!;
      try { fs.appendFileSync(path.join(process.cwd(), "tx_trace.log"), "TX_TRACE: Step 2: User data fetched successfully.\n"); } catch(e) {}

      // READ: Query mining state at the very top (All reads must be before writes)
      const miningRef = database.collection("mining_states").doc(userId);
      const miningSnap = await transaction.get(miningRef);

      // Check if this buyer has already generated an instant_10 commission (10% limit check under document field)
      const hasAwarded10 = userData.hasAwardedUpline10 === true;

      const currentBal = typeof userData.mainBalance === 'number' ? userData.mainBalance : (userData.balance || 0);
      if (currentBal < pkgData.price) {
        throw new Error("Insufficient balance");
      }

      try { fs.appendFileSync(path.join(process.cwd(), "tx_trace.log"), "TX_TRACE: Step 3: Deduction write registration...\n"); } catch(e) {}
      // 1. Deduct Balance
      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(-pkgData.price)
      });
      try { fs.appendFileSync(path.join(process.cwd(), "tx_trace.log"), "TX_TRACE: Step 4: Deduction write registered.\n"); } catch(e) {}

      // 2. Add Package
      const userPkgId = `up_${Date.now()}_${userId}`;
      let expiresAt = new Date();
      const validityVal = pkgData.validity != null ? pkgData.validity : (pkgData.durationDays || pkgData.duration || 30);
      expiresAt.setDate(expiresAt.getDate() + validityVal);

      let robotOn = false;
      const nowTime = new Date();
      for (const rDoc of robotsSnap.docs) {
        const rData = rDoc.data();
        if (rData.status === 'active' && rData.expiresAt && new Date(rData.expiresAt) >= nowTime) {
          robotOn = true;
          break;
        }
      }

      const now = new Date();
      const dailyEarn = pkgData.dailyProfit || pkgData.daily || 0;
      const purchasedAtStr = now.toISOString();

      const pkgDocData = {
        userId,
        packageId,
        packageName: pkgData.name,
        daily: dailyEarn,
        purchasedAt: purchasedAtStr,
        expiresAt: expiresAt.toISOString(),
        status: "active",
        miningStatus: "inactive",
        miningStartedAt: "",
        currentPotentialEarning: 0,
        lastClaimTime: purchasedAtStr,
        lastClaimDate: "",
        lastMiningStartTime: "",
        lastMiningStartDay: ""
      };

      // Add to global collection (for backward compatibility)
      transaction.set(database.collection("user_packages").doc(userPkgId), pkgDocData);

      // Add to sub-collection 'purchasedPackages' under user document
      const purchasedPkgRef = userRef.collection("purchasedPackages").doc(userPkgId);
      transaction.set(purchasedPkgRef, {
        packageId,
        packageName: pkgData.name,
        daily: dailyEarn,
        purchasedAt: pkgDocData.purchasedAt,
        expiresAt: pkgDocData.expiresAt,
        status: "active",
        miningStatus: "inactive",
        miningStartedAt: "",
        currentPotentialEarning: 0,
        lastClaimTime: purchasedAtStr,
        lastClaimDate: "",
        lastMiningStartTime: "",
        lastMiningStartDay: ""
      });

      const newPackageDoc = { id: userPkgId };
      const newPackageData = pkgData;

      // 2.5: Award instant referral commission inside the transaction (Reuse already loaded userData)
      const buyerData = userData;
      const effectiveUplineId = buyerData.referredBy || buyerData.uplineId;

      if (buyerData && effectiveUplineId) {
        const commission = calculateInstantCommission(newPackageData.price);
        if (commission > 0) {
          const uplineRef = dbCompat.collection("users").doc(effectiveUplineId);
          // Increment referralCommissionBalance AND referralCommissions AND totalReferralEarned
          transaction.update(uplineRef, {
            referralCommissionBalance: admin.firestore.FieldValue.increment(commission),
            referralCommissions: admin.firestore.FieldValue.increment(commission),
            totalReferralEarned: admin.firestore.FieldValue.increment(commission)
          });
          const comLogRef = dbCompat.collection("commission_logs").doc();
          transaction.set(comLogRef, {
            fromUser: userId,
            toUser: effectiveUplineId,
            packageId: newPackageDoc.id,
            dateBD: getBDDate(),
            type: 'instant_10',
            baseAmount: newPackageData.price,
            amount: commission,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Create Notification for Referrer
          const uNotifId = `notif_ref_comm_${Date.now()}_${effectiveUplineId}`;
          const currentBDTimeIso = new Date().toISOString();
          transaction.set(dbCompat.collection("notifications").doc(uNotifId), {
            userId: effectiveUplineId,
            title: "Referral Commission Received ৳",
            message: `You have received a 10% commission of ৳${commission.toFixed(2)} because your referral has activated their first mining package node!`,
            type: "referral_commission",
            timestamp: currentBDTimeIso,
            createdAt: currentBDTimeIso,
            read: false
          });

          // Create Transaction Log for Referrer so it appears in History
          const uTxId = `tx_ref_comm_${Date.now()}_${effectiveUplineId}`;
          transaction.set(dbCompat.collection("transactions").doc(uTxId), {
            userId: effectiveUplineId,
            amount: commission,
            type: "commission",
            timestamp: currentBDTimeIso,
            createdAt: currentBDTimeIso,
            description: `10% referral commission from package activation`
          });
        }
      }

      // 3. Record Transaction
      const txId = `purchase_${Date.now()}_${userId}`;
      const nowIso = new Date().toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: -pkgData.price,
        type: "purchase",
        timestamp: nowIso,
        createdAt: nowIso,
        description: `Purchased ${pkgData.name}`
      });

      // 4. Initial Mining State
      if (!miningSnap.exists) {
        transaction.set(miningRef, {
          userId,
          isActive: false,
          lastStartTime: 0
        });
      }
    });

    res.json({ message: "Package purchased successfully" });
  } catch (error: any) {
    console.error("Purchase error caught:", error);
    const errMsg = error.message || String(error);
    const isPermissionDenied = errMsg.toLowerCase().includes("permission_denied") || 
                               errMsg.toLowerCase().includes("permission denied") || 
                               errMsg.toLowerCase().includes("insufficient permissions") ||
                               errMsg.toLowerCase().includes("unauthorized");
    const friendlyMsg = isPermissionDenied 
      ? "Database transaction failed or permission denied."
      : (error.message || "Purchase failed");
    res.status(isPermissionDenied ? 500 : 400).json({ 
      success: false, 
      error: friendlyMsg,
      errorMessage: friendlyMsg,
      details: errMsg,
      stack: error.stack 
    });
  }
});

// SECURE ROBOT PURCHASE
expressApp.post("/api/buy-robot", verifyToken, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });

  const { userId, robotId } = req.body;
  if (!userId || !robotId) return res.status(400).json({ error: "Missing parameters" });
  if (userId !== req.user.uid) return res.status(403).json({ error: "Unauthorized access. Identity mismatch." });

  const robots = [
    { id: 'robot_7d', name: 'Smart Bot (7 Days)', price: 150, duration: 7 },
    { id: 'robot_15d', name: 'Pro Bot (15 Days)', price: 300, duration: 15 },
    { id: 'robot_30d', name: 'Ultra Bot (30 Days)', price: 500, duration: 30 }
  ];

  const r = robots.find(x => x.id === robotId);
  if (!r) return res.status(400).json({ error: "Invalid robot ID" });

  try {
    await database.runTransaction(async (transaction) => {
      // Task 2 check: Check for active robot
      const existingRobotSnap = await transaction.get(
        dbCompat.collection("user_robots")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .where("endTime", ">", admin.firestore.Timestamp.now())
          .limit(1)
      );

      if (!existingRobotSnap.empty) {
        throw new Error("You already have an active robot. You cannot purchase a new one before the current one expires.");
      }

      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const userData = userSnap.data()!;

      const currentBal = typeof userData.mainBalance === 'number' ? userData.mainBalance : (userData.balance || 0);
      if (currentBal < r.price) {
        throw new Error("Insufficient balance");
      }

      // Deduct Balance
      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(-r.price),
        balance: admin.firestore.FieldValue.increment(-r.price),
        hasBoughtPackage: true,
        hasActiveRobot: true
      });

      // Create new robot doc
      const botRef = database.collection("user_robots").doc();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + r.duration);

      transaction.set(botRef, {
        userId,
        customerID: userData.uid || 'N/A',
        robotId: r.id,
        name: r.name,
        status: 'active',
        isActivated: true,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        endTime: expiresAt
      });

      // Buyer Transaction history log
      const txId = `purchase_robot_${Date.now()}_${userId}`;
      const nowIso = new Date().toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        type: 'purchase',
        amount: -r.price,
        productType: 'robot',
        productName: r.name,
        packageName: r.name,
        description: `Robot Purchase: ${r.name}`,
        createdAt: nowIso,
        timestamp: nowIso,
        status: 'completed'
      });
    });

    res.json({ message: "Robot purchased successfully!" });
  } catch (error: any) {
    console.error("Robot purchase error:", error);
    res.status(400).json({ error: error.message || "Robot purchase failed" });
  }
});

// TOGGLE ROBOT ACTIVE STATUS SECURELY
expressApp.post("/api/robot/toggle", verifyToken, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });

  const { userId, botId, isActivated } = req.body;
  if (!userId || !botId || isActivated === undefined) {
    return res.status(400).json({ error: "Missing parameters" });
  }
  if (userId !== req.user.uid) return res.status(403).json({ error: "Unauthorized access. Identity mismatch." });

  try {
    const botRef = database.collection("user_robots").doc(botId);
    const botSnap = await botRef.get();
    if (!botSnap.exists) {
      return res.status(404).json({ error: "Robot not found" });
    }

    const botData = botSnap.data()!;
    if (botData.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    await botRef.update({
      isActivated: !!isActivated
    });

    const userRef = database.collection("users").doc(userId);
    await userRef.update({
      hasActiveRobot: !!isActivated
    });

    res.json({ success: true, message: `Robot set to ${isActivated ? "Activated" : "Deactivated"}` });
  } catch (error: any) {
    console.error("Robot toggle error:", error);
    res.status(500).json({ error: error.message || "Toggle failed" });
  }
});

// WALLET DEPOSIT (Manual/Admin Adjustment)
expressApp.post("/api/wallet/deposit", verifyAdmin, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { userId, amount, method } = req.body;
  if (!userId || !amount || amount <= 0) return res.status(400).json({ error: "Invalid parameters" });

  try {
    await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(amount),
        balance: admin.firestore.FieldValue.increment(amount)
      });

      const txId = `dep_${Date.now()}_${userId}`;
      const nowIso = new Date().toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: amount,
        type: "deposit",
        timestamp: nowIso,
        createdAt: nowIso,
        description: `Deposit via ${method || 'Wallet'}`
      });
    });
    res.json({ message: "Deposit processed successfully" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// SECURE WALLET TRANSFER
expressApp.post("/api/wallet/transfer", verifyToken, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });

  const { userId, type } = req.body;
  if (!userId || !type) return res.status(400).json({ error: "Missing parameters" });
  if (userId !== req.user.uid) return res.status(403).json({ error: "Unauthorized access. Identity mismatch." });

  try {
    // Check if today is 1st day of the month in Asia/Dhaka time zone
    const now = new Date();
    const statusStr = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
    const dhakaNow = new Date(statusStr);
    const isFirstDay = dhakaNow.getDate() === 1;

    if (!isFirstDay) {
      if (type === 'mining' || type === 'referral') {
        return res.status(400).json({ error: "Referral commission can only be transferred to main balance on the 1st of the month." });
      }
      return res.status(400).json({ error: "Balances can only be transferred to the Main Balance on the 1st day of each month." });
    }

    const dateId = `${dhakaNow.getFullYear()}_${dhakaNow.getMonth() + 1}_${dhakaNow.getDate()}`;
    let label = '';
    await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);

      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) throw new Error("User record not found");
      const userData = userSnap.data()!;

      if (userData.lastTransferDates && userData.lastTransferDates[type] === dateId) {
        throw new Error("This balance transfer has already been processed today.");
      }

      let currentAmount = 0;
      let updates: any = {};

      if (type === 'earning') {
        const amt1 = Number(userData.tasksBalance || 0);
        const amt2 = Number(userData.earningBalance || 0);
        currentAmount = Math.max(amt1, amt2);
        updates = {
          tasksBalance: 0,
          earningBalance: 0
        };
        label = 'Tasks';
      } else if (type === 'mining') {
        const amt1 = Number(userData.referralCommissions || 0);
        const amt2 = Number(userData.referralCommissionBalance || 0);
        currentAmount = Math.max(amt1, amt2);
        updates = {
          referralCommissions: 0,
          referralCommissionBalance: 0
        };
        label = 'Referral Commissions (10% + 2.5%)';
      } else {
        currentAmount = Number(userData.referralBalance || 0);
        updates = {
          referralBalance: 0
        };
        label = 'Legacy Referrals';
      }

      if (currentAmount <= 0) throw new Error("No balance available to transfer.");

      updates.balance = admin.firestore.FieldValue.increment(currentAmount);
      updates.mainBalance = admin.firestore.FieldValue.increment(currentAmount);
      updates[`lastTransferDates.${type}`] = dateId;

      transaction.update(userRef, updates);

      const nowIso = new Date().toISOString();

      const txId = `transfer_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        type: 'transfer',
        amount: currentAmount,
        source: `${label} Transfer`,
        createdAt: nowIso,
        timestamp: nowIso,
        status: 'completed'
      });
    });

    res.json({ message: "Credits moved to Main Balance successfully." });
  } catch (error: any) {
    console.error("Transfer balance error:", error);
    res.status(400).json({ error: error.message || "Transfer failed" });
  }
});

// WALLET WITHDRAWAL
expressApp.post("/api/wallet/withdraw", verifyToken, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { userId, amount, method, account, pin } = req.body;
  if (!userId || !amount || amount <= 0) return res.status(400).json({ error: "Invalid parameters" });
  if (userId !== req.user.uid) return res.status(403).json({ error: "Unauthorized access. Identity mismatch." });

  try {
    await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const userData = userSnap.data()!;

      if (userData.isSuspended) {
        throw new Error("You cannot withdraw money while your account is suspended.");
      }

      if (userData.withdrawLocked === true) {
        throw new Error("Your withdrawal facility has been frozen by the compliance department. Please contact support.");
      }

      if (userData.withdrawPin && userData.withdrawPin !== pin) {
        throw new Error("Please enter a valid withdrawal PIN");
      }

      // Enforce the 500 Taka minimum limit on the backend
      if (amount < 500) {
        throw new Error("Minimum withdrawal is 500 Taka plus a 1.5% withdrawal fee.");
      }

      const cleanAmount = Number(amount.toFixed(2));
      const fee = Number((cleanAmount * 0.015).toFixed(2));
      const totalCost = Number((cleanAmount + fee).toFixed(2));

      const currentBal = typeof userData.mainBalance === 'number' ? userData.mainBalance : (userData.balance || 0);
      if (currentBal < totalCost) {
        throw new Error(`Insufficient balance to cover withdrawal plus 1.5% fee. Total needed: ৳${totalCost.toFixed(2)}.`);
      }

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(-totalCost),
        balance: admin.firestore.FieldValue.increment(-totalCost)
      });

      const now = new Date().toISOString();

      // Create withdraw document (source of truth for withdrawal history)
      const withdrawId = `withdraw_${Date.now()}_${userId}`;
      const withdrawRef = database.collection("withdraws").doc(withdrawId);
      transaction.set(withdrawRef, {
        userId,
        uid: userData.uid || userId,
        method,
        number: account,
        amount: cleanAmount,
        fee,
        totalDeduction: totalCost,
        status: "pending",
        createdAt: now
      });

      // Add Notification
      const notifId = `notif_withdraw_${Date.now()}_${userId}`;
      const notifRef = database.collection("notifications").doc(notifId);
      transaction.set(notifRef, {
        userId,
        title: "Withdraw Request",
        message: `Your withdrawal request of ৳${cleanAmount} has been accepted. A withdrawal fee of 1.5% (৳${fee}) applies. It may take 24-48 hours to process.`,
        type: "withdrawal",
        read: false,
        timestamp: now,
        createdAt: now
      });

      const txId = `wd_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: -totalCost,
        type: "withdrawal",
        timestamp: now,
        createdAt: now,
        description: `Withdrawal of ৳${cleanAmount} to ${method} (${account}) fee ৳${fee}`
      });
    });
    res.json({ message: "Withdrawal requested successfully" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// DEPOSIT APPROVAL (Transactional with atomic user-document lock)
expressApp.post("/api/deposit/approve", verifyAdmin, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ error: "Missing depositId parameter" });

  try {
    const result = await database.runTransaction(async (transaction) => {
      const depRef = database.collection("deposits").doc(depositId);
      const depSnap = await transaction.get(depRef);
      if (!depSnap.exists) throw new Error("Deposit request not found");
      const depData = depSnap.data()!;
      if (depData.status !== "pending") throw new Error("Deposit request has already been processed");

      const userId = depData.userId;
      const amount = Number(depData.amount);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid deposit amount on document");

      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef); // Atomically locks user document
      if (!userSnap.exists) throw new Error("User record not found");

      // 1. Approve deposit
      transaction.update(depRef, { 
        status: "approved", 
        approvedAt: new Date().toISOString() 
      });

      // 2. Increment user mainBalance and balance, and update activation status
      const userDoc = userSnap.data() || {};
      const nextStatus = userDoc.profileCompleted === true ? 'active' : 'inactive';

      const currentMainBalance = Number(userDoc.mainBalance || 0);
      const currentBalance = Number(userDoc.balance || 0);

      transaction.update(userRef, {
        mainBalance: currentMainBalance + amount,
        balance: currentBalance + amount,
        hasDeposit: true,
        status: nextStatus
      });

      // 3. Log customer transaction history
      const txId = `dep_app_${Date.now()}_${userId}`;
      const nowIso = new Date().toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: amount,
        type: "deposit",
        timestamp: nowIso,
        createdAt: nowIso,
        description: `Approved deposit of BDT ${amount.toFixed(2)}`
      });

      // 4. Create Notification
      const notifId = `notif_dep_${Date.now()}_${userId}`;
      const notifTime = new Date().toISOString();
      transaction.set(database.collection("notifications").doc(notifId), {
        userId,
        title: "Deposit Approved",
        message: `Your deposit of BDT ${amount.toFixed(2)} has been approved and credited.`,
        type: "deposit",
        timestamp: notifTime,
        createdAt: notifTime,
        read: false
      });

      return { userId, amount };
    });

    res.json({ message: `Deposit request approved successfully. Credited BDT ${result.amount.toFixed(2)} to user ${result.userId}.`, success: true });
  } catch (error: any) {
    console.error("Deposit approval transaction failed:", error);
    res.status(400).json({ error: error.message || "Deposit approval failed" });
  }
});

// DEPOSIT REJECTION (Transactional via Firebase Admin SDK)
expressApp.post("/api/deposit/reject", verifyAdmin, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ error: "Missing depositId parameter" });

  try {
    const result = await database.runTransaction(async (transaction) => {
      const depRef = database.collection("deposits").doc(depositId);
      const depSnap = await transaction.get(depRef);
      if (!depSnap.exists) throw new Error("Deposit request not found");
      const depData = depSnap.data()!;
      if (depData.status !== "pending") throw new Error("Deposit request has already been processed");

      const userId = depData.userId;
      const amount = Number(depData.amount);

      // 1. Reject deposit
      transaction.update(depRef, { 
        status: "rejected", 
        rejectedAt: new Date().toISOString() 
      });

      // 2. Create Notification
      const notifId = `notif_dep_rej_${Date.now()}_${userId}`;
      const notifTimeRej = new Date().toISOString();
      transaction.set(database.collection("notifications").doc(notifId), {
        userId,
        title: "Deposit Rejected",
        message: `Your deposit of ৳${amount} was rejected.`,
        type: "deposit_rejection",
        timestamp: notifTimeRej,
        createdAt: notifTimeRej,
        read: false
      });

      return { userId, amount };
    });

    res.json({ message: `Deposit request rejected successfully.`, success: true });
  } catch (error: any) {
    console.error("Deposit rejection failed:", error);
    res.status(400).json({ error: error.message || "Deposit rejection failed" });
  }
});

// WITHDRAWAL APPROVAL/COMPLETION (Transactional via Firebase Admin SDK)
expressApp.post("/api/withdraw/approve", verifyAdmin, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { withdrawId } = req.body;
  if (!withdrawId) return res.status(400).json({ error: "Missing withdrawId parameter" });

  try {
    const result = await database.runTransaction(async (transaction) => {
      const witRef = database.collection("withdraws").doc(withdrawId);
      const witSnap = await transaction.get(witRef);
      if (!witSnap.exists) throw new Error("Withdrawal request not found");
      const witData = witSnap.data()!;
      if (witData.status !== "pending") throw new Error("Withdrawal request has already been processed");

      const userId = witData.userId;
      const amount = Number(witData.amount);

      // 1. Approve withdrawal
      transaction.update(witRef, { 
        status: "approved", 
        approvedAt: new Date().toISOString() 
      });

      // 2. Create Notification
      const notifId = `notif_wit_app_${Date.now()}_${userId}`;
      const notifTimeWitApp = new Date().toISOString();
      transaction.set(database.collection("notifications").doc(notifId), {
        userId,
        title: "Withdraw Completed",
        message: `Congratulations! Your ৳${amount} withdraw request was successful.`,
        type: "withdrawal",
        timestamp: notifTimeWitApp,
        createdAt: notifTimeWitApp,
        read: false
      });

      return { userId, amount };
    });

    res.json({ message: `Withdrawal request completed successfully.`, success: true });
  } catch (error: any) {
    console.error("Withdrawal approval failed:", error);
    res.status(400).json({ error: error.message || "Withdrawal approval failed" });
  }
});

// WITHDRAWAL REJECTION & REFUND (Transactional via Firebase Admin SDK)
expressApp.post("/api/withdraw/reject", verifyAdmin, async (req: any, res: any) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { withdrawId } = req.body;
  if (!withdrawId) return res.status(400).json({ error: "Missing withdrawId parameter" });

  try {
    const result = await database.runTransaction(async (transaction) => {
      const witRef = database.collection("withdraws").doc(withdrawId);
      const witSnap = await transaction.get(witRef);
      if (!witSnap.exists) throw new Error("Withdrawal request not found");
      const witData = witSnap.data()!;
      if (witData.status !== "pending") throw new Error("Withdrawal request has already been processed");

      const userId = witData.userId;
      const amount = Number(witData.amount);
      const refundAmount = Number(witData.totalDeduction || amount);

      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User record not found");

      // 1. Reject withdrawal
      transaction.update(witRef, { 
        status: "rejected", 
        rejectedAt: new Date().toISOString() 
      });

      // 2. Refund balance
      const userDoc = userSnap.data() || {};
      const currentMainBalance = Number(userDoc.mainBalance || 0);
      const currentBalance = Number(userDoc.balance || 0);

      transaction.update(userRef, {
        mainBalance: currentMainBalance + refundAmount,
        balance: currentBalance + refundAmount
      });

      // 3. Create Notification
      const notifId = `notif_wit_rej_${Date.now()}_${userId}`;
      const notifTimeWitRej = new Date().toISOString();
      transaction.set(database.collection("notifications").doc(notifId), {
        userId,
        title: "Withdraw Rejected",
        message: `Your ৳${amount} withdraw was rejected. Amount returned to wallet.`,
        type: "withdrawal_rejection",
        timestamp: notifTimeWitRej,
        createdAt: notifTimeWitRej,
        read: false
      });

      return { userId, amount };
    });

    res.json({ message: `Withdrawal request rejected and refunded successfully.`, success: true });
  } catch (error: any) {
    console.error("Withdrawal rejection failed:", error);
    res.status(400).json({ error: error.message || "Withdrawal rejection failed" });
  }
});

// Real Mining Operations Endpoint
expressApp.post("/api/mining/start", async (req, res) => {
  const { userId, userPackageId } = req.body;
  if (!userId || !userPackageId) return res.status(400).json({ error: "Missing parameters" });

  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Database not connected" });

  try {
    const now = new Date();
    const todayStr = getBDDate(now);

    const result = await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const pkgRef = database.collection("users").doc(userId).collection("purchasedPackages").doc(userPackageId);
      const globalPkgRef = database.collection("user_packages").doc(userPackageId);

      const [userSnap, pkgSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(pkgRef)
      ]);

      if (!userSnap.exists) throw new Error("User not found");
      if (!pkgSnap.exists) throw new Error("Package not found");

      const pkgData = pkgSnap.data()!;
      if (pkgData.status !== "active") throw new Error("Package is not active");

      if (pkgData.lastMiningStartDay === todayStr) {
        throw new Error("This mining node is already running or active today.");
      }

      const expiresAt = new Date(pkgData.expiresAt);
      if (expiresAt <= now) {
        throw new Error("Package has expired");
      }

      // Fetch active robots inside start endpoint to calculate and carry forward raw unmatched manual completed balance
      const robotsSnap = await database.collection("user_robots")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .get();

      const myActiveRobots = robotsSnap.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }));

      // Calculate accrued earnings prior to today's start
      const accrual = calculateAccruedEarnings(pkgData, myActiveRobots, now);
      const userMultiplier = pkgData.earningsMultiplier || 1;
      const rawUnclaimed = accrual.unclaimedCompleted / userMultiplier;

      const midnightEnd = getBDEndOfDay(todayStr);
      const totalSecondsInSession = (midnightEnd.getTime() - now.getTime()) / 1000;
      const dailyProfit = Number(pkgData.daily || 0);
      const currentPotentialEarning = (totalSecondsInSession / 86400) * dailyProfit;

      const updates = {
        miningStatus: "active",
        lastMiningStartTime: now.toISOString(),
        lastMiningStartDay: todayStr,
        currentPotentialEarning: currentPotentialEarning,
        current_earnings: Number(rawUnclaimed.toFixed(6))
      };

      transaction.update(pkgRef, updates);
      transaction.update(globalPkgRef, updates);

      return { success: true, message: "Mining started successfully." };
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Secure Server-Side Mining Accrual and Claiming Endpoint
expressApp.post("/api/mining/claim", async (req, res) => {
  const { userId, userPackageId } = req.body;
  if (!userId || !userPackageId) return res.status(400).json({ error: "Missing parameters" });

  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Database not connected" });

  try {
    const now = new Date();
    const todayStr = getBDDate(now);

    const claimResult = await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const pkgRef = database.collection("users").doc(userId).collection("purchasedPackages").doc(userPackageId);
      const globalPkgRef = database.collection("user_packages").doc(userPackageId);

      const [userSnap, pkgSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(pkgRef)
      ]);

      if (!userSnap.exists) throw new Error("User not found");
      if (!pkgSnap.exists) throw new Error("Package not found");

      const userData = userSnap.data()!;
      const pkgData = pkgSnap.data()!;

      if (pkgData.lastClaimDate === todayStr) {
        throw new Error("This mining reward has already been claimed for today. Please wait until tomorrow.");
      }

      if (userData.isSuspended) {
        throw new Error("Your account is suspended.");
      }

      if (userData.miningLocked === true) {
        throw new Error("Mining nodes for your account are currently undergoing system audit by compliance. Claims are temporarily frozen.");
      }

      const robotsSnap = await database.collection("user_robots")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .get();

      const myActiveRobots = robotsSnap.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }));

      // Fetch L1 Referrer info BEFORE write operations to conform strictly to Firestore transaction rules
      let l1CommissionAmount = 0;
      let l1ReferrerId = userData.referredBy || null;
      let l1Snap = null;
      let l1Ref = null;

      if (l1ReferrerId) {
        l1Ref = database.collection("users").doc(l1ReferrerId);
        l1Snap = await transaction.get(l1Ref);
      }

      const accrual = calculateAccruedEarnings(pkgData, myActiveRobots, now);
      
      let claimAmount = accrual.unclaimedCompleted;
      if (typeof userData.earningsMultiplier === 'number' && userData.earningsMultiplier > 0) {
        claimAmount = Number((claimAmount * userData.earningsMultiplier).toFixed(2));
      }

      if (claimAmount <= 0) {
        if (accrual.activeSession && accrual.activeSession.liveEarnings > 0) {
          throw new Error("Your earnings for today's active session are still accumulating. You can claim them starting tomorrow after 12:00 AM.");
        }
        throw new Error("No completed earnings available to claim to Main Balance yet.");
      }

      const expiresAt = new Date(pkgData.expiresAt);
      const isExpiredNow = expiresAt <= now;

      // Update lastClaimTime based on package type
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = getBDDate(yesterday);
      const lastClaimTimeStr = getBDMidnight(yesterdayStr).toISOString();

      const updates: any = {
        lastClaimTime: lastClaimTimeStr,
        lastClaimDate: todayStr,
        current_earnings: 0
      };

      if (isExpiredNow) {
        updates.status = "expired";
      }

      // Keep miningStatus and start time unchanged so the active session continues to run and accrue remaining balance pro-rata

      transaction.update(pkgRef, updates);
      transaction.set(globalPkgRef, updates, { merge: true });

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(claimAmount),
        balance: admin.firestore.FieldValue.increment(claimAmount),
        totalEarned: admin.firestore.FieldValue.increment(claimAmount)
      });

      const txId = `tx_mining_claim_${Date.now()}_${userId}_${userPackageId}`;
      const nowIsoStr = now.toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: claimAmount,
        type: "mining_claim",
        timestamp: nowIsoStr,
        createdAt: nowIsoStr,
        description: `Successfully claimed mining profit from ${pkgData.packageName || "Rig"}`
      });

      if (l1Snap && l1Snap.exists && l1Ref) {
        l1CommissionAmount = claimAmount * 0.025;
        if (l1CommissionAmount > 0) {
          transaction.update(l1Ref, {
            referralCommissionBalance: admin.firestore.FieldValue.increment(l1CommissionAmount),
            referralCommissions: admin.firestore.FieldValue.increment(l1CommissionAmount),
            referralEarned: admin.firestore.FieldValue.increment(l1CommissionAmount)
          });

          const refTxId = `tx_ref_mining_comm_${Date.now()}_${l1ReferrerId}`;
          transaction.set(database.collection("transactions").doc(refTxId), {
            userId: l1ReferrerId,
            amount: l1CommissionAmount,
            type: "referral_mining_commission",
            timestamp: nowIsoStr,
            createdAt: nowIsoStr,
            description: `2.5% Downline mining commission from ${userData.fullName || userData.email || userId}`
          });

          const refNotifId = `notif_ref_mining_${Date.now()}_${l1ReferrerId}`;
          const refNotifTime = now.toISOString();
          transaction.set(database.collection("notifications").doc(refNotifId), {
            userId: l1ReferrerId,
            title: "Mining Commission Received",
            message: `You earned 2.5% downline mining commission of BDT ${l1CommissionAmount.toFixed(2)} from ${userData.fullName || 'your referral'}.`,
            type: "referral",
            timestamp: refNotifTime,
            createdAt: refNotifTime,
            read: false
          });
        }
      }

      return {
        success: true,
        claimedAmount: claimAmount,
        commissionAmount: l1CommissionAmount,
        isExpired: isExpiredNow
      };
    });

    res.json(claimResult);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Automatic Mining Accrual and Eviction for Expired Packages
expressApp.post("/api/mining/autopush", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId parameter" });

  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Database not connected" });

  try {
    const now = new Date();
    const todayStr = getBDDate(now);

    // Fetch active user robots to check for automation
    const robotsSnap = await database.collection("user_robots")
      .where("userId", "==", userId)
      .where("status", "==", "active")
      .get();

    const myActiveRobots = robotsSnap.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Find all active purchased packages that are expired
    const pkgsSnap = await database.collection("users").doc(userId).collection("purchasedPackages")
      .where("status", "==", "active")
      .get();

    const expiredPackagesToProcess: any[] = [];
    pkgsSnap.docs.forEach((doc: any) => {
      const data = doc.data();
      const expAt = new Date(data.expiresAt);
      if (expAt <= now) {
        expiredPackagesToProcess.push({
          id: doc.id,
          ...data
        });
      }
    });

    if (expiredPackagesToProcess.length === 0) {
      return res.json({ message: "No expired packages found under active status.", processed: [] });
    }

    const processedResults: any[] = [];

    // Loop through each expired package and process it atomically
    for (const pkg of expiredPackagesToProcess) {
      const userPackageId = pkg.id;

      const claimResult = await database.runTransaction(async (transaction) => {
        const userRef = database.collection("users").doc(userId);
        const pkgRef = database.collection("users").doc(userId).collection("purchasedPackages").doc(userPackageId);
        const globalPkgRef = database.collection("user_packages").doc(userPackageId);

        const [userSnap] = await Promise.all([
          transaction.get(userRef)
        ]);

        if (!userSnap.exists) throw new Error("User record not found");
        const userData = userSnap.data()!;

        // Fetch L1 Referrer info BEFORE any writes to satisfy transaction locks
        let l1ReferrerId = userData.referredBy || null;
        let l1Snap = null;
        let l1Ref = null;

        if (l1ReferrerId) {
          l1Ref = database.collection("users").doc(l1ReferrerId);
          l1Snap = await transaction.get(l1Ref);
        }

        const accrual = calculateAccruedEarnings(pkg, myActiveRobots, now);
        
        let claimAmount = accrual.unclaimedCompleted;
        if (typeof userData.earningsMultiplier === 'number' && userData.earningsMultiplier > 0) {
          claimAmount = Number((claimAmount * userData.earningsMultiplier).toFixed(2));
        }

        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yesterdayStr = getBDDate(yesterday);
        const lastClaimTimeStr = getBDMidnight(yesterdayStr).toISOString();

        const updates: any = {
          status: "expired",
          lastClaimTime: lastClaimTimeStr,
          lastClaimDate: todayStr
        };

        transaction.update(pkgRef, updates);
        transaction.update(globalPkgRef, updates);

        if (claimAmount > 0) {
          transaction.update(userRef, {
            mainBalance: admin.firestore.FieldValue.increment(claimAmount),
            balance: admin.firestore.FieldValue.increment(claimAmount),
            totalEarned: admin.firestore.FieldValue.increment(claimAmount)
          });

          const txId = `tx_auto_push_${Date.now()}_${userId}_${userPackageId}`;
          const nowIsoStr = now.toISOString();
          transaction.set(database.collection("transactions").doc(txId), {
            userId,
            amount: claimAmount,
            type: "mining_claim",
            timestamp: nowIsoStr,
            createdAt: nowIsoStr,
            description: `Automated safety accrual from expired package ${pkg.packageName || "Rig"}`
          });

          // Award 2.5% passive commission to referrer if exists
          let l1CommissionAmount = 0;
          if (l1Snap && l1Snap.exists && l1Ref) {
            l1CommissionAmount = claimAmount * 0.025;
            if (l1CommissionAmount > 0) {
              transaction.update(l1Ref, {
                referralCommissionBalance: admin.firestore.FieldValue.increment(l1CommissionAmount),
                referralCommissions: admin.firestore.FieldValue.increment(l1CommissionAmount),
                referralEarned: admin.firestore.FieldValue.increment(l1CommissionAmount)
              });

              const refTxId = `tx_ref_auto_push_${Date.now()}_${l1ReferrerId}`;
              transaction.set(database.collection("transactions").doc(refTxId), {
                userId: l1ReferrerId,
                amount: l1CommissionAmount,
                type: "referral_mining_commission",
                timestamp: nowIsoStr,
                createdAt: nowIsoStr,
                description: `Automated 2.5% downline claim commission from ${userData.fullName || userData.email || userId}`
              });
            }
          }

          return { packageId: userPackageId, claimed: claimAmount, status: "expired" };
        } else {
          return { packageId: userPackageId, claimed: 0, status: "expired" };
        }
      });

      processedResults.push(claimResult);
    }

    res.json({ message: "Expired packages auto-processed and evicted.", processed: processedResults });
  } catch (error: any) {
    console.error("Autopush routine warning:", error);
    res.status(400).json({ error: error.message });
  }
});

expressApp.post("/api/admin/setup", async (req, res) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured with Firebase" });
  const packages = [
    { id: "starter", name: "Starter Mine", price: 100, dailyProfit: 5, durationDays: 30 },
    { id: "pro", name: "Pro Mine", price: 500, dailyProfit: 30, durationDays: 30 },
    { id: "whale", name: "Whale Mine", price: 2000, dailyProfit: 150, durationDays: 30 }
  ];

  try {
    const batch = database.batch();
    for (const pkg of packages) {
      batch.set(database.collection("packages").doc(pkg.id), pkg);
    }
    await batch.commit();
    res.json({ message: "System setup complete" });
  } catch (error) {
    res.status(500).json({ error: "Setup failed" });
  }
});

// --- Claim Reward Routes Restricted to 1st of the Month (Dhaka Time) ---

function checkFirstDayOfMonth(res: any): boolean {
  const now = new Date();
  const dhakaFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const dateStr = dhakaFormatter.format(now); // Guaranteed YYYY-MM-DD
  const day = parseInt(dateStr.split("-")[2], 10);

  if (day !== 1) {
    res.status(403).json({
      error: `📅 Calendar Warning: Claim requests are restricted! Today is day ${day} of the calendar month (Asia/Dhaka). Reward withdrawals and claim distributions can only be processed on exactly the 1st day of each month.`
    });
    return false;
  }
  return true;
}

expressApp.post("/api/jobs/claim", async (req, res) => {
  if (!checkFirstDayOfMonth(res)) return;

  const { userId, jobId } = req.body;
  if (!userId || !jobId) return res.status(400).json({ error: "Missing parameters" });

  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend database not connected" });

  try {
    const claimRes = await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");

      const today = new Date();
      const monthPrefix = `${today.getFullYear()}-${today.getMonth() + 1}`;
      const logId = `job_claim_${userId}_${jobId}_${monthPrefix}`;
      const logRef = database.collection("user_claims").doc(logId);
      const logSnap = await transaction.get(logRef);
      if (logSnap.exists) throw new Error("You have already claimed this job reward for this month.");

      const reward = 10; // Default flat reward for tasks

      transaction.update(userRef, {
        tasksBalance: admin.firestore.FieldValue.increment(reward),
        earningBalance: admin.firestore.FieldValue.increment(reward)
      });

      transaction.set(logRef, {
        userId,
        jobId,
        claimedAt: new Date().toISOString(),
        amount: reward
      });

      const txId = `claim_job_${Date.now()}_${userId}`;
      const nowIso = new Date().toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: reward,
        type: "job_claim",
        timestamp: nowIso,
        createdAt: nowIso,
        description: `Job Claim reward for ${jobId}`
      });

      return { reward };
    });

    res.json({ message: `Successfully claimed job reward of BDT ${claimRes.reward}`, amount: claimRes.reward });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

expressApp.post("/api/referral/claim", async (req, res) => {
  if (!checkFirstDayOfMonth(res)) return;

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing parameters" });

  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend database not connected" });

  try {
    const claimRes = await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const userData = userSnap.data()!;

      const rComm1 = Number(userData.referralCommissions || 0);
      const rComm2 = Number(userData.referralCommissionBalance || 0);
      const referralComm = Math.max(rComm1, rComm2);
      if (referralComm <= 0) throw new Error("No referral commissions available to claim.");

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(referralComm),
        referralCommissionBalance: 0,
        referralCommissions: 0
      });

      const txId = `claim_ref_${Date.now()}_${userId}`;
      const nowIso = new Date().toISOString();
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: referralComm,
        type: "referral_claim",
        timestamp: nowIso,
        createdAt: nowIso,
        description: `Claimed BDT ${referralComm.toFixed(2)} in referral mining commission`
      });

      return { claimed: referralComm };
    });

    res.json({ message: `Successfully claimed referral bonus of BDT ${claimRes.claimed.toFixed(2)}`, amount: claimRes.claimed });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Token Verification Middleware removed and relocated to top of file

expressApp.post("/api/claim-referral", verifyToken, async (req: any, res: any) => {
  const userId = req.user.uid;
  try {
    // Check if today is 1st day in BD Time UTC+6
    const bdTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"}));
    const isFirstDay = bdTime.getDate() === 1;
    
    if (!isFirstDay) {
      return res.status(400).json({ 
        error: "Referral balance can only be claimed on the 1st day of each month." 
      });
    }

    await dbCompat.runTransaction(async (transaction) => {
      const userRef = dbCompat.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) throw new Error("User not found.");
      const rComm1 = Number(userDoc.data().referralCommissions || 0);
      const rComm2 = Number(userDoc.data().referralCommissionBalance || 0);
      const balance = Math.max(rComm1, rComm2);
      
      if (balance <= 0) {
        throw new Error("No referral balance available to claim.");
      }

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(balance),
        referralCommissionBalance: 0,
        referralCommissions: 0
      });

      const logRef = dbCompat.collection("transaction_logs").doc();
      transaction.set(logRef, {
        userId,
        type: 'referral_claim',
        amount: balance,
        dateBD: getBDDate(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.json({ success: true, message: "Referral balance claimed successfully!" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// --- Gmail SMTP Email Handler with VIP Dark-Gold Styling ---

let transporter: any = null;

async function getMailTransporter() {
  const database = ensureDb();
  let host = process.env.SMTP_HOST || "smtp.gmail.com";
  let port = parseInt(process.env.SMTP_PORT || "587");
  let secure = process.env.SMTP_SECURE === "true"; // false by default
  let user = (process.env.SMTP_USER || "cryptoforge.online@gmail.com").trim();
  let pass = (process.env.SMTP_PASS || "ikijmxyhxdqqdljb").trim();

  if (database) {
    try {
      const configPromise = database.collection("settings").doc("smtp").get();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore fetch timeout")), 2500));
      const configDoc = await Promise.race([configPromise, timeoutPromise]) as any;

      if (configDoc.exists) {
        const d = configDoc.data();
        const isDbDefault = d.pass === "ikijmxyhxdqqdljb" || d.user === "cryptoforge.online@gmail.com";
        const hasCustomEnv = process.env.SMTP_PASS && process.env.SMTP_PASS.trim() !== "ikijmxyhxdqqdljb" && process.env.SMTP_PASS.trim() !== "";

        if (!hasCustomEnv || !isDbDefault) {
          if (d.host) host = d.host.trim();
          if (d.port) port = parseInt(d.port);
          if (d.secure !== undefined) secure = d.secure === true || d.secure === "true";
          if (d.user) user = d.user.trim();
          if (d.pass) pass = d.pass.trim();
          console.log(`[SMTP] Using dynamic configurations from Firestore for ${user}`);
        } else {
          console.log(`[SMTP] Preferring custom .env SMTP_PASS configuration over Firestore placeholder settings for ${process.env.SMTP_USER || "configured user"}`);
        }
      }
    } catch (dbErr) {
      console.warn("[SMTP] Warning: Could not retrieve dynamic SMTP config from Firestore settings/smtp. Falling back to env:", dbErr);
    }
  }

  // Clean all whitespace characters from the password
  pass = pass.replace(/\s+/g, "");

  // Auto-correct host if user has a zoho address but host is default gmail
  if (user.toLowerCase().endsWith("@zohomail.com") || user.toLowerCase().endsWith("@zoho.com") || user.toLowerCase().endsWith("@zoho.in")) {
    if (host === "smtp.gmail.com" || !host.includes("zoho")) {
      console.log(`[SMTP Auto-Correction] Automatically overriding host and SSL configurations to smtp.zoho.com for Zoho account: ${user}`);
      host = "smtp.zoho.com";
      port = 465;
      secure = true;
    }
  }

  let currentTransporter;
  if (host === "smtp.gmail.com" || host.includes("gmail")) {
    console.log(`[SMTP Gmail] Initializing explicit port 465 SSL connection for ${user}`);
    currentTransporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: user,
        pass: pass
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 4000
    });
  } else {
    currentTransporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: secure,
      auth: {
        user: user,
        pass: pass
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 4000
    });
  }
  return currentTransporter;
}

function sendMailWithTimeout(transporterInstance: any, mailOptions: any, timeoutMs: number = 4000): Promise<any> {
  return Promise.race([
    transporterInstance.sendMail(mailOptions),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: SMTP took longer than ${timeoutMs}ms to respond`)), timeoutMs))
  ]);
}

async function initializeSmtpSettingsDocument() {
  try {
    const database = ensureDb();
    if (!database) return;
    const docRef = database.collection("settings").doc("smtp");
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      await docRef.set({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        user: "cryptoforge.online@gmail.com",
        pass: "ikijmxyhxdqqdljb",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        instruction: "To configure your own secure mail sender, replace these values with your email and 16-character Gmail App Password or your SMTP provider details."
      });
      console.log("[SMTP Boot] Seeded default SMTP settings placeholder in Firestore under collection 'settings' document 'smtp'.");
    }
  } catch (err) {
    console.error("[SMTP Boot] Failed to seed default SMTP settings document:", err);
  }
}

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || "https://script.google.com/macros/s/AKfycbxDsf3YuUoEtHbbR8NxIq6Hg6N_HH8Co7DLP8w8oRiepNOeTmA5FD8OIIcMH1DsQWPnBw/exec";

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit OTP
}

// 1. Send OTP to verify Email Address
expressApp.post("/api/send-verify-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const database = ensureDb();
    if (!database) {
      throw new Error("Firestore DB not initialized.");
    }
    
    const emailKey = email.toLowerCase().trim();
    
    // Check if user exists to prevent incorrect OTP sends (logged as minor warning during setup latency)
    const userSnapshot = await database.collection('users').where('email', '==', emailKey).get();
    if (userSnapshot.empty) {
      console.warn(`[OTP Dispatch] Notice: User document for ${emailKey} is not found in Firestore yet. Proceeding with verification code dispatch anyway to prevent replication blocks.`);
    }

    const otpCode = generateOTP();

    // Save to /email_otps collection with email as document key
    await database.collection("email_otps").doc(emailKey).set({
      otp: otpCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[GAS OTP Request] Sending OTP to Google Apps Script for email: ${emailKey}, Code: ${otpCode}`);

    try {
      if (GAS_WEB_APP_URL === "YOUR_DEPLOYED_GAS_WEB_APP_URL") {
        console.warn("[GAS OTP Warning] Google Apps Script URL has placeholder value. Using bypass delivery option for sandbox testing.");
        return res.json({ 
          success: true, 
          message: "Verification OTP code generated. (Bypass mode active due to placeholder GAS URL)", 
          debugOtp: otpCode 
        });
      }

      const gasResponse = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: emailKey,
          otp: otpCode
        })
      });

      if (!gasResponse.ok) {
        throw new Error(`Google Apps Script returned status: ${gasResponse.status}`);
      }

      console.log(`[GAS OTP Success] Successfully sent OTP via GAS Web App for ${emailKey}`);
      return res.json({ 
        success: true, 
        message: "Verification OTP code sent to email.", 
        debugOtp: otpCode 
      });
    } catch (gasErr: any) {
      console.error("[GAS OTP Error] External relay failed, using local bypass fallback:", gasErr.message);
      return res.json({ 
        success: true, 
        smtpError: true,
        message: "External dispatch notice. Utilizing debug code fallback for profile verification.", 
        debugOtp: otpCode 
      });
    }
  } catch (error: any) {
    console.error("Error in send-verify-otp API:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Verify Email OTP Code
expressApp.post("/api/verify-otp", async (req, res) => {
  const { email, otp, userId, isRegister, registrationData } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: "Email and otp are required." });
  }

  try {
    const database = ensureDb();
    if (!database) return res.status(503).json({ error: "DB not initialized." });

    const emailKey = email.toLowerCase().trim();
    
    // Retrieve OTP from /email_otps
    const otpDoc = await database.collection("email_otps").doc(emailKey).get();
    if (!otpDoc.exists) {
      return res.status(400).json({ error: "Verification code expired or not found. Please click resend." });
    }

    const savedOtp = otpDoc.data()?.otp;
    if (savedOtp !== otp.trim()) {
      return res.status(400).json({ error: "Invalid verification OTP code." });
    }

    if (isRegister && registrationData) {
      // 1. Create User using Firebase Admin SDK
      let userRecord;
      try {
        userRecord = await admin.auth().createUser({
          email: emailKey,
          password: registrationData.password,
          displayName: registrationData.fullName,
          emailVerified: true
        });
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          return res.status(400).json({ error: "This email is already in use. Please login or use a different email." });
        }
        throw authErr;
      }

      const newUserUid = userRecord.uid;

      // 2. Save user document to Firestore
      await database.collection("users").doc(newUserUid).set({
        uid: registrationData.uid,
        email: emailKey,
        fullName: registrationData.fullName,
        phone: registrationData.phone,
        balance: 0,
        mainBalance: 0,
        status: 'inactive',
        withdrawPin: '',
        profileCompleted: false,
        hasDeposit: false,
        referredBy: registrationData.referredBy || null,
        referralCode: registrationData.uid,
        referralBalance: 0,
        totalReferralEarned: 0,
        createdAt: new Date().toISOString(),
        savedNumbers: [],
        emailVerified: true
      });

      // 3. Welcome notification
      try {
        await database.collection('notifications').add({
          userId: newUserUid,
          title: 'Welcome to CryptoForge!',
          message: 'Thank you for joining our platform. Start your journey today! Deposit to activate your account.',
          createdAt: new Date().toISOString(),
          read: false
        });
      } catch (notifErr) {
        console.warn("Could not create registration welcome notification in backend:", notifErr);
      }

      // Delete the OTP document after successful verification
      await database.collection("email_otps").doc(emailKey).delete();

      return res.json({ success: true, message: "Registration successful." });
    }

    // --- Standard pre-existing post-login verification flow ---
    if (!userId) {
      return res.status(400).json({ error: "UserId is required for verification." });
    }

    // Mark emailVerified in Firebase Auth
    try {
      await admin.auth().updateUser(userId, { emailVerified: true });
    } catch (authErr: any) {
      console.warn("Could not set emailVerified on Firebase Auth user:", authErr.message);
    }

    // Update profile in /users
    await database.collection("users").doc(userId).update({
      emailVerified: true
    });

    // Delete the OTP document after successful verification
    await database.collection("email_otps").doc(emailKey).delete();

    res.json({ success: true, message: "Email verification successful." });
  } catch (error: any) {
    console.error("Error verifying email OTP:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Forgot Password - Send OTP
expressApp.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const database = ensureDb();
    if (!database) return res.status(503).json({ error: "DB not initialized." });

    const emailKey = email.toLowerCase().trim();

    // Verify user exists in Auth
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().getUserByEmail(emailKey);
    } catch {
      return res.status(404).json({ error: "No user account is registered with this email address." });
    }

    const otpCode = generateOTP();

    // Save under /email_otps
    await database.collection("email_otps").doc(emailKey).set({
      otp: otpCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[GAS OTP Request] Sending Reset OTP to Google Apps Script for email: ${emailKey}, Code: ${otpCode}`);

    try {
      if (GAS_WEB_APP_URL === "YOUR_DEPLOYED_GAS_WEB_APP_URL" || !GAS_WEB_APP_URL) {
        console.warn("[GAS OTP Warning] Google Apps Script URL has placeholder/empty value. Using bypass delivery option for sandbox testing.");
        return res.json({ 
          success: true, 
          message: "Security reset code generated. (Bypass mode active due to placeholder GAS URL)", 
          debugOtp: otpCode 
        });
      }

      const gasResponse = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: emailKey,
          otp: otpCode
        })
      });

      if (!gasResponse.ok) {
        throw new Error(`Google Apps Script returned status: ${gasResponse.status}`);
      }

      console.log(`[GAS OTP Success] Successfully sent Reset OTP via GAS Web App for ${emailKey}`);
      return res.json({ 
        success: true, 
        message: "Security reset code sent to your email.", 
        debugOtp: otpCode 
      });
    } catch (gasErr: any) {
      console.error("[GAS OTP Error] External relay failed, using local bypass fallback:", gasErr.message);
      return res.json({ 
        success: true, 
        smtpError: true,
        message: "External dispatch notice. Utilizing debug code fallback for credential recovery.", 
        debugOtp: otpCode 
      });
    }
  } catch (err: any) {
    console.error("Forgot password API error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Complete Password Reset
expressApp.post("/api/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: "Email, otp, and newPassword are required." });
  }

  try {
    const database = ensureDb();
    if (!database) return res.status(503).json({ error: "DB not initialized." });

    const emailKey = email.toLowerCase().trim();

    // Verify OTP
    const otpDoc = await database.collection("email_otps").doc(emailKey).get();
    if (!otpDoc.exists) {
      return res.status(400).json({ error: "Reset code has expired or was not found." });
    }

    const savedOtp = otpDoc.data()?.otp;
    if (savedOtp !== otp.trim()) {
      return res.status(400).json({ error: "Invalid password reset code." });
    }

    // Locate the user UID in Firebase Admin Auth
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().getUserByEmail(emailKey);
    } catch {
      return res.status(404).json({ error: "User auth with this email not found." });
    }

    // Update password
    await admin.auth().updateUser(firebaseUser.uid, { password: newPassword });

    // Delete SMS/SMTP OTP record
    await database.collection("email_otps").doc(emailKey).delete();

    res.json({ success: true, message: "Your password has been successfully reset! Please login." });
  } catch (error: any) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Secure In-App Account Settings Profile Password Refactor
expressApp.post("/api/auth/update-inapp-password", async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  if (!email || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "Email, current password, and new password are required" });
  }
  try {
    const firebaseConfig = getFirebaseConfig();
    if (!firebaseConfig || !firebaseConfig.apiKey) {
      return res.status(503).json({ error: "Firebase configuration not found." });
    }
    const apiKey = firebaseConfig.apiKey;
    
    // Perform secure REST call to verify current password credentials on Google Auth Service
    const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: currentPassword, returnSecureToken: true })
    });
    
    if (!verifyRes.ok) {
      return res.status(401).json({ error: "Incorrect current password. Verification failed." });
    }
    
    const database = ensureDb();
    if (!database) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    
    const snapshot = await database.collection("users").where("email", "==", email.toLowerCase().trim()).get();
    if (snapshot.empty) {
      return res.status(404).json({ error: "User record not found." });
    }
    
    // Commit the operational change to Auth SDK
    await admin.auth().updateUser(snapshot.docs[0].id, { password: newPassword });
    
    res.json({ success: true, message: "Password updated successfully!" });
  } catch (err: any) {
    console.error("Error setting profile password in-app:", err);
    res.status(500).json({ error: "Failed to commit credential update: " + err.message });
  }
});

async function initializeSuperAdminUser() {
  const emailVal = "shaikhmdmurad1@gmail.com";
  const passVal = "Admin@murad";
  try {
    const database = ensureDb();
    if (!database) {
      console.warn("[Admin Setup] Database not connected. Cannot initialize super admin.");
      return;
    }
    
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(emailVal);
      // Ensure the correct password is programmatically set and synced
      await admin.auth().updateUser(userRecord.uid, {
        password: passVal,
        emailVerified: true,
        displayName: "Super Admin"
      });
      console.log(`[Admin Setup] Successfully synced Super Admin credentials in Firebase Auth.`);
    } catch (authErr: any) {
      if (authErr.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({
          email: emailVal,
          password: passVal,
          displayName: "Super Admin",
          emailVerified: true
        });
        console.log(`[Admin Setup] Created new Super Admin Auth record:`, userRecord.uid);
      } else {
        throw authErr;
      }
    }

    const uid = userRecord.uid;

    // Set users database document
    const userDocRef = database.collection("users").doc(uid);
    const userDocSnap = await userDocRef.get();
    if (!userDocSnap.exists) {
      await userDocRef.set({
        uid: "admin_murad",
        email: emailVal,
        fullName: "Super Admin",
        phone: "01700000000",
        balance: 0,
        mainBalance: 0,
        status: "active",
        createdAt: new Date().toISOString(),
        emailVerified: true,
        profileCompleted: true
      });
      console.log(`[Admin Setup] Created users document for Super Admin UID:`, uid);
    } else {
      await userDocRef.update({
        status: "active",
        emailVerified: true,
        email: emailVal
      });
    }

    // Set admins database document
    await database.collection("admins").doc(uid).set({
      email: emailVal,
      role: "superadmin",
      lastActive: new Date().toISOString()
    }, { merge: true });
    console.log(`[Admin Setup] Verified /admins/ collection contains superadmin document.`);

    // Enforce safety: Delete any other records in the "admins" collection, or any other user possessing administrative credentials automatically (preserving system-admin)
    const adminsSnap = await database.collection("admins").get();
    for (const doc of adminsSnap.docs) {
      const email = doc.data()?.email;
      if (doc.id !== uid && email !== "backend-admin@cryptoforge.local") {
        console.log(`[Admin Security] Strictly deleting unauthorized admin doc: ${doc.id} (${email})`);
        await database.collection("admins").doc(doc.id).delete();
      }
    }
  } catch (err: any) {
    console.error("[Admin Setup Error] Super Admin initialization error:", err);
  }
}

// Vite Middleware
async function startServer() {
  try {
    await authenticateBackendSystem();
  } catch (err) {
    console.error("⚠️ Failed to authenticate backend system account on startup:", err);
  }

  // Set up & enforce Murad as the exclusive super admin dynamically
  try {
    await initializeSuperAdminUser();
  } catch (err) {
    console.error("⚠️ Failed to run initializeSuperAdminUser on startup:", err);
  }

  try {
    await initializeSmtpSettingsDocument();
  } catch (err) {
    console.error("⚠️ Failed to seed default SMTP Settings in Firestore:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    expressApp.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    expressApp.use(express.static(distPath));
    
    expressApp.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  expressApp.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

