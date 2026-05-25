import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { dbCompat, adminCompat as admin, authenticateBackendSystem } from "./firebase-compat";
import cron from "node-cron";
import fs from "fs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Load Firebase Config helper
function getFirebaseConfig() {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      console.error("Error parsing firebase-applet-config.json:", e);
      return null;
    }
  }
  return null;
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
const PORT = 3000;

expressApp.use(express.json());

// --- Mining Logic Helpers ---

function calculateProfit(seconds: number, dailyProfit: number): number {
  const profitPerSecond = dailyProfit / 86400;
  return Math.max(0, seconds * profitPerSecond);
}

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
        tx.set(database.collection("notifications").doc(notifId), {
          userId: l1ReferrerId,
          title: "Referral Commission",
          message: `You earned BDT ${l1Commission.toFixed(2)} from your referral's purchase!`,
          type: "referral",
          timestamp: new Date().toISOString(),
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
  const database = ensureDb();
  if (!database) {
    console.error("[Cron] Skip distribution: Firestore not initialized");
    return;
  }
  
  // 1. Get STRICT Dhaka Date (YYYY-MM-DD)
  const now = new Date();
  const dhakaFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const dateStr = dhakaFormatter.format(now); // Guaranteed YYYY-MM-DD
  
  // Dhaka Midnight Timestamp
  const dhakaNowStr = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const dhakaMidnight = new Date(dhakaNowStr);
  dhakaMidnight.setHours(0, 0, 0, 0);
  const midnightTimestamp = dhakaMidnight.getTime();

  console.log(`[Cron] Executing mining distribution for ${dateStr} (Dhaka Midnight: ${dhakaMidnight.toISOString()})`);

  try {
    // 2. ATOMIC GLOBAL PROCESS LOCK (To prevent concurrent runs)
    const lockAcquired = await database.runTransaction(async (transaction) => {
      const globalLockRef = database.collection("system_locks").doc(`mining_${dateStr}`);
      const lockSnap = await transaction.get(globalLockRef);
      if (lockSnap.exists) {
        return false; // If lock exists, terminate instantly to stop duplicate payouts
      }
      transaction.set(globalLockRef, {
        status: "running",
        date: dateStr,
        startedAt: new Date().toISOString()
      }, { merge: true });
      return true;
    });

    if (!lockAcquired) {
      console.log(`[Cron] Skip instantly: Lock document inside 'system_locks/mining_${dateStr}' exists. Terminating to stop duplicate payouts.`);
      return;
    }

    const usersSnap = await database.collection("users").get();
    const packagesSnap = await database.collection("packages").get();
    
    const packagesMap: Record<string, any> = {};
    packagesSnap.forEach(doc => {
      packagesMap[doc.id] = doc.data();
    });

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      
      try {
        await database.runTransaction(async (transaction) => {
          // A. User Identity & Idempotency / Double-Spending Prevention
          const logId = `daily_${userId}_${dateStr}`;
          const logRef = database.collection("daily_mining_logs").doc(logId);
          const logSnap = await transaction.get(logRef);
          
          if (logSnap.exists) {
            console.log(`[Cron] User ${userId} already rewarded for ${dateStr}. Skipping.`);
            return; // Skip to prevent double-spending
          }

          const userRef = database.collection("users").doc(userId);
          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists) return;
          const userData = userSnap.data()!;

          // NEW: Validate Non-Expired Active Robot (`current_date <= robot_expiry_date`) and hard delete expired ones
          const robotSnap = await database.collection("user_robots")
            .where("userId", "==", userId)
            .get();
          
          let robotOn = false;
          const currentDateObj = new Date();
          for (const rDoc of robotSnap.docs) {
            const rData = rDoc.data();
            if (rData.expiresAt && new Date(rData.expiresAt) < currentDateObj) {
              transaction.delete(rDoc.ref);
            } else if (rData.isActivated && (!rData.expiresAt || new Date(rData.expiresAt) >= currentDateObj)) {
              robotOn = true;
            }
          }

          // B. Eligibility Check (Get ALL packages for this user from purchasedPackages sub-collection)
          const pkgsSnap = await userRef.collection("purchasedPackages")
            .where("status", "==", "active")
            .get();

          if (pkgsSnap.empty) return;

          let totalProfitForUser = 0;
          const todayIso = new Date().toISOString();
          
          // Calculate next day's automated start time: 12:00:01 AM Dhaka Time
          const nextDayStartMs = midnightTimestamp + (24 * 60 * 60 * 1000) + 1000; // Dhaka Midnight + 1s
          const nextDayStartISO = new Date(nextDayStartMs).toISOString();

          for (const pkgDoc of pkgsSnap.docs) {
            // Read dynamic status fields from global collection to ensure alignment with frontend
            const globalPkgRef = database.collection("user_packages").doc(pkgDoc.id);
            const globalPkgSnap = await transaction.get(globalPkgRef);
            const pkgData = globalPkgSnap.exists ? globalPkgSnap.data()! : pkgDoc.data();

            // Expiration Check: current_date > expiry_date means expired
            if (pkgData.expiresAt && new Date(pkgData.expiresAt) < now) {
              const expireUpdate = { status: 'expired', miningStatus: 'inactive' };
              transaction.update(pkgDoc.ref, expireUpdate);
              transaction.update(globalPkgRef, expireUpdate);
              continue;
            }

            const details = packagesMap[pkgData.packageId];
            if (!details) continue;

            const isManualActive = pkgData.miningStatus === 'active';
            const shouldMineAuto = robotOn && isManualActive; // Enforced strict rule: Robot respects CPU state. If CPU is off, it will not start mining at 12 AM! 

            if (isManualActive || shouldMineAuto) {
              // Profit-per-second calculation based on robot/manual logic
              let seconds = 0;
              if (isManualActive && pkgData.miningStartedAt) {
                const startMs = new Date(pkgData.miningStartedAt).getTime();
                const endMs = now.getTime();
                seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
                // Cap at 24 hours (86400 seconds)
                if (seconds > 86400) seconds = 86400;
              } else if (shouldMineAuto) {
                // If robot is active, calculate for full day
                seconds = 86400;
              }

              const profitPerSecond = details.dailyProfit / 86400;
              const pkgProfit = Number((seconds * profitPerSecond).toFixed(6));

              totalProfitForUser += pkgProfit;

              // Reset/prepare the package status for the next day's cycle
              const cycleUpdate: any = {};
              if (robotOn) {
                // Robot automatically auto-starts the package for the new day's cycle starting strictly at 12:00:01 AM
                cycleUpdate.miningStatus = 'active';
                cycleUpdate.lastClaim = todayIso;
                cycleUpdate.miningStartedAt = nextDayStartISO;
                cycleUpdate.currentPotentialEarning = details.dailyProfit;
              } else {
                // Non-robot users remain 'inactive' until they manually click start.
                cycleUpdate.miningStatus = 'inactive';
                cycleUpdate.lastClaim = todayIso;
                cycleUpdate.miningStartedAt = "";
                cycleUpdate.currentPotentialEarning = 0;
              }

              transaction.update(pkgDoc.ref, cycleUpdate);
              transaction.update(globalPkgRef, cycleUpdate);
            }
          }

          if (totalProfitForUser <= 0) {
            // No work done for this user today, ensure state reflects that
            const miningStateRef = database.collection("mining_states").doc(userId);
            const stateSnap = await transaction.get(miningStateRef);
            if (stateSnap.exists && stateSnap.data()?.isActive) {
              transaction.update(miningStateRef, { isActive: robotOn, lastStartTime: robotOn ? nextDayStartMs : 0 });
            }
            return;
          }

          const miningStateRef = database.collection("mining_states").doc(userId);
          const profit = Number(totalProfitForUser.toFixed(6));

          if (profit > 0) {
            // Bulk update user balance inside our transactional context
            transaction.update(userRef, {
              mainBalance: admin.firestore.FieldValue.increment(profit)
            });

            // 2. Referral Commission (2.5% Daily Mining Bonus)
            if (userData.referredBy) {
              const refBonus = Number((profit * 0.025).toFixed(6));
              const l1Ref = database.collection("users").doc(userData.referredBy);
              
              transaction.update(l1Ref, {
                referralCommissionBalance: admin.firestore.FieldValue.increment(refBonus),
                totalReferralEarned: admin.firestore.FieldValue.increment(refBonus)
              });

              // Log referral earning
              const refEarnId = `ref_daily_${userId}_${dateStr}`;
              transaction.set(database.collection("referral_earnings").doc(refEarnId), {
                referrerId: userData.referredBy,
                referredId: userId,
                referredName: userData.fullName || userData.name || 'User',
                amount: refBonus,
                type: 'mining_commission',
                source: '2.5% Daily Mining Bonus',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });

              // Log transaction for referrer
              const refTxId = `ref_tx_${userId}_${dateStr}`;
              transaction.set(database.collection("transactions").doc(refTxId), {
                userId: userData.referredBy,
                amount: refBonus,
                type: 'commission',
                status: 'completed',
                description: `2.5% Mining Bonus from ${userData.fullName || 'Referral'}`,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
              });
            }

            // Write a persistent idempotency log document
            transaction.set(logRef, {
              userId,
              date: dateStr,
              amount: profit,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // Audit log entry in a transactions_ledger table/collection for security purposes
            const ledgerId = `ledger_${userId}_${dateStr}`;
            transaction.set(database.collection("transactions_ledger").doc(ledgerId), {
              userId,
              amount: profit,
              type: "mining_reward",
              date: dateStr,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              description: `Audit log of daily mining reward for user ${userId} on ${dateStr}`,
              status: "committed"
            });

            // Transaction History Entry (Unique ID)
            const dailyTxId = `mining_hist_${userId}_${dateStr}`;
            transaction.set(database.collection("transactions").doc(dailyTxId), {
              userId,
              amount: profit,
              type: "mining_profit",
              createdAt: dhakaMidnight.toISOString(),
              timestamp: dhakaMidnight.toISOString(),
              status: "completed",
              description: `Daily mining profit distribution for ${dateStr}`
            });

            // Update Mining State for next day
            transaction.set(miningStateRef, {
              userId,
              isActive: robotOn,
              lastStartTime: robotOn ? nextDayStartMs : 0
            }, { merge: true });

            console.log(`[Cron] Distributed ${profit} profit and commission for ${userId}. Robot automation status: ${robotOn}`);
          }
        });
      } catch (userErr) {
        console.error(`[Cron] User ${userId} processing failed:`, userErr);
      }
    }

    // 3. Mark Global Lock as Completed
    const globalLockRef = database.collection("system_locks").doc(`mining_${dateStr}`);
    await globalLockRef.set({
      status: "completed",
      date: dateStr,
      finishedAt: new Date().toISOString()
    });

    // 4. Run Hard-Delete Cleanup Module
    await runHardDeleteCleanup(database);

  } catch (err) {
    console.error("[Cron] Major failure in processDailyMining:", err);
  }
}

// Schedule Cron: Every day at 12:00 AM (00:00) Bangladesh Time
cron.schedule("0 0 * * *", () => {
  processDailyMining();
}, {
  timezone: "Asia/Dhaka"
});

// --- API Endpoints ---

// Health check with Bangladesh Time info
expressApp.get("/api/health", (req, res) => {
  const now = new Date();
  const dhakaTime = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  res.json({ 
    status: "ok", 
    initialized: !!db, 
    serverTime: now.toISOString(),
    dhakaTime: dhakaTime,
    timezone: "Asia/Dhaka",
    env: process.env.NODE_ENV || "development"
  });
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

// Redirect old /admin to new /portal-manager
expressApp.get("/admin", (req, res) => {
  res.redirect("/portal-manager");
});

// --- Unified API Routes ---

// SECURE PACKAGE PURCHASE
expressApp.post("/api/package/purchase", async (req, res) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });

  const { userId, packageId } = req.body;
  if (!userId || !packageId) return res.status(400).json({ error: "Missing parameters" });

  let pkgPrice = 0;
  try {
    await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const userData = userSnap.data()!;

      const pkgRef = database.collection("packages").doc(packageId);
      const pkgSnap = await transaction.get(pkgRef);
      if (!pkgSnap.exists) throw new Error("Package not found");
      const pkgData = pkgSnap.data()!;
      pkgPrice = pkgData.price;

      const currentBal = typeof userData.mainBalance === 'number' ? userData.mainBalance : (userData.balance || 0);
      if (currentBal < pkgData.price) {
        throw new Error("Insufficient balance");
      }

      // 1. Deduct Balance
      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(-pkgData.price)
      });

      // 2. Add Package
      const userPkgId = `up_${Date.now()}_${userId}`;
      const expiresAt = new Date();
      const validityVal = pkgData.validity != null ? pkgData.validity : (pkgData.durationDays || pkgData.duration || 30);
      expiresAt.setDate(expiresAt.getDate() + validityVal);

      // Get user's active non-expired robots inside the transaction
      const robotsRef = database.collection("user_robots").where("userId", "==", userId);
      const robotsSnap = await transaction.get(robotsRef);
      let robotOn = false;
      const nowTime = new Date();
      for (const rDoc of robotsSnap.docs) {
        const rData = rDoc.data();
        if (rData.isActivated === true && rData.expiresAt && new Date(rData.expiresAt) >= nowTime) {
          robotOn = true;
          break;
        }
      }

      const now = new Date();
      const dhakaStr = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
      const dhakaNow = new Date(dhakaStr);
      const dhakaMidnight = new Date(dhakaNow);
      dhakaMidnight.setHours(23, 59, 59, 999);
      const secondsRemaining = Math.max(0, (dhakaMidnight.getTime() - dhakaNow.getTime()) / 1000);
      const factor = secondsRemaining / 86400;
      const dailyEarn = pkgData.dailyProfit || pkgData.daily || 0;
      const proRataEarn = Number((dailyEarn * factor).toFixed(6));

      const purchasedAtStr = now.toISOString();

      const pkgDocData = {
        userId,
        packageId,
        packageName: pkgData.name,
        daily: dailyEarn,
        purchasedAt: purchasedAtStr,
        expiresAt: expiresAt.toISOString(),
        status: "active",
        miningStatus: "active",
        miningStartedAt: purchasedAtStr,
        currentPotentialEarning: proRataEarn
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
        miningStatus: "active",
        miningStartedAt: purchasedAtStr,
        currentPotentialEarning: proRataEarn
      });

      // 3. Record Transaction
      const txId = `purchase_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: -pkgData.price,
        type: "purchase",
        timestamp: new Date().toISOString(),
        description: `Purchased ${pkgData.name}`
      });

      // 4. Initial Mining State
      const miningRef = database.collection("mining_states").doc(userId);
      const miningSnap = await transaction.get(miningRef);
      if (!miningSnap.exists) {
        transaction.set(miningRef, {
          userId,
          isActive: false,
          lastStartTime: 0
        });
      }
    });

    // Notify Distribute Commissions
    distributeReferralCommission(database, userId, pkgPrice);

    res.json({ message: "Package purchased successfully" });
  } catch (error: any) {
    console.error("Purchase error:", error);
    res.status(400).json({ error: error.message || "Purchase failed" });
  }
});

// WALLET DEPOSIT (Manual/Admin Adjustment)
expressApp.post("/api/wallet/deposit", async (req, res) => {
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
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: amount,
        type: "deposit",
        timestamp: new Date().toISOString(),
        description: `Deposit via ${method || 'Wallet'}`
      });
    });
    res.json({ message: "Deposit processed successfully" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// WALLET WITHDRAWAL
expressApp.post("/api/wallet/withdraw", async (req, res) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured" });
  const { userId, amount, method, account } = req.body;
  if (!userId || !amount || amount <= 0) return res.status(400).json({ error: "Invalid parameters" });

  try {
    await database.runTransaction(async (transaction) => {
      const userRef = database.collection("users").doc(userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const userData = userSnap.data()!;

      const currentBal = typeof userData.mainBalance === 'number' ? userData.mainBalance : (userData.balance || 0);
      if (currentBal < amount) throw new Error("Insufficient balance");

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(-amount),
        balance: admin.firestore.FieldValue.increment(-amount)
      });

      const txId = `wd_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: -amount,
        type: "withdrawal",
        timestamp: new Date().toISOString(),
        description: `Withdrawal to ${method} (${account})`
      });
    });
    res.json({ message: "Withdrawal requested successfully" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// DEPOSIT APPROVAL (Transactional with atomic user-document lock)
expressApp.post("/api/deposit/approve", async (req, res) => {
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

      // 2. Increment user mainBalance and balance
      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(amount),
        balance: admin.firestore.FieldValue.increment(amount)
      });

      // 3. Log customer transaction history
      const txId = `dep_app_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: amount,
        type: "deposit",
        timestamp: new Date().toISOString(),
        description: `Approved deposit of BDT ${amount.toFixed(2)}`
      });

      // 4. Create Notification
      const notifId = `notif_dep_${Date.now()}_${userId}`;
      transaction.set(database.collection("notifications").doc(notifId), {
        userId,
        title: "Deposit Approved",
        message: `Your deposit of BDT ${amount.toFixed(2)} has been approved and credited.`,
        type: "deposit",
        timestamp: new Date().toISOString(),
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

// Manual Mining Start
expressApp.post("/api/mining/start", async (req, res) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured with Firebase" });
  
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "User ID required" });

  try {
    await database.collection("mining_states").doc(userId).set({
      userId,
      isActive: true,
      lastStartTime: Date.now()
    }, { merge: true });

    res.json({ message: "Mining started successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to start mining" });
  }
});

// Complete Finished Mining Jobs
expressApp.post("/api/mining/complete-finished-jobs", async (req, res) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured with Firebase" });

  const { userId, packageId } = req.body;
  if (!userId || !packageId) {
    return res.status(400).json({ error: "userId and packageId are required" });
  }

  try {
    const result = await database.runTransaction(async (transaction) => {
      const globalPkgRef = database.collection("user_packages").doc(packageId);
      const subPkgRef = database.collection("users").doc(userId).collection("purchasedPackages").doc(packageId);
      const userRef = database.collection("users").doc(userId);

      const globalPkgSnap = await transaction.get(globalPkgRef);
      const userSnap = await transaction.get(userRef);

      if (!globalPkgSnap.exists) {
        throw new Error("Mining package not found");
      }
      if (!userSnap.exists) {
        throw new Error("User profile not found");
      }

      const pkgData = globalPkgSnap.data()!;
      if (pkgData.miningStatus !== 'active') {
        throw new Error("This mining job is not active");
      }

      const profit = Number((pkgData.currentPotentialEarning || pkgData.daily || 0).toFixed(6));
      if (profit <= 0) {
        throw new Error("No profit accumulated for this job");
      }

      // Increment user's main balance and decrement/clear mining profit
      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(profit)
      });

      const todayIso = new Date().toISOString();
      const cycleUpdate = {
        miningStatus: 'inactive',
        lastClaim: todayIso,
        miningStartedAt: "",
        currentPotentialEarning: 0
      };

      transaction.update(globalPkgRef, cycleUpdate);
      transaction.update(subPkgRef, cycleUpdate);

      // Create a transaction history entry
      const txId = `mining_comp_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: profit,
        type: "mining_profit",
        createdAt: todayIso,
        timestamp: todayIso,
        status: "completed",
        description: `Mining profit for ${pkgData.packageName || 'Level Miner'} credited successfully`
      });

      return { profit };
    });

    res.json({ message: "Job completed and profit transferred successfully", profit: result.profit, success: true });
  } catch (error: any) {
    console.error("Job completion failed:", error);
    res.status(400).json({ error: error.message || "Failed to complete job" });
  }
});

