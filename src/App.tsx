import React, { useEffect, useState, useRef } from 'react';
import { auth, db } from './firebase';
import { 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  updateDoc,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import IronMan from './components/IronMan';
import Lightning from './components/Lightning';
import { getActiveSecondsForToday, calculateProfit, getBDDate, getBDMidnight, getBDEndOfDay } from "../public/core-engine/mining-math.js";
import { 
  Home, 
  LogIn,
  LogOut, 
  Loader2, 
  Zap, 
  Wallet, 
  Cpu, 
  History, 
  ShoppingCart, 
  TrendingUp,
  Settings,
  CirclePlay,
  RotateCcw,
  Bot,
  ArrowUpRight,
  ArrowDownLeft,
  Package,
  Bell
} from 'lucide-react';

// Bangladesh Time Zone helper wrapper has been imported from the official mining-math engine.

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [miningState, setMiningState] = useState<any>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activePackage, setActivePackage] = useState<any>(null);
  const [userPackages, setUserPackages] = useState<any[]>([]);
  const [hasActiveRobot, setHasActiveRobot] = useState<boolean>(false);
  const [liveIncome, setLiveIncome] = useState(0);
  const currentUser = user;
  const [liveMiningRevenue, setLiveMiningRevenue] = useState<number>(0);
  const [lifespanText, setLifespanText] = useState<string>("");
  const [todayProgress, setTodayProgress] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'home' | 'mining' | 'wallet' | 'history' | 'profile'>('home');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const hasMiningToday = userPackages.some((p: any) => {
    if (!p.miningStartTime) return false;
    let mDate: Date;
    if (typeof p.miningStartTime === 'object' && p.miningStartTime && 'seconds' in p.miningStartTime) {
      mDate = new Date((p.miningStartTime as any).seconds * 1000);
    } else {
      mDate = new Date(p.miningStartTime);
    }
    return getBDDate(mDate) === getBDDate(new Date());
  });

  // Live profit calculation state
  const [liveProfit, setLiveProfit] = useState(0);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [referralCount, setReferralCount] = useState(0);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Bkash");
  const [accountNumber, setAccountNumber] = useState("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchReferralCount = async () => {
      if (!user) return;
      const q = query(collection(db, 'users'), where('referredBy', '==', user.uid));
      const snap = await getDocs(q);
      setReferralCount(snap.size);
    };
    if (user) fetchReferralCount();
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const urlParams = new URLSearchParams(window.location.search);
        const refCode = urlParams.get('ref');

        // Sync Profile
        const userRef = doc(db, 'users', currentUser.uid);
        onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data());
          } else {
            // Initial profile setup
            setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              mainBalance: 0,
              referralEarned: 0,
              hasActiveRobot: false,
              referredBy: refCode || null,
              referralCode: currentUser.uid.slice(0, 8),
              status: 'active',
              createdAt: new Date().toISOString()
            });
          }
        });

        // Listen to Notifications
        const qNotif = query(
          collection(db, 'notifications'),
          where('userId', '==', currentUser.uid),
          orderBy('timestamp', 'desc'),
          limit(20)
        );
        onSnapshot(qNotif, (snap) => {
          setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        // Listen to Mining State
        onSnapshot(doc(db, 'mining_states', currentUser.uid), (doc) => {
          setMiningState(doc.data());
        });

        // Listen to Transactions
        const qTx = query(
          collection(db, 'transactions'),
          where('userId', '==', currentUser.uid),
          orderBy('timestamp', 'desc')
        );
        onSnapshot(qTx, (snap) => {
          setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        // Listen to User Package
        const qPkg = query(
          collection(db, 'user_packages'),
          where('userId', '==', currentUser.uid),
          where('status', '==', 'active'),
          limit(1)
        );
        onSnapshot(qPkg, async (snap) => {
          if (!snap.empty) {
            const up = snap.docs[0].data();
            const pDoc = await getDoc(doc(db, 'packages', up.packageId));
            if (pDoc.exists()) {
              setActivePackage(pDoc.data());
            }
          } else {
            setActivePackage(null);
          }
        });
      }
      setUser(currentUser);
      setAuthLoading(false);
      setLoading(false);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // 3. Add useEffect for real-time data:
  useEffect(() => {
    if (!currentUser) return;
    const now = Timestamp.now();
    const qPkg = query(collection(db, "user_packages"), where("userId", "==", currentUser.uid), where("status", "==", "active"), where("endTime", ">", now));
    const unsubPkg = onSnapshot(qPkg, (snap) => {
      setUserPackages(snap.docs.map(d => ({id: d.id, ...d.data()})));
    });
    const qRobot = query(collection(db, "user_robots"), where("userId", "==", currentUser.uid), where("status", "==", "active"), where("endTime", ">", now));
    const unsubRobot = onSnapshot(qRobot, (snap) => {
      setHasActiveRobot(!snap.empty);
    });
    return () => {unsubPkg(); unsubRobot();};
  }, [currentUser]);

  // 4. Add useEffect for live Tk counter:
  useEffect(() => {
    const interval = setInterval(() => {
      let total = 0;
      const today = getBDDate();
      userPackages.forEach(pkg => {
        const seconds = getActiveSecondsForToday({...pkg, startTime: pkg.startTime, endTime: pkg.endTime, miningStartTime: pkg.miningStartTime}, hasActiveRobot);
        total += calculateProfit(seconds, pkg.dailyProfit);
      });
      setLiveIncome(total);
    }, 1000);
    return () => clearInterval(interval);
  }, [userPackages, hasActiveRobot]);

  // Live Timer Logic
  useEffect(() => {
    if (miningState?.isActive && activePackage && miningState.lastStartTime) {
      if (timerRef.current) clearInterval(timerRef.current);
      
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const durationSeconds = (now - miningState.lastStartTime) / 1000;
        const profitPerSecond = activePackage.dailyProfit / 86400;
        setLiveProfit(durationSeconds * profitPerSecond);
      }, 1000);
    } else {
      setLiveProfit(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [miningState, activePackage]);

  // Core Timer Loop updating pro-rata live revenues and node lifespan countdowns
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const tick = () => {
      // 1. Tk counter
      const isRunning = hasActiveRobot || hasMiningToday;
      if (isRunning && userPackages.length > 0) {
        let totalRevenue = 0;
        userPackages.forEach((p: any) => {
          const daily = typeof p.dailyProfit === 'number' ? p.dailyProfit : (typeof p.daily === 'number' ? p.daily : 0);
          const seconds = getActiveSecondsForToday(p, hasActiveRobot);
          const profit = calculateProfit(seconds, daily);
          totalRevenue += profit;
        });
        setLiveMiningRevenue(totalRevenue);
      } else {
        setLiveMiningRevenue(0);
      }

      // 2. Nodes Lifespan Countdown
      if (userPackages.length > 0) {
        const sorted = [...userPackages].filter((p: any) => p.endTime || p.expiresAt).sort((a: any, b: any) => {
          const tA = new Date(a.endTime || a.expiresAt).getTime();
          const tB = new Date(b.endTime || b.expiresAt).getTime();
          return tA - tB;
        });

        if (sorted.length > 0) {
          const earliest = sorted[0];
          const expDate = new Date(earliest.endTime || earliest.expiresAt);
          const diff = expDate.getTime() - Date.now();
          if (diff <= 0) {
            setLifespanText("Expired");
          } else {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setLifespanText(`${days}d ${hours}h ${minutes}m ${seconds}s`);
          }
        } else {
          setLifespanText("No Lifespan Data");
        }
      } else {
        setLifespanText("");
      }

      // 3. Progress Bar calculation
      const todayStr = getBDDate(new Date());
      const bdMidnightToday = getBDMidnight(todayStr);
      const now = new Date();
      const secondsPassed = Math.max(0, Math.floor((now.getTime() - bdMidnightToday.getTime()) / 1000));
      const pct = Math.min(100, (secondsPassed / 86400) * 100);
      setTodayProgress(pct);
    };

    tick();
    timer = setInterval(tick, 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [userPackages, hasActiveRobot]);

  useEffect(() => {
    const fetchPackages = async () => {
      const snap = await getDocs(collection(db, "packages"));
      setPackages(snap.docs.map(d => d.data()));
    };
    fetchPackages();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      setError("Login failed.");
    }
  };

  const startMining = async () => {
    if (!user) return;
    if (userPackages.length === 0) {
      setError("আপনার কোনো সক্রিয় মাইনিং প্যাকেজ নেই।");
      return;
    }
    setLoading(true);
    try {
      const batch = writeBatch(db);
      userPackages.forEach((pkg: any) => {
        const pkgRef = doc(db, 'user_packages', pkg.id);
        batch.update(pkgRef, {
          miningStartTime: serverTimestamp()
        });
      });
      await batch.commit();
      setSuccess("মাইনিং সফলভাবে শুরু হয়েছে!");
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError("মাইনিং শুরু করতে ব্যর্থ হয়েছে।");
    } finally {
      setLoading(false);
    }
  };

  const buyPackage = async (pkgId: string) => {
    if (!user || !profile) return;
    setLoading(true);
    try {
      const res = await fetch("/api/package/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid, packageId: pkgId })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSuccess("Package purchased successfully!");
        setError(null);
      }
    } catch (err) {
      setError("Purchase failed.");
    } finally {
      setLoading(false);
    }
  };

  const copyReferralLink = () => {
    if (!profile) return;
    const link = `${window.location.origin}?ref=${profile.uid}`;
    navigator.clipboard.writeText(link);
    setSuccess("রেফারেল লিংক কপি করা হয়েছে!");
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleDeposit = async () => {
    if (!user || !amount) return;
    setLoading(true);
    try {
      const res = await fetch("/api/wallet/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid, amount: parseFloat(amount), method })
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSuccess("ডিপোজিট সফল হয়েছে!");
        setIsDepositModalOpen(false);
        setAmount("");
      }
    } catch (err) {
      setError("Deposit failed");
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!user || !amount || !accountNumber) return;
    setLoading(true);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId: user.uid, 
          amount: parseFloat(amount), 
          method,
          account: accountNumber
        })
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSuccess("উত্তোলন সফল হয়েছে!");
        setIsWithdrawModalOpen(false);
        setAmount("");
        setAccountNumber("");
      }
    } catch (err) {
      setError("Withdrawal failed");
    } finally {
      setLoading(false);
    }
  };

  const markNotificationsRead = async () => {
    if (!user || notifications.length === 0) return;
    // For simplicity, we just clear the list in UI or mark all read via Batch
    // Real implementation would use server-side update
    notifications.forEach(async (n) => {
      if (!n.read) {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      }
    });
  };

  const deleteNotifications = async () => {
    if (!user) return;
    // Logic to delete notifications
    setNotifications([]);
  };

  const toggleRobot = async () => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        hasActiveRobot: !profile.hasActiveRobot
      });
    } catch (err) {
      setError("Update failed.");
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b]">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  // Filter transactions
  const walletTransactions = transactions.filter(tx => ['deposit', 'withdrawal'].includes(tx.type));
  const otherTransactions = transactions.filter(tx => !['deposit', 'withdrawal'].includes(tx.type));
  const allTransactions = [...transactions].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Task 4.1 UI flag calculations and handleStartMining helper
  const convertToDateValue = (val: any) => {
    if (!val) return new Date();
    if (typeof val.toDate === 'function') return val.toDate();
    if (val.seconds) return new Date(val.seconds * 1000);
    return new Date(val);
  };

  const noPackage = userPackages.length === 0;
  const isManualRunning = !hasActiveRobot && userPackages.some(p => {
    if (!p.miningStartTime) return false;
    const mDate = convertToDateValue(p.miningStartTime);
    return mDate.toDateString() === new Date().toDateString();
  });
  const showStartButton = !noPackage && !hasActiveRobot && !isManualRunning;
  const isRunning = hasActiveRobot || isManualRunning;
  const totalDaily = userPackages.reduce((sum, p) => sum + (typeof p.dailyProfit === 'number' ? p.dailyProfit : 0), 0);
  const earliestEnd = userPackages.length > 0 ? Math.min(...userPackages.map(p => convertToDateValue(p.endTime).getTime())) : null;

  const handleStartMining = async () => {
    try {
      const batch = writeBatch(db);
      userPackages.forEach(pkg => {
        batch.update(doc(db, "user_packages", pkg.id), { miningStartTime: serverTimestamp() });
      });
      await batch.commit();
      setSuccess("মাইনিং সফলভাবে শুরু হয়েছে!");
    } catch (err: any) {
      setError("মাইনিং শুরু করতে ব্যর্থ হয়েছে: " + err.message);
    }
  };

  const handleClaimReferral = async () => {
    try {
      if (!currentUser) return;
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/claim-referral', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(data.message);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-gray-100 font-sans selection:bg-cyan-500/30 pb-24">
      <AnimatePresence mode="wait">
        {!user ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="min-h-screen flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-500/10 via-transparent to-transparent"
          >
            <div className="relative mb-8">
              <div className="absolute -inset-4 bg-cyan-500/20 blur-2xl rounded-full" />
              <Cpu className="w-16 h-16 text-cyan-400 relative" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter mb-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              PROFIT PULSE
            </h1>
            <p className="text-gray-500 mb-10 text-center max-w-xs">
              AI চালিত মাইনিং এবং আর্নিং প্ল্যাটফর্ম। প্রতি সেকেন্ডে প্রফিট জেনারেট করুন।
            </p>
            <button
              onClick={handleLogin}
              className="flex items-center gap-4 bg-white/5 border border-white/10 hover:border-cyan-500/50 hover:bg-white/10 px-8 py-4 rounded-2xl transition-all active:scale-95 group"
            >
              <LogIn className="w-5 h-5 text-cyan-400 group-hover:rotate-12 transition-transform" />
              <span className="font-semibold text-lg">গুগল দিয়ে শুরু করুন</span>
            </button>
          </motion.div>
        ) : (
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto px-4 py-8"
          >
            {/* Notifications and Error Toast */}
            <div className="fixed top-4 left-0 right-0 z-50 pointer-events-none flex flex-col items-center gap-2">
              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="pointer-events-auto p-4 bg-red-500 text-white rounded-2xl shadow-xl flex items-center gap-3 text-sm font-bold min-w-[300px]"
                  >
                    <Zap className="w-5 h-5" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto px-2">×</button>
                  </motion.div>
                )}
                {success && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="pointer-events-auto p-4 bg-green-500 text-white rounded-2xl shadow-xl flex items-center gap-3 text-sm font-bold min-w-[300px]"
                  >
                    <Zap className="w-5 h-5" />
                    {success}
                    <button onClick={() => setSuccess(null)} className="ml-auto px-2">×</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* TAB VIEWS */}
            {activeTab === 'home' && (
              <div>
                <header className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <img src={user.photoURL || ""} alt="" className="w-12 h-12 rounded-2xl border border-white/10" />
                    <div>
                      <h2 className="text-lg font-bold">{user.displayName}</h2>
                      <p className="text-xs text-gray-500">স্বাগতম, আপনার ড্যাশবোর্ডে</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button 
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="p-3 bg-white/5 border border-white/10 rounded-xl relative hover:bg-white/10 transition-all"
                      >
                        <Bell className="w-5 h-5 text-gray-400" />
                        {notifications.filter(n => !n.read).length > 0 && (
                          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-[#141416]" />
                        )}
                      </button>

                      <AnimatePresence>
                        {showNotifications && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                            <motion.div 
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 10, scale: 0.95 }}
                              className="absolute right-0 mt-2 w-80 bg-[#1c1c1f] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden"
                            >
                              <div className="p-4 border-b border-white/5 flex justify-between items-center">
                                <h4 className="font-bold">নোটিফিকেশন</h4>
                                <button 
                                  onClick={deleteNotifications}
                                  className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest"
                                >
                                  সব মুছে দিন
                                </button>
                              </div>
                              <div className="max-h-96 overflow-y-auto">
                                {notifications.length === 0 ? (
                                  <div className="p-8 text-center text-gray-500 text-xs">কোনো নোটিফিকেশন নেই</div>
                                ) : (
                                  notifications.map(n => (
                                    <div 
                                      key={n.id} 
                                      onClick={() => updateDoc(doc(db, 'notifications', n.id), { read: true })}
                                      className={`p-4 border-b border-white/5 cursor-pointer transition-colors ${n.read ? 'opacity-60' : 'bg-cyan-500/5'}`}
                                    >
                                      <p className="text-sm font-bold mb-1">{n.title}</p>
                                      <p className="text-xs text-gray-400 leading-relaxed">{n.message}</p>
                                      <p className="text-[9px] text-gray-600 mt-2 font-bold uppercase">{new Date(n.timestamp).toLocaleString()}</p>
                                    </div>
                                  ))
                                )}
                              </div>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                    <button onClick={() => setActiveTab('profile')} className="p-3 bg-white/5 border border-white/10 rounded-xl">
                      <Settings className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </header>

                <div className="bg-[#141416] border border-white/5 p-8 rounded-3xl mb-6 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Wallet className="w-32 h-32" />
                  </div>
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">মোট ব্যালেন্স</p>
                  <div className="flex items-end gap-2 mb-6">
                    <span className="text-5xl font-black text-white">৳{(profile?.mainBalance || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setIsDepositModalOpen(true)} className="flex-1 bg-cyan-500 text-black font-black py-4 rounded-2xl hover:bg-cyan-400 transition-all active:scale-95">ডিপোজিট</button>
                    <button onClick={() => setIsWithdrawModalOpen(true)} className="flex-1 bg-white/5 border border-white/10 text-white font-black py-4 rounded-2xl hover:bg-white/10 transition-all active:scale-95">উত্তোলন</button>
                  </div>
                </div>

                {noPackage ? (
                  <div className="space-y-4 mb-6" id="inactive-user-banners">
                    {/* Banner 1: অ্যাকাউন্ট অ্যাক্টিভ করুন */}
                    <div className="banner bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 p-6 rounded-3xl relative overflow-hidden flex items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
                          <h4 className="font-extrabold text-amber-400 text-sm tracking-wide uppercase">অ্যাকাউন্ট অ্যাক্টিভ করুন</h4>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed max-w-sm">
                          আপনার ক্লাউড মাইনিং ইনফ্রাস্ট্রাকচার আনলক করতে ব্যালেন্স ডিপোজিট করুন এবং যেকোনো মাইনিং রিগ সচল করুন।
                        </p>
                      </div>
                      <button 
                        onClick={() => setIsDepositModalOpen(true)}
                        className="bg-amber-400 text-black text-xs font-black px-5 py-3 rounded-2xl hover:bg-amber-300 transition-all active:scale-95 whitespace-nowrap"
                      >
                        ডিপোজিট করুন
                      </button>
                    </div>

                    {/* Banner 2: প্যাকেজ কিনুন */}
                    <div className="banner bg-gradient-to-r from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 p-6 rounded-3xl relative overflow-hidden flex items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
                          <h4 className="font-extrabold text-cyan-400 text-sm tracking-wide uppercase">প্যাকেজ কিনুন</h4>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed max-w-sm">
                          ১২টি ডিসেন্ট্রালাইজড স্টেবল আল্ট্রা-রিগসের যেকোনো একটি প্যাকেজ বেছে নিয়ে আজই অটোমেটেড মাইনিং শুরু করুন।
                        </p>
                      </div>
                      <button 
                        onClick={() => setActiveTab('mining')}
                        className="bg-cyan-500 text-black text-xs font-black px-5 py-3 rounded-2xl hover:bg-cyan-400 transition-all active:scale-95 whitespace-nowrap"
                      >
                        প্যাকেজ কিনুন
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mining-card relative bg-[#141416]/95 border border-white/5 p-8 rounded-3xl mb-6 overflow-visible group" id="unified-premium-mining-card">
                    {hasActiveRobot && (
                      <>
                        <IronMan />
                        <Lightning />
                      </>
                    )}

                    <div className="header flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-2xl border ${hasActiveRobot ? 'bg-cyan-500/20 border-cyan-500/40' : 'bg-white/5 border-white/10'}`}>
                          <Cpu className={`w-6 h-6 ${hasActiveRobot ? 'text-cyan-400 animate-spin-slow' : 'text-gray-400'}`} />
                        </div>
                        <div>
                          <span className="font-black text-white text-md block leading-tight">LIVE MININGSTACK</span>
                          <span className="text-xs text-gray-500 block mt-1">
                            {userPackages.length} Active Cloud Rigs
                          </span>
                        </div>
                      </div>

                      {isRunning && (
                        <span className="badge flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest text-emerald-400 uppercase">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          RUNNING
                        </span>
                      )}
                    </div>

                    <div className="total-daily mb-4 text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                      <span>Total Daily:</span>
                      <span className="text-white text-sm font-black font-mono">৳{totalDaily.toFixed(2)}</span>
                    </div>

                    <div className="mb-6 bg-white/5 p-5 rounded-2xl border border-white/5">
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1.5">লাইভ মাইনিং রেভিনিউ (আজ)</p>
                      <div className="live-counter text-3xl font-black text-cyan-400 font-mono tracking-tight">
                        ৳{liveIncome.toFixed(4)}
                      </div>
                    </div>

                    <div className="nodes text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6">
                      NODES LIFESPAN: <span className="text-amber-400 font-mono text-xs font-black">{earliestEnd ? new Date(earliestEnd).toLocaleDateString() : '-'}</span>
                    </div>

                    {showStartButton && (
                      <button 
                        onClick={handleStartMining}
                        className="w-full bg-cyan-500 text-black py-4 rounded-2xl font-black hover:bg-cyan-400 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
                      >
                        <CirclePlay className="w-5 h-5 text-black" /> START MINING
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <button 
                    onClick={copyReferralLink}
                    className="bg-[#141416] p-6 rounded-3xl border border-white/5 text-left group hover:border-cyan-500/30 transition-all"
                  >
                    <p className="text-gray-500 text-[10px] font-bold uppercase mb-2">রেফার আর্নিং</p>
                    <p className="text-2xl font-black text-green-400">৳{(profile?.referralEarned || 0).toFixed(2)}</p>
                    <p className="text-[9px] text-gray-600 mt-2 font-bold uppercase group-hover:text-cyan-400">লিংক কপি করুন</p>
                  </button>
                  <div className="bg-[#141416] p-6 rounded-3xl border border-white/5">
                    <p className="text-gray-500 text-[10px] font-bold uppercase mb-2">এক্টিভ প্যাকেজ</p>
                    <p className="text-2xl font-black text-cyan-400">{activePackage ? activePackage.name : 'নাই'}</p>
                  </div>
                </div>

                <section className="mb-20">
                  <h3 className="text-xl font-black mb-4">ডেইলি টাস্ক</h3>
                  <div className="space-y-3">
                    <div className="bg-[#141416] p-4 rounded-2xl flex items-center gap-4 border border-white/5">
                      <div className="w-12 h-12 bg-cyan-500/10 rounded-xl flex items-center justify-center">
                        <Zap className="text-cyan-400" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-sm">টেলিগ্রাম গ্রুপে জয়েন করুন</p>
                        <p className="text-xs text-green-400">পুরস্কার: ৳৫.০০</p>
                      </div>
                      <button className="bg-white/5 px-4 py-2 rounded-lg text-xs font-bold">সম্পন্ন করুন</button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'mining' && (
              <div>
                <h2 className="text-3xl font-black mb-8">মাইনিং সেন্টার</h2>
                
                <div className="bg-gradient-to-br from-cyan-600 to-blue-700 p-8 rounded-3xl mb-8 relative overflow-hidden">
                   <div className="relative z-10">
                      <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-2">লাইভ প্রফিট জেনারেটর</p>
                      <div className="text-5xl font-black mb-8">৳{liveProfit.toFixed(6)}</div>
                      
                      <div className="flex gap-4">
                        {!miningState?.isActive ? (
                          <button onClick={startMining} className="bg-white text-black px-8 py-4 rounded-2xl font-black flex items-center gap-2">
                            <CirclePlay className="w-6 h-6" /> মাইনিং শুরু করুন
                          </button>
                        ) : (
                          <div className="bg-white/20 border border-white/30 backdrop-blur-md px-8 py-4 rounded-2xl font-black flex items-center gap-2">
                            <RotateCcw className="w-6 h-6 animate-spin-slow" /> মাইনিং চলছে
                          </div>
                        )}
                      </div>
                   </div>
                   <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl" />
                </div>

                <h3 className="text-xl font-black mb-4 flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-cyan-500" /> শপ
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {packages.map((pkg) => (
                    <div key={pkg.id} className={`bg-[#141416] p-6 rounded-3xl border ${activePackage?.id === pkg.id ? 'border-cyan-500' : 'border-white/5'}`}>
                      <h4 className="font-bold text-lg mb-1">{pkg.name}</h4>
                      <p className="text-2xl font-black text-cyan-400 mb-4">৳{pkg.price}</p>
                      <div className="space-y-2 mb-6 text-xs text-gray-500">
                        <div className="flex justify-between"><span>দৈনিক আয়</span> <span className="text-green-400">৳{pkg.dailyProfit}</span></div>
                        <div className="flex justify-between"><span>মেয়াদ</span> <span>৩০ দিন</span></div>
                      </div>
                      <button 
                        onClick={() => buyPackage(pkg.id)}
                        disabled={activePackage?.id === pkg.id || loading}
                        className={`w-full py-4 rounded-2xl font-bold bg-white text-black active:scale-95 transition-all ${activePackage?.id === pkg.id && 'opacity-30'}`}
                      >
                        {activePackage?.id === pkg.id ? 'এক্টিভ আছে' : 'কিনুন'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'wallet' && (
              <div>
                <h2 className="text-3xl font-black mb-8">ওয়ালেট</h2>
                <div className="bg-[#141416] p-8 rounded-4xl border border-white/5 mb-8">
                  <p className="text-gray-500 text-xs font-bold uppercase mb-2">ব্যালেন্স</p>
                  <p className="text-5xl font-black mb-8">৳{(profile?.mainBalance || 0).toFixed(2)}</p>
                  <div className="flex gap-4">
                    <button onClick={() => setIsDepositModalOpen(true)} className="flex-1 bg-green-500 text-black py-4 rounded-2xl font-black transition-all active:scale-95">ডিপোজিট</button>
                    <button onClick={() => setIsWithdrawModalOpen(true)} className="flex-1 bg-amber-500 text-black py-4 rounded-2xl font-black transition-all active:scale-95">উত্তোলন</button>
                  </div>
                </div>

                <h3 className="text-lg font-bold mb-4">ওয়ালেট লেনদেন</h3>
                <div className="space-y-3">
                  {walletTransactions.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 text-sm">কোনো লেনদেন পাওয়া যায়নি</div>
                  ) : (
                    walletTransactions.map(tx => (
                      <div key={tx.id} className="bg-[#141416] p-4 rounded-2xl flex items-center justify-between border border-white/5">
                         <div className="flex items-center gap-4">
                           <div className={`p-3 rounded-xl ${tx.amount > 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                             {tx.amount > 0 ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                           </div>
                           <div>
                             <p className="text-sm font-bold">{tx.description}</p>
                             <p className="text-[10px] text-gray-500 uppercase font-bold">{new Date(tx.timestamp).toLocaleString()}</p>
                           </div>
                         </div>
                         <span className={`font-black ${tx.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                           {tx.amount > 0 ? "+" : ""}৳{tx.amount?.toFixed(2)}
                         </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div>
                <h2 className="text-3xl font-black mb-8">অ্যাকাউন্ট হিস্ট্রি</h2>
                <div className="space-y-3">
                  {allTransactions.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 text-sm">কোনো হিস্ট্রি পাওয়া যায়নি</div>
                  ) : (
                    allTransactions.map(tx => (
                      <div key={tx.id} className="bg-[#141416] p-4 rounded-2xl flex items-center justify-between border border-white/5">
                         <div className="flex items-center gap-4">
                           <div className={`p-3 rounded-xl ${
                             tx.type === 'mining_profit' ? "bg-cyan-500/10 text-cyan-400" : 
                             tx.type === 'deposit' ? "bg-green-500/10 text-green-400" :
                             tx.type === 'withdrawal' ? "bg-amber-500/10 text-amber-400" :
                             "bg-purple-500/10 text-purple-400"
                           }`}>
                             {tx.type === 'mining_profit' ? <Zap className="w-4 h-4" /> : 
                              tx.type === 'deposit' ? <ArrowDownLeft className="w-4 h-4" /> :
                              tx.type === 'withdrawal' ? <ArrowUpRight className="w-4 h-4" /> :
                              <Package className="w-4 h-4" />}
                           </div>
                           <div>
                             <p className="text-sm font-bold">{tx.description}</p>
                             <p className="text-[10px] text-gray-500 uppercase font-bold">{new Date(tx.timestamp).toLocaleString()}</p>
                           </div>
                         </div>
                         <span className={`font-black ${tx.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                           {tx.amount > 0 ? "+" : ""}৳{tx.amount?.toFixed(2)}
                         </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="pb-10">
                <h2 className="text-3xl font-black mb-8">প্রোফাইল</h2>
                
                <div className="bg-[#141416] p-8 rounded-4xl border border-white/5 mb-6 text-center">
                  <img src={user.photoURL || ""} alt="" className="w-24 h-24 rounded-3xl mx-auto mb-4 border-2 border-cyan-500" />
                  <h3 className="text-2xl font-black">{profile?.displayName}</h3>
                  <p className="text-gray-500 text-sm mb-6">{profile?.email}</p>
                  
                  <div className="bg-white/5 p-4 rounded-2xl text-left mb-6">
                    <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">আপনার রেফারেল লিংক</p>
                    <div className="flex items-center justify-between gap-4">
                      <code className="text-[10px] truncate block text-cyan-400/80">{`${window.location.origin}?ref=${profile?.uid}`}</code>
                      <button onClick={copyReferralLink} className="p-2 bg-cyan-500 text-black rounded-lg hover:scale-105 active:scale-95 transition-all">
                        <History className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Referral Commission Balance & Claim Button Card */}
                  <div className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20 p-5 rounded-2xl text-left mb-6 flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-[10px] font-bold uppercase mb-1">রেফারেল কমিশন ব্যালেন্স</p>
                      <p className="text-2xl font-black text-cyan-400 font-mono">৳{(profile?.referralCommissionBalance || 0).toFixed(2)}</p>
                    </div>
                    <button 
                      onClick={handleClaimReferral}
                      className="px-5 py-3 bg-cyan-500 text-black font-black rounded-xl text-xs hover:bg-cyan-400 active:scale-95 transition-all shadow-lg shadow-cyan-500/20"
                    >
                      ক্লেম করুন
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-white/5 p-4 rounded-2xl">
                      <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">টোটাল রেফার</p>
                      <p className="text-xl font-black text-white">{referralCount}</p>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl text-cyan-400">
                      <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">লেভেল ১ (১০%)</p>
                      <p className="text-xl font-black">{((profile?.referralEarned || 0) * 0.8).toFixed(2)}</p>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl text-purple-400">
                      <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">লেভেল ২ (২.৫%)</p>
                      <p className="text-xl font-black">{((profile?.referralEarned || 0) * 0.2).toFixed(2)}</p>
                    </div>
                  </div>

                  <button onClick={() => signOut(auth)} className="w-full py-4 bg-red-500/10 border border-red-500/20 text-red-400 font-bold rounded-2xl flex items-center justify-center gap-2">
                    <LogOut className="w-5 h-5" /> লগ আউট
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="bg-[#141416] p-6 rounded-3xl border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Bot className="text-cyan-400" />
                      <div>
                        <p className="font-bold">রোবট অ্যাসিস্ট্যান্ট</p>
                        <p className="text-xs text-gray-500">অটো-মাইনিং শুরু করে</p>
                      </div>
                    </div>
                    <button onClick={toggleRobot} className={`px-4 py-2 rounded-xl text-xs font-black ${profile?.hasActiveRobot ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-500'}`}>
                      {profile?.hasActiveRobot ? 'এক্টিভ' : 'বন্ধ'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTTOM NAVIGATION */}
      {user && (
        <nav className="fixed bottom-0 left-0 right-0 bg-[#141416]/95 backdrop-blur-2xl border-t border-white/5 px-6 py-4 z-50 flex items-center justify-between max-w-2xl mx-auto">
          <NavItem icon={<Home className="w-6 h-6" />} label="হোম" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
          <NavItem icon={<Cpu className="w-6 h-6" />} label="মাইনিং" active={activeTab === 'mining'} onClick={() => setActiveTab('mining')} />
          <NavItem icon={<Wallet className="w-6 h-6" />} label="ওয়ালেট" active={activeTab === 'wallet'} onClick={() => setActiveTab('wallet')} />
          <NavItem icon={<History className="w-6 h-6" />} label="হিস্ট্রি" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          <NavItem icon={<div className="w-8 h-8 rounded-xl bg-white/10 overflow-hidden ring-2 ring-transparent transition-all"><img src={user.photoURL || ""} className="w-full h-full object-cover" /></div>} label="প্রোফাইল" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </nav>
      )}

      {/* TRANSACTION MODALS */}
      <AnimatePresence>
        {(isDepositModalOpen || isWithdrawModalOpen) && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => { setIsDepositModalOpen(false); setIsWithdrawModalOpen(false); }}
            />
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="relative w-full max-w-md bg-[#1c1c1f] rounded-3xl p-8 border border-white/10"
            >
              <h3 className="text-2xl font-black mb-6">{isDepositModalOpen ? 'ডিপোজিট' : 'উত্তোলন'}</h3>
              
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-[10px] font-bold uppercase text-gray-500 mb-2 block">মেথড সিলেক্ট করুন</label>
                  <div className="flex gap-2">
                    {['Bkash', 'Nagad', 'Rocket'].map(m => (
                      <button 
                        key={m}
                        onClick={() => setMethod(m)}
                        className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all ${method === m ? 'bg-cyan-500 border-cyan-500 text-black' : 'border-white/10 text-gray-400'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-gray-500 mb-2 block">পরিমাণ (৳)</label>
                  <input 
                    type="number" 
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 focus:outline-none focus:border-cyan-500 transition-all font-bold"
                  />
                </div>

                {isWithdrawModalOpen && (
                  <div>
                    <label className="text-[10px] font-bold uppercase text-gray-500 mb-2 block">অ্যাকাউন্ট নাম্বার</label>
                    <input 
                      type="text" 
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="017xxxxxxxx"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 focus:outline-none focus:border-cyan-500 transition-all font-bold"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => { setIsDepositModalOpen(false); setIsWithdrawModalOpen(false); }}
                  className="flex-1 py-4 rounded-2xl font-bold bg-white/5 border border-white/10 text-gray-400"
                >
                  বাতিল
                </button>
                <button 
                  onClick={isDepositModalOpen ? handleDeposit : handleWithdraw}
                  disabled={loading}
                  className="flex-1 py-4 rounded-2xl font-black bg-cyan-500 text-black disabled:opacity-50"
                >
                  {loading ? 'প্রসেসিং...' : 'কনফার্ম'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-cyan-400 scale-110' : 'text-gray-500 opacity-60'}`}>
      <div className={`p-2 rounded-xl transition-all ${active ? 'bg-cyan-500/10' : ''}`}>
        {icon}
      </div>
      <span className="text-[11px] font-black uppercase tracking-tighter">{label}</span>
      {active && <motion.div layoutId="nav_indicator" className="w-1 h-1 rounded-full bg-cyan-400 mt-0.5" />}
    </button>
  );
}