expressApp.post("/api/admin/trigger-mining", async (req, res) => {
  const database = ensureDb();
  if (!database) return res.status(503).json({ error: "Backend not configured with Firebase" });
  await processDailyMining();
  res.json({ message: "Mining distribution triggered manually" });
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
        mainBalance: admin.firestore.FieldValue.increment(reward),
        balance: admin.firestore.FieldValue.increment(reward)
      });

      transaction.set(logRef, {
        userId,
        jobId,
        claimedAt: new Date().toISOString(),
        amount: reward
      });

      const txId = `claim_job_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: reward,
        type: "job_claim",
        timestamp: new Date().toISOString(),
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

      const referralComm = userData.referralCommissionBalance || 0;
      if (referralComm <= 0) throw new Error("No referral commissions available to claim.");

      transaction.update(userRef, {
        mainBalance: admin.firestore.FieldValue.increment(referralComm),
        referralCommissionBalance: 0
      });

      const txId = `claim_ref_${Date.now()}_${userId}`;
      transaction.set(database.collection("transactions").doc(txId), {
        userId,
        amount: referralComm,
        type: "referral_claim",
        timestamp: new Date().toISOString(),
        description: `Claimed BDT ${referralComm.toFixed(2)} in referral mining commission`
      });

      return { claimed: referralComm };
    });

    res.json({ message: `Successfully claimed referral bonus of BDT ${claimRes.claimed.toFixed(2)}`, amount: claimRes.claimed });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Zoho SMTP Email Handler with VIP Dark-Gold Styling ---

let transporter: any = null;

function getMailTransporter() {
  if (transporter) return transporter;
  const user = "cryptoforge@zohomail.com";
  const pass = "g0qtbWru880v";
  transporter = nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true, // SSL/TLS
    auth: {
      user: user,
      pass: pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
  return transporter;
}

// 1. SMTP Registration Verification / Verification OTP endpoint
expressApp.post("/api/email/send-verification", async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const database = ensureDb();
    if (!database) {
      throw new Error("Firestore Database could not be initialized. Please check your Firebase configuration.");
    }
    const mailer = getMailTransporter();
    const fromUser = "cryptoforge@zohomail.com";
    
    const senderName = "CryptoForge VIP Network";
    const subject = "🔥 Complete Your Registration - Verification Required";
    
    // Server-side secure OTP code generation
    const displayOtp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save to Firestore user document
    const userSnapshot = await database.collection('users').where('email', '==', email).get();
    if (!userSnapshot.empty) {
      await userSnapshot.docs[0].ref.update({
        verificationOtp: displayOtp
      });
      console.log(`Stored verification OTP code for email ${email}`);
    } else {
      console.warn(`Could not find Firestore user document for email ${email} during send-verification`);
    }

    const plainText = `Welcome to CryptoForge, ${name || "Miner"}!\n\nYour Verification Code is: ${displayOtp}\n\nPlease enter this on the verification screen to activate your account.`;
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B0F19; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0B0F19; padding: 40px 10px;">
    <tr>
      <td align="center" valign="top">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #151D30; border: 2px solid #D4AF37; border-radius: 16px; width: 100%; max-width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;">
          <!-- Gold Highlight Banner -->
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #AA7C11 0%, #FFD700 50%, #AA7C11 100%);"></td>
          </tr>
          <tr>
            <td align="left" style="padding: 40px 35px 30px 35px;">
              <!-- Header Logo/Branding -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                <tr>
                  <td>
                    <h1 style="color: #FFD700; font-size: 26px; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 2px;">CryptoForge</h1>
                    <p style="color: #AA7C11; font-size: 11px; font-weight: bold; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 3px;">The Ultimate Mining Forge</p>
                  </td>
                </tr>
              </table>
              
              <!-- Separator -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 30px;">
                <tr>
                  <td height="1" style="background-color: rgba(212, 175, 55, 0.25);"></td>
                </tr>
              </table>

              <!-- Greeting & Core Info -->
              <h2 style="color: #FFFFFF; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 12px;">Greetings, ${name || "Miner"}!</h2>
              <p style="color: #B2C0D4; font-size: 14px; line-height: 1.6; margin-top: 0; margin-bottom: 25px;">
                Your registration with the VIP CryptoForge network is almost complete. To activate your secure mining profile and begin launching hardware nodes, please confirm your authenticity by typing the 6-digit OTP code below.
              </p>

              <!-- OTP Premium Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 25px; margin-bottom: 25px;">
                <tr>
                  <td align="center">
                    <table border="0" cellspacing="0" cellpadding="0" style="background-color: #0B0F19; border: 2px dashed #D4AF37; border-radius: 12px; min-width: 260px;">
                      <tr>
                        <td align="center" style="padding: 18px 24px;">
                          <span style="color: #AA7C11; font-size: 10px; font-weight: bold; display: block; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">OTP/Verification Code</span>
                          <span style="color: #FFD700; font-size: 34px; font-weight: 800; letter-spacing: 6px; font-family: 'Courier New', Courier, monospace; line-height: 1;">${displayOtp}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Optional Direct Connection -->
              <p style="color: #B2C0D4; font-size: 13px; line-height: 1.5; margin-bottom: 30px; text-align: center;">
                Please copy and paste the security code above into the 6-Digit Code field on the registration verification screen.
              </p>

              <!-- Secondary Separator -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                <tr>
                  <td height="1" style="background-color: rgba(212, 175, 55, 0.15);"></td>
                </tr>
              </table>

              <!-- Footer disclaimer -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="color: #6C7D93; font-size: 11px; line-height: 1.5;">
                    If you did not request this account registration, please safely disregard this transmission.
                  </td>
                </tr>
                <tr>
                  <td height="15"></td>
                </tr>
                <tr>
                  <td align="center" style="color: #AA7C11; font-size: 10px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">
                    &copy; 2026 CryptoForge Network. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    await mailer.sendMail({
      from: `"${senderName}" <${fromUser}>`,
      to: email,
      subject: subject,
      text: plainText,
      html: htmlBody
    });

    res.json({ message: "Verification email sent successfully" });
  } catch (error: any) {
    console.error("Error sending verification email via SMTP:", error);
    res.status(500).json({ error: "Failed to send verification email: " + error.message });
  }
});

// 2. SMTP Password Reset Link / Code
expressApp.post("/api/email/send-reset", async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const database = ensureDb();
    if (!database) {
      throw new Error("Firestore Database could not be initialized. Please check your Firebase configuration.");
    }
    const mailer = getMailTransporter();
    const fromUser = "cryptoforge@zohomail.com";
    
    const senderName = "CryptoForge Security";
    const subject = "🔒 Secure Password Reset Code - CryptoForge VIP";
    
    // Server-side secure OTP code generation for password reset
    const displayCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save to Firestore user document
    const userSnapshot = await database.collection('users').where('email', '==', email).get();
    if (!userSnapshot.empty) {
      await userSnapshot.docs[0].ref.update({
        resetOtp: displayCode
      });
      console.log(`Stored password reset OTP code for email ${email}`);
    } else {
      console.warn(`Could not find Firestore user document for email ${email} during send-reset`);
    }

    const plainText = `Greetings ${name || "Miner"}!\n\nWe received a request to reset your Password credentials.\n\nYour Recovery Code is: ${displayCode}\n\nPlease enter this on the recovery screen to authorize password reset.`;
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B0F19; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0B0F19; padding: 40px 10px;">
    <tr>
      <td align="center" valign="top">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #151D30; border: 2px solid #D4AF37; border-radius: 16px; width: 100%; max-width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden;">
          <!-- Gold Highlight Banner -->
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #AA7C11 0%, #FFD700 50%, #AA7C11 100%);"></td>
          </tr>
          <tr>
            <td align="left" style="padding: 40px 35px 30px 35px;">
              <!-- Header Logo/Branding -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                <tr>
                  <td>
                    <h1 style="color: #FFD700; font-size: 26px; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 2px;">CryptoForge</h1>
                    <p style="color: #AA7C11; font-size: 11px; font-weight: bold; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 3px;">The Ultimate Mining Forge</p>
                  </td>
                </tr>
              </table>
              
              <!-- Separator -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 30px;">
                <tr>
                  <td height="1" style="background-color: rgba(212, 175, 55, 0.25);"></td>
                </tr>
              </table>

              <!-- Greeting & Core Info -->
              <h2 style="color: #FFFFFF; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 12px;">Security Transmission</h2>
              <p style="color: #B2C0D4; font-size: 14px; line-height: 1.6; margin-top: 0; margin-bottom: 25px;">
                We received a request to change your CryptoForge credentials. If you initiated this request, please use the security code below to update your wallet password immediately on the recovery screen.
              </p>

              <!-- OTP Premium Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 25px; margin-bottom: 25px;">
                <tr>
                  <td align="center">
                    <table border="0" cellspacing="0" cellpadding="0" style="background-color: #0B0F19; border: 2px dashed #D4AF37; border-radius: 12px; min-width: 260px;">
                      <tr>
                        <td align="center" style="padding: 18px 24px;">
                          <span style="color: #AA7C11; font-size: 10px; font-weight: bold; display: block; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">Account Reset Token</span>
                          <span style="color: #FFD700; font-size: 34px; font-weight: 800; letter-spacing: 6px; font-family: 'Courier New', Courier, monospace; line-height: 1;">${displayCode}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Alternative URL fallback -->
              <p style="color: #B2C0D4; font-size: 13px; line-height: 1.5; margin-bottom: 25px; text-align: center;">
                Please input this security reset token on the website recovery screen to verify your identity.
              </p>

              <!-- Secondary Separator -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                <tr>
                  <td height="1" style="background-color: rgba(212, 175, 55, 0.15);"></td>
                </tr>
              </table>

              <!-- Footer disclaimer -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="color: #6C7D93; font-size: 11px; line-height: 1.5;">
                    If you did not issue this password reset security request, you can safely ignore this email. No password changes will be authorized.
                  </td>
                </tr>
                <tr>
                  <td height="15"></td>
                </tr>
                <tr>
                  <td align="center" style="color: #AA7C11; font-size: 10px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">
                    &copy; 2026 CryptoForge Network. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    await mailer.sendMail({
      from: `"${senderName}" <${fromUser}>`,
      to: email,
      subject: subject,
      text: plainText,
      html: htmlBody
    });

    res.json({ message: "Password reset email sent successfully" });
  } catch (error: any) {
    console.error("Error sending reset email via SMTP:", error);
    res.status(500).json({ error: "Failed to send reset email: " + error.message });
  }
});

// 3. Verify OTP Code and Generate Auto-Login JWT Token
expressApp.post("/api/auth/verify-code", async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: "Email and verification code are required" });
  }

  try {
    const database = ensureDb();
    if (!database) {
      return res.status(503).json({ error: "Backend database not initialized" });
    }
    
    // Query users collection by email
    const usersRef = database.collection("users");
    const snapshot = await usersRef.where("email", "==", email.toLowerCase().trim()).get();
    if (snapshot.empty) {
      return res.status(404).json({ error: "User account with this email not found." });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    if (!userData.verificationOtp || userData.verificationOtp !== code.trim()) {
      return res.status(400).json({ error: "Invalid verification code. Please check and try again." });
    }

    // Retrieve Firebase Auth User by email
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().getUserByEmail(email.toLowerCase().trim());
    } catch (e: any) {
      return res.status(404).json({ error: "auth user not found for this email: " + e.message });
    }

    // Set emailVerified is true in Firebase Auth
    await admin.auth().updateUser(firebaseUser.uid, { emailVerified: true });

    // Update user document on Firestore
    await userDoc.ref.update({
      emailVerified: true,
      status: "active",
      verificationOtp: admin.firestore.FieldValue.delete()
    });

    // Create Firebase Custom Token for immediate auto-login
    const customToken = await admin.auth().createCustomToken(firebaseUser.uid);

    console.log(`Successfully verified email for ${email} & generated auto-login custom token`);

    res.json({
      success: true,
      message: "Email verified successfully!",
      token: customToken
    });
  } catch (err: any) {
    console.error("Error verifying code:", err);
    res.status(500).json({ error: "Verification server error: " + err.message });
  }
});

// 4. Verify OTP Code for Password Reset
expressApp.post("/api/auth/verify-reset-otp", async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: "Email and code are required" });
  }
  try {
    const database = ensureDb();
    if (!database) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    
    const snapshot = await database.collection("users").where("email", "==", email.toLowerCase().trim()).get();
    if (snapshot.empty) {
      return res.status(404).json({ error: "User profile with this email not found." });
    }
    
    const userData = snapshot.docs[0].data();
    if (!userData.resetOtp || userData.resetOtp !== code.trim()) {
      return res.status(400).json({ error: "Invalid reset code. Please check and try again." });
    }
    
    res.json({ success: true, message: "Verification code match confirmed." });
  } catch (err: any) {
    console.error("Error verifying reset OTP:", err);
    res.status(500).json({ error: "Verification server error: " + err.message });
  }
});

// 5. Complete Password Reset using OTP and New Credentials
expressApp.post("/api/auth/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: "Email, code and new password are required" });
  }
  try {
    const database = ensureDb();
    if (!database) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    
    const snapshot = await database.collection("users").where("email", "==", email.toLowerCase().trim()).get();
    if (snapshot.empty) {
      return res.status(404).json({ error: "User with this email not found." });
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    if (!userData.resetOtp || userData.resetOtp !== code.trim()) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }
    
    // Perform standard password reset on Authentication backend
    await admin.auth().updateUser(snapshot.docs[0].id, { password: newPassword });
    
    // Clear OTP fields in DB
    await userDoc.ref.update({
      resetOtp: admin.firestore.FieldValue.delete()
    });
    
    res.json({ success: true, message: "Your password has been successfully reset!" });
  } catch (err: any) {
    console.error("Error resetting password:", err);
    res.status(500).json({ error: "Internal reset server error: " + err.message });
  }
});

// 6. Secure In-App Account Settings Profile Password Refactor
expressApp.post("/api/auth/update-inapp-password", async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  if (!email || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "Email, current password, and new password are required" });
  }
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (!fs.existsSync(configPath)) {
      return res.status(503).json({ error: "Config file not found." });
    }
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
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

// Vite Middleware
async function startServer() {
  try {
    await authenticateBackendSystem();
  } catch (err) {
    console.error("⚠️ Failed to authenticate backend system account on startup:", err);
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

