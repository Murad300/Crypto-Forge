import { onSnapshot, doc, collection, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Listen for admin config (Payment numbers, logos, notice)
function initAdminConfigListener(db) {
    onSnapshot(doc(db, 'admin', 'config'), (snap) => {
        if (snap.exists()) {
            window.adminConfig = snap.data();
            
            // Execute global rendering callbacks defined by index.html template design
            if (typeof window.updateDepositUI === 'function') window.updateDepositUI();
            if (typeof window.updateWithdrawStatus === 'function') window.updateWithdrawStatus();
            if (typeof window.updateDepositStatus === 'function') window.updateDepositStatus();
            
            // Show notice if exists
            const noticeEl = document.getElementById('maintenanceNotice');
            if (window.adminConfig.notice) {
                if (noticeEl) {
                    noticeEl.innerHTML = `<div class="activation-banner"><i class="fa-solid fa-bullhorn" style="font-size:16px"></i> ${window.adminConfig.notice}</div>`;
                    noticeEl.style.display = 'block';
                }
            } else {
                if (noticeEl) {
                    noticeEl.style.display = 'none';
                    noticeEl.innerHTML = '';
                }
            }
        }
    });
}

// Real-time listener for packages
let packageFetchTimeout = null;
 function initPackagesListener(db) {
    onSnapshot(query(collection(db, 'packages'), where('status', '==', 'active'), orderBy('price', 'asc')), (snap) => {
        if (!snap.empty) {
            window.availablePackages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        if (typeof window.renderPackages === 'function') window.renderPackages();
        
        // Use debounced auto-mining check
        if (packageFetchTimeout) clearTimeout(packageFetchTimeout);
        if (typeof window.automateMiningWithRobots === 'function') {
            packageFetchTimeout = setTimeout(window.automateMiningWithRobots, 3000);
        }
    }, (err) => {
        console.error("Firestore Packages snapshot error:", err);
    });
}

// Real-time listener for robots config
function initRobotsConfigListener(db) {
    onSnapshot(query(collection(db, 'robots_config'), orderBy('price', 'asc')), (snap) => {
        const robots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (robots.length > 0) {
            window.availableRobots = robots;
            console.log("Robots synchronized from DB:", robots.length);
        } else {
            console.warn("Robots collection is empty. Using static defaults.");
        }
        if (typeof window.renderPackages === 'function') window.renderPackages();
    }, (err) => {
        console.warn("Robots Config Listener Error (using static fallback):", err);
    });
}

// Token-Based Auto-Login Handler
window.handleTokenAutoLogin = async (customToken, email) => {
    const auth = window.auth;
    if (!auth) throw new Error("Authentication module not loaded of CryptoForge Core.");
    
    try {
        await signInWithCustomToken(auth, customToken);
        
        // Dynamically transition and render standard active dashboard layout without locking/freezing
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        const appView = document.getElementById('appView');
        if (appView) {
            appView.classList.add('active');
        }
    } catch (compatErr) {
        console.warn("Custom token auto-login failed: ", compatErr.message);
        if (!auth.currentUser) throw compatErr;
    }
};

// Global finished jobs set to prevent double submission
let completedJobsSet = new Set();
async function autoCompleteJob(packageId, customUserId) {
    if (completedJobsSet.has(packageId)) return;
    completedJobsSet.add(packageId);

    const uid = customUserId || (window.auth?.currentUser?.uid);
    if (!uid) return;

    try {
        const response = await fetch('/api/mining/complete-finished-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid, packageId })
        });
        const resData = await response.json();
        if (resData.success) {
            if (typeof window.showToast === 'function') {
                window.showToast('success', 'Mining Shift Finished! 🎉', `৳${resData.profit.toFixed(2)} credited directly to main balance.`);
            }
        }
    } catch (e) {
        console.error("Error auto completing finished job:", e);
    } finally {
        completedJobsSet.delete(packageId);
    }
}

// Robust Bangladesh Dhaka timezone Date creator
window.getDhakaDate = (date = new Date()) => {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Dhaka',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
        const parts = formatter.formatToParts(date);
        const year = parseInt(parts.find(p => p.type === 'year').value, 10);
        const month = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
        const day = parseInt(parts.find(p => p.type === 'day').value, 10);
        const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
        const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
        const second = parseInt(parts.find(p => p.type === 'second').value, 10);
        const dDate = new Date(year, month, day, hour, minute, second);
        if (isNaN(dDate.getTime())) throw new Error("Parsed date is NaN");
        return dDate;
    } catch (e) {
        // Safe robust fallback calculations for safari/older browser
        const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
        return new Date(utc + (3600000 * 6)); // Dhaka is UTC+6
    }
};

// Second-by-Second Pro-Rata Profit Calculations & Active Renderings
window.updateMiningUI = () => {
    const homeMiningList = document.getElementById('homeMiningList');
    if (!homeMiningList) return;

    // Direct dynamic style injection for cybernetic aesthetics
    if (!document.getElementById('cyber-mining-styles')) {
        const style = document.createElement('style');
        style.id = 'cyber-mining-styles';
        style.innerHTML = `
            @keyframes smoothCPURotate {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            @keyframes arcFlicker {
                0% { stroke-dashoffset: 40; }
                100% { stroke-dashoffset: 0; }
            }
            @keyframes pulseBorder {
                0%, 100% { border-color: rgba(9, 132, 227, 0.25); box-shadow: 0 0 15px rgba(9, 132, 227, 0.08), 0 0 30px rgba(255, 215, 0, 0.05); }
                50% { border-color: rgba(9, 132, 227, 0.65); box-shadow: 0 0 25px rgba(9, 132, 227, 0.25), 0 0 50px rgba(255, 215, 0, 0.15); }
            }
            @keyframes capeWave {
                0% { transform: rotate(-12deg) scaleY(1); }
                100% { transform: rotate(-24deg) scaleY(1.12); }
            }
            @keyframes capeWaveRight {
                0% { transform: rotate(12deg) scaleY(1); }
                100% { transform: rotate(24deg) scaleY(1.12); }
            }
            @keyframes armWave {
                0%, 100% { transform: rotate(-10deg); }
                50% { transform: rotate(-55deg); }
            }
            @keyframes armWaveRight {
                0%, 100% { transform: rotate(10deg); }
                50% { transform: rotate(55deg); }
            }
            @keyframes legMove {
                0%, 100% { transform: scaleY(1); }
                50% { transform: scaleY(0.65) translateY(-1px); }
            }
            @keyframes armVibrate {
                0% { transform: rotate(-105deg) translateY(0); }
                100% { transform: rotate(-103deg) translateY(-0.5px); }
            }
            .premium-cyber-card {
                 background: #E3F2FD !important;
                 backdrop-filter: blur(12px) !important;
                 border: 1.5px solid #BBDEFB !important;
                 box-shadow: 0 10px 30px rgba(9, 132, 227, 0.08) !important;
                 position: relative;
                 overflow: visible !important;
                 border-radius: 24px !important;
                 padding: 26px 22px !important;
                 margin-bottom: 24px !important;
                 color: #2D3436 !important;
                 min-height: 200px !important;
                 display: flex !important;
                 flex-direction: column !important;
                 justify-content: space-between !important;
                 transition: all 0.3s ease;
             }
             @keyframes electricFlash {
                 0%, 100% {
                     color: #0984E3;
                     filter: drop-shadow(0 0 2px rgba(9, 132, 227, 0.3)) brightness(1);
                 }
                 15% {
                     color: #FFD700;
                     filter: drop-shadow(0 0 8px #FFD700) brightness(1.5);
                     transform: scale(1.1) rotate(1deg);
                 }
                 18% {
                     color: #0984E3;
                     filter: drop-shadow(0 0 4px rgba(9, 132, 227, 0.5)) brightness(1.2);
                     transform: scale(1) rotate(-1deg);
                 }
                 45% {
                     color: #0984E3;
                     filter: drop-shadow(0 0 2px rgba(9, 132, 227, 0.3)) brightness(1);
                 }
                 48% {
                     color: #FFD700;
                     filter: drop-shadow(0 0 10px #FFD700) brightness(1.6);
                     transform: scale(1.15) rotate(2deg);
                 }
                 52% {
                     color: #0984E3;
                     filter: drop-shadow(0 0 3px rgba(9, 132, 227, 0.5)) brightness(1.1);
                     transform: scale(1) rotate(0deg);
                 }
                 85% {
                     color: #0984E3;
                     filter: drop-shadow(0 0 2px rgba(9, 132, 227, 0.3)) brightness(1);
                 }
             }
             .electric-cpu-flash {
                 animation: electricFlash 2.5s infinite ease-in-out !important;
             }
             .rotating-cpu-icon {
                 animation: smoothCPURotate 6s infinite linear !important;
             }
             .rotating-cpu-always {
                 animation: smoothCPURotate 4s linear infinite !important;
                 display: inline-block;
             }
             .animated-robot .robot-arm-left {
                 animation: armWave 1.2s infinite ease-in-out;
             }
             .animated-robot .robot-arm-right {
                 animation: armWaveRight 1.2s infinite ease-in-out;
             }
             .animated-robot .robot-leg-left {
                 animation: legMove 0.6s infinite ease-in-out alternate;
             }
             .animated-robot .robot-leg-right {
                 animation: legMove 0.6s infinite ease-in-out alternate-reverse;
             }
             @keyframes liquidWave {
                 0% { background-position: 0% 50%; }
                 50% { background-position: 100% 50%; }
                 100% { background-position: 0% 50%; }
             }
             @keyframes monogramSpin {
                 0% { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 3px rgba(9, 132, 227, 0.4)); }
                 50% { transform: rotate(180deg) scale(1.18); filter: drop-shadow(0 0 8px #0984E3) brightness(1.25); }
                 100% { transform: rotate(360deg) scale(1); filter: drop-shadow(0 0 3px rgba(9, 132, 227, 0.4)); }
             }
             @keyframes jellyWaveBackground {
                 0% {
                     background: radial-gradient(circle at 15% 20%, rgba(237, 28, 36, 0.05) 0%, #E3F2FD 65%, #FFFFFF 100%) !important;
                     border-radius: 18px 22px 18px 22px;
                 }
                 50% {
                     background: radial-gradient(circle at 85% 80%, rgba(9, 132, 227, 0.04) 0%, #E3F2FD 55%, #FFFFFF 100%) !important;
                     border-radius: 22px 18px 24px 18px;
                 }
                 100% {
                     background: radial-gradient(circle at 35% 85%, rgba(237, 28, 36, 0.06) 0%, #E3F2FD 70%, #FFFFFF 100%) !important;
                     border-radius: 18px 24px 18px 24px;
                 }
             }
             @keyframes slowSpin {
                 0% { transform: translate(-50%, -50%) rotate(0deg); }
                 100% { transform: translate(-50%, -50%) rotate(360deg); }
             }
             @keyframes lightningFlicker {
                 0%, 100% { opacity: 0.9; }
                 12% { opacity: 0.2; }
                 24% { opacity: 1; }
                 36% { opacity: 0.4; }
                 48% { opacity: 1; }
                 60% { opacity: 0.15; }
                 72% { opacity: 0.85; }
                 84% { opacity: 0.3; }
             }
             .superman-cape {
                 position: absolute;
                 top: 6px;
                 left: -1px;
                 width: 10px;
                 height: 24px;
                 background: linear-gradient(135deg, #FF1E56, #D10034);
                 border-radius: 4px 0 8px 12px;
                 transform: rotate(-15deg);
                 z-index: 1;
                 opacity: 0.95;
                 box-shadow: -2px 4px 6px rgba(0,0,0,0.15);
                 animation: capeWave 1s infinite alternate ease-in-out;
             }
             .superman-cape-right {
                 position: absolute;
                 top: 6px;
                 right: -1px;
                 width: 10px;
                 height: 24px;
                 background: linear-gradient(-135deg, #FF1E56, #D10034);
                 border-radius: 0 4px 12px 8px;
                 transform: rotate(15deg);
                 z-index: 1;
                 opacity: 0.95;
                 box-shadow: 2px 4px 6px rgba(0,0,0,0.15);
                 animation: capeWaveRight 1.2s infinite alternate ease-in-out;
             }
             .total-processing-box {
                 margin-bottom: 20px;
                 padding: 16px 14px;
                 background: rgba(9, 132, 227, 0.05);
                 border-radius: 18px;
                 border: 1.5px solid rgba(9, 132, 227, 0.2);
                 position: relative;
                 overflow: hidden;
                 display: flex;
                 align-items: center;
                 justify-content: space-between;
                 box-shadow: inset 0 0 15px rgba(9, 132, 227, 0.02);
                 transition: all 0.5s ease-in-out;
             }
             .total-processing-box.jelly-processing-active {
                 animation: jellyWaveBackground 6s ease-in-out infinite alternate !important;
                 border-color: rgba(9, 132, 227, 0.4) !important;
                 box-shadow: inset 0 0 25px rgba(9, 132, 227, 0.15), 0 4px 20px rgba(9, 132, 227, 0.15) !important;
             }
             .slow-spinning-bg {
                 animation: slowSpin 24s linear infinite;
                 position: absolute;
                 top: 50%;
                 left: 50%;
                 transform: translate(-50%, -50%);
                 width: 70px;
                 height: 70px;
                 opacity: 0.1;
                 pointer-events: none;
                 z-index: 1;
                 filter: drop-shadow(0 0 10px rgba(9, 132, 227, 0.2));
                 transition: opacity 0.5s ease;
             }
             .liquid-progress-fill {
                 background: linear-gradient(90deg, #0984E3 0%, #3498db 50%, #00f0ff 100%) !important;
                 background-size: 200% 200% !important;
                 animation: liquidWave 4s ease infinite !important;
             }
             .logo-pulsing-monogram {
                 animation: monogramSpin 4s linear infinite !important;
                 display: inline-block;
             }
        `;
        document.head.appendChild(style);
    }

    const pkgs = window.purchasedPackages || window.myActivePkgs || [];
    const now = new Date();
    
    // Filter activePkgs to ensure strict product separation (exclude any robot data)
    const activePkgs = pkgs.filter(item => {
        const isRobot = item.id?.includes('robot') || 
                        item.packageId?.includes('robot') || 
                        item.productType === 'robot' || 
                        item.packageName?.toLowerCase().includes('bot') || 
                        item.name?.toLowerCase().includes('bot');
        if (isRobot) return false;

        if (!item.expiresAt) return true;
        const exp = new Date(item.expiresAt);
        return exp > now;
    });

    if (activePkgs.length === 0) {
        homeMiningList.innerHTML = `
            <div style="text-align:center; padding:32px 16px; color:var(--muted); background:var(--card); border-radius:16px;">
                <i class="fa-solid fa-server" style="font-size:32px; opacity:0.2; margin-bottom:12px; display:block"></i>
                <h5 style="margin:0 0 4px 0; color:var(--text)">No Active Mining Nodes</h5>
                <p style="font-size:11px; margin:0 0 16px 0">Acquire mining hardware nodes to begin automatic farming block verification.</p>
                <button onclick="navigateTo('packagePage')" class="btn btn-primary" style="width:auto; padding:8px 20px; font-size:12px; border-radius:10px">Buy Mining Package</button>
            </div>
        `;
        return;
    }

    homeMiningList.innerHTML = '';
    
    // Page stack header
    const sectionHeader = document.createElement('div');
    sectionHeader.style = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 4px';
    sectionHeader.innerHTML = `
        <span style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px">Active Mining Stack</span>
        <span style="font-size:10px; background:rgba(0,240,255,0.1); color:#00f0ff; font-weight:800; padding:2px 8px; border-radius:10px; text-shadow:0 0 5px rgba(0,240,255,0.5)">ONLINE</span>
    `;
    homeMiningList.appendChild(sectionHeader);

    activePkgs.forEach(item => {
        const nowMs = Date.now();
        const createdDate = item.createdAt ? new Date(item.createdAt) : null;
        let startMs = item.miningStartedAt ? new Date(item.miningStartedAt).getTime() : 0;

        // Special detector for the "old ID created yesterday" that bypassed 12 AM active starting due to server problem
        let isOldTestPackage = false;
        if (createdDate) {
            const ageHours = (nowMs - createdDate.getTime()) / (1000 * 60 * 60);
            if (ageHours >= 6 && ageHours <= 72) {
                isOldTestPackage = true;
            }
        }

        const dhakaNow = window.getDhakaDate ? window.getDhakaDate(now) : now;
        const todayStr = dhakaNow.toDateString();
        const lastClaimDate = item.lastClaim ? new Date(item.lastClaim).toDateString() : null;
        
        let isMinedToday = lastClaimDate === todayStr;
        // Dynamic cycle reset integration: if backend has reset package to active/inactive for the new day, override isMinedToday
        if (item.miningStatus === 'inactive' || item.miningStatus === 'active') {
            isMinedToday = false;
        }

        const isRobotActive = window.myActiveRobots && window.myActiveRobots.some(r => {
            const exp = r.expiresAt ? new Date(r.expiresAt) : null;
            return r.isActivated && (!exp || exp >= now);
        });
        const robotOn = isRobotActive;
        
        let isMining = (item.miningStatus === 'active') || (robotOn && !isMinedToday);
        if (isOldTestPackage) {
            isMining = true;
        }
        
        let estEarned = 0;
        let progress = 0;

        if (isMinedToday) {
            estEarned = item.daily;
            progress = 100;
        } else if (isOldTestPackage) {
            const dhakaMidnightToday = new Date(dhakaNow);
            dhakaMidnightToday.setHours(0, 0, 0, 0);
            const elapsedMsSinceMidnight = Math.max(0, dhakaNow.getTime() - dhakaMidnightToday.getTime());
            
            // Percentage from midnight today until now
            progress = Math.max(0, Math.min(99.9, (elapsedMsSinceMidnight / 86400000) * 100));
            const limitEarning = (item.currentPotentialEarning !== undefined && item.currentPotentialEarning !== null && item.currentPotentialEarning > 0) ? item.currentPotentialEarning : (item.daily || 0);
            estEarned = (progress / 100) * limitEarning;
        } else if (isMining && startMs > 0) {
            const elapsedSecs = Math.max(0, (nowMs - startMs) / 1000);
            const limitEarning = (item.currentPotentialEarning !== undefined && item.currentPotentialEarning !== null && item.currentPotentialEarning > 0) ? item.currentPotentialEarning : (item.daily || 0);
            const baseDailyReward = item.daily || 0;
            const profitPerSec = baseDailyReward / 86400;
            estEarned = Math.min(limitEarning, elapsedSecs * profitPerSec);
            progress = Math.max(0, Math.min(100, (estEarned / (limitEarning || 1)) * 100));
        } else {
            estEarned = 0;
            progress = 0;
        }

        // Automatic shift completion detector: when 100% is reached (either manual or robot), immediately payouts
        if (progress >= 100 && isMining && item.miningStatus === 'active') {
            autoCompleteJob(item.id, item.userId || (window.auth?.currentUser?.uid));
        }

        const rigRow = document.createElement('div');
        rigRow.className = 'premium-cyber-card mining-rig-card';
        
        const robotRunning = robotOn && isMining;
        const robotLabel = robotRunning ? 'Robot Active' : 'robot offline';
        const robotColor = robotRunning ? '#00f0ff' : '#94a3b8';

        const pkgIdHash = item.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const coinLogosMap = {
            'bitcoin': 'https://cryptologos.cc/logos/bitcoin-btc-logo.svg',
            'ethereum': 'https://cryptologos.cc/logos/ethereum-eth-logo.svg',
            'bnb': 'https://cryptologos.cc/logos/bnb-bnb-logo.svg',
            'tron': 'https://cryptologos.cc/logos/tron-trx-logo.svg',
            'cardano': 'https://cryptologos.cc/logos/cardano-ada-logo.svg',
            'dogecoin': 'https://ik.imagekit.io/91980rkbfg/ChatGPT_Image_May_6__2026__02_31_43_PM-removebg-preview.png?updatedAt=1778057226661'
        };
        const coinLogosArr = Object.values(coinLogosMap);
        let activePkgLogo = coinLogosArr[pkgIdHash % coinLogosArr.length];
        if (item.packageName) {
            const lowerName = item.packageName.toLowerCase();
            for (const key in coinLogosMap) {
                if (lowerName.includes(key)) {
                    activePkgLogo = coinLogosMap[key];
                    break;
                }
            }
        }

        // Dhaka Time transitions countdown
        const dFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Dhaka',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false
        });
        const dPartsVal = dFormatter.formatToParts(now);
        const dHour = parseInt(dPartsVal.find(p => p.type === 'hour')?.value || '0', 10);
        const dMinute = parseInt(dPartsVal.find(p => p.type === 'minute')?.value || '0', 10);
        const dSecond = parseInt(dPartsVal.find(p => p.type === 'second')?.value || '0', 10);

        let countdownHtml = '';
        if (dHour === 23 && dMinute === 59) {
            countdownHtml = `
                <div style="background: rgba(255, 236, 0, 0.15); border: 1px solid #ffec00; padding: 10px; border-radius: 12px; margin-top: 12px; text-align: center; font-size: 11px; font-weight: 800; color: #ffec00; text-shadow: 0 0 5px rgba(255,236,0,0.5); z-index: 2; position: relative;">
                    <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px; animation: fa-bounce 1s infinite"></i> 
                    MIDNIGHT TRANSITION COUNTDOWN: ${dSecond}s
                </div>
            `;
        }
        
        const cpuSpinOuterClass = isMining ? 'spin-right-active' : '';
        const cpuSpinInnerClass = isMining ? 'spin-left-active' : '';
        const robotDisplay = robotRunning ? 'flex' : 'none';
        const lightningDisplay = robotRunning ? 'block' : 'none';

        const robotStatusText = robotRunning ? 'ACTIVE' : 'OFFLINE';
        const robotStatusColor = robotRunning ? '#2E7D32' : '#C62828';
        const robotStatusBg = robotRunning ? '#C8E6C9' : '#FFCDD2';
        const robotStatusBorder = robotRunning ? '#A5D6A7' : '#EF9A9A';

        const processingBoxHtml = `
        <div class="package-mining-box" style="background-color: #E3F2FD; padding: 20px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; position: relative; min-height: 140px; border: 1px solid #BBDEFB; margin-bottom: 12px; overflow: hidden;">
            
            <!-- Watermark background package logo -->
            <img src="${activePkgLogo}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 110px; height: 110px; opacity: 0.1; pointer-events: none; z-index: 1;" />

            <!-- Ironman robot block -->
            <div class="ironman-real" id="ironman-robot-node" style="width: 80px; display: ${robotDisplay}; flex-direction: column; align-items: center; justify-content: center; z-index: 2; animation: ironmanRecoil 3s ease-in-out infinite;">
                <svg viewBox="0 0 64 64" width="60" height="60" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));">
                    <path d="M24 12C24 8 26 6 32 6C38 6 40 8 40 12V20H24V12Z" fill="#ED1C24" stroke="#1A1A1A" stroke-width="2"/>
                    <path d="M27 12H37V18H27V12Z" fill="#FFD700"/>
                    <path d="M42 22H48V10H42V22Z" fill="#ED1C24" stroke="#1A1A1A" stroke-width="2"/> <circle cx="45" cy="9" r="2.5" fill="#00d2ff"/>
                    <path d="M22 20H42V42H22V20Z" fill="#ED1C24" stroke="#1A1A1A" stroke-width="2"/>
                    <circle cx="32" cy="29" r="4.5" fill="#FFFFFF" stroke="#00d2ff" stroke-width="2"/>
                    <path d="M16 22H22V36H16V22Z" fill="#ED1C24" stroke="#1A1A1A" stroke-width="2"/>
                    <path d="M24 42H29V58H24V42Z" fill="#1A1A1A"/><path d="M35 42H40V58H35V42Z" fill="#1A1A1A"/>
                </svg>
                <span style="font-size: 10px; font-weight: bold; color: ${robotStatusColor}; background: ${robotStatusBg}; border: 1px solid ${robotStatusBorder}; padding: 2px 6px; border-radius: 10px; margin-top: 5px; letter-spacing: 0.5px;">${robotStatusText}</span>
            </div>

            <!-- Repulsor blast zigzag lightning -->
            <div id="repulsor-blast" style="position: absolute; left: 75px; right: 80px; top: 0; bottom: 0; pointer-events: none; z-index: 1; display: ${lightningDisplay};">
                <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 140">
                    <path d="M 5 35 L 30 55 L 55 25 L 75 65 L 95 50" fill="none" stroke="#00d2ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="live-lightning-strike">
                        <animate attributeName="opacity" values="0.4;1;0.4" dur="0.2s" repeatCount="indefinite" />
                    </path>
                    <path d="M 5 35 L 30 55 L 55 25 L 75 65 L 95 50" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="live-lightning-strike" style="animation-delay: 0.15s;">
                        <animate attributeName="opacity" values="0.3;1;0.3" dur="0.3s" repeatCount="indefinite" />
                    </path>
                </svg>
            </div>

            <!-- Double counter rotating CPU logo dual spin -->
            <div class="cpu-logo-dual-spin" id="cpu-container" style="width: 80px; display: flex; flex-direction: column; align-items: center; z-index: 2; margin-left: auto;">
                <div style="width: 65px; height: 65px; position: relative; display: flex; align-items: center; justify-content: center;">
                    <!-- Outer Body chipBody -->
                    <div id="chipBody" class="${cpuSpinOuterClass}" style="position: absolute; width: 65px; height: 65px; background: #FFD700; border-radius: 12px; display: flex; align-items: center; justify-content: center; border: 2px solid #1A1A1A; box-shadow: 0 4px 10px rgba(0,0,0,0.1); transform-origin: center;">
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="#1A1A1A" style="width: 100%; height: 100%; padding: 4px;">
                            <rect x="5" y="5" width="14" height="14" rx="3" fill="#2d3436"/>
                            <path d="M2 8h3M2 12h3M2 16h3M19 8h3M19 12h3M19 16h3M8 2v3M12 2v3M16 2v3M8 19v3M12 19v3M16 19v3" stroke="#1A1A1A" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <!-- Inner Core chipCore -->
                    <div id="chipCore" class="${cpuSpinInnerClass}" style="position: absolute; width: 32px; height: 32px; background: #FFD700; border-radius: 6px; border: 1.5px solid #1A1A1A; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.2); transform-origin: center;">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="#1A1A1A" style="width: 100%; height: 100%; padding: 2px;">
                            <rect x="8" y="8" width="8" height="8" fill="#FFD700" rx="1.5"/>
                            <path d="M6 10H8M6 14H8M16 10h2M16 14h2M10 6v2M14 6v2M10 16v2M14 16v2" stroke="#1A1A1A" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </div>
                </div>
                <span style="font-size: 11px; font-weight: bold; color: #37474F; margin-top: 10px;">3D MATRIX CPU</span>
            </div>
        </div>
        `;

        rigRow.innerHTML = `
            ${processingBoxHtml}

            <!-- Package and Income Stats -->
            <div style="margin-top: 14px; border-top: 1px solid #E2E8F0; padding-top: 12px; display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 2">
                <div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                        <img src="${activePkgLogo}" class="logo-pulsing-monogram" style="width: 18px; height: 18px; filter: drop-shadow(0 0 4px rgba(9, 132, 227, 0.4)); animation: monogramSpin 3s linear infinite;" />
                        <strong style="font-size: 14px; color: #2D3436; font-weight: 800; letter-spacing: -0.2px; text-transform: capitalize;">${item.packageName}</strong>
                    </div>
                    <span style="font-size: 9px; color: #5F6368;"><i class="fa-solid fa-clock"></i> Exp: ${item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : 'Never'}</span>
                </div>
                <div style="text-align: right;">
                    <strong style="font-size: 15px; color: #0984E3; font-family: var(--font-mono); font-weight: 850; display: block; text-shadow: 0 0 8px rgba(9,132,227,0.15)">Tk ${estEarned.toFixed(4)}</strong>
                    <span style="font-size: 8px; font-weight: 800; color: ${isMining ? '#10b981' : (isMinedToday ? '#3b82f6' : '#5F6368')}; letter-spacing: 0.5px; text-transform: uppercase; display: block;">
                        ${isMining ? '● MINING LIVE' : (isMinedToday ? '✓ COMPLETED' : 'IDLE')}
                    </span>
                </div>
            </div>
            
            <!-- Floating Cybernetic Liquid Progress Bar (Clear container, taller design with animated core logo) -->
            <div style="margin-top: 14px; position: relative; z-index: 2">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 10px; color: #2D3436; font-family: var(--font-mono); font-weight: 750; text-transform: uppercase; letter-spacing: 0.5px">
                    <span>Mining Progress</span>
                    <strong style="color: #0984E3; text-shadow: 0 0 5px rgba(9,132,227,0.25);">${progress.toFixed(2)}%</strong>
                </div>
                <!-- Liquid Bar container -->
                <div style="width: 100%; height: 32px; background: rgba(9, 132, 227, 0.08); border-radius: 16px; border: 1.5px solid rgba(9, 132, 227, 0.35); overflow: hidden; position: relative; display: flex; align-items: center; box-shadow: inset 0 0 10px rgba(9, 132, 227, 0.15)">
                    
                    <!-- Liquid Fill -->
                    <div class="liquid-progress-fill" style="width: ${progress.toFixed(2)}%; height: 100%; box-shadow: 0 0 15px rgba(9, 132, 227, 0.45); transition: width 0.1s linear; border-radius: 16px; position: absolute; left: 0; top: 0;"></div>
                    
                    <!-- Center Overlay containing the Animated Core Logo -->
                    <div style="position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; z-index: 3; font-family: var(--font-mono); font-size: 10px; font-weight: 800; color: #2D3436; text-shadow: 0 1px 2px rgba(255,255,255,0.9); text-transform: uppercase; letter-spacing: 0.2px">
                        <img src="${activePkgLogo}" class="logo-pulsing-monogram" style="width: 14px; height: 14px; filter: drop-shadow(0 0 5px rgba(9,132,227,0.3));" />
                        <span style="letter-spacing: 0.5px; opacity: 0.95;">mining live</span>
                    </div>
                </div>
            </div>

            <!-- Dynamic countdown placeholder -->
            ${countdownHtml}

            <!-- Start button only if idle, not mined today and robot is not active -->
            ${(!isMining && !isMinedToday && !robotOn) ? `
            <div style="margin-top:12px; position: relative; z-index: 2">
                <button onclick="window.startWork('${item.id}', ${item.daily})" class="btn btn-primary" style="height:35px; width:100%; padding:0 12px; border-radius:10px; font-size:12px; font-weight:800; background: linear-gradient(135deg, #0984E3, #3498db); border: none; box-shadow: 0 4px 15px rgba(9,132,227,0.3); text-transform: lowercase; letter-spacing: 0.5px">
                    <i class="fa-solid fa-play" style="margin-right:6px"></i> mining start
                </button>
            </div>
            ` : ''}
        `;
        homeMiningList.appendChild(rigRow);
    });
};

// Expiry countdown timers
window.updateTimers = () => {
    document.querySelectorAll('.expiry-timer').forEach(el => {
        const expiryDate = new Date(el.dataset.expiry);
        const now = new Date();
        const diff = expiryDate - now;
        
        if (diff <= 0) {
            el.innerText = 'Package Expired';
            el.style.color = 'var(--danger)';
        } else {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            el.innerText = `Expires In: ${days}d ${hours}h ${minutes}m ${seconds}s`;
        }
    });
};

// High-Frequency 100ms Interval Scheduler
setInterval(() => {
    window.updateTimers();
    if (typeof window.updateMiningUI === 'function') {
        window.updateMiningUI();
    }
}, 100);

// Toast helper abstraction that safely resolves appToast vs showToast
const triggerToast = (type, title, msg) => {
    if (typeof window.appToast === 'function') {
        window.appToast(type, title, msg);
    } else if (typeof window.showToast === 'function') {
        try {
            window.showToast(type, title, msg);
        } catch (e) {
            console.log("Toast:", type, title, msg);
        }
    } else {
        console.log("Toast:", type, title, msg);
    }
};

// Password Management API Link
window.handleChangePasswordSettings = async (e) => {
    if (e) e.preventDefault();
    const currentPass = document.getElementById('settingsCurrentPass').value;
    const newPass = document.getElementById('settingsNewPass').value;
    const confirmPass = document.getElementById('settingsConfirmPass').value;
    
    if (!currentPass || !newPass || !confirmPass) {
        return triggerToast('error', 'Error', 'Please fill in all password fields.');
    }
    
    if (newPass !== confirmPass) {
        return triggerToast('error', 'Mismatch', 'The new passwords you entered do not match.');
    }
    
    const passErr = typeof window.validatePassword === 'function' ? window.validatePassword(newPass) : null;
    if (passErr) {
        return triggerToast('error', 'Weak Password', passErr);
    }
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn ? btn.innerText : 'Update Password';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    }
    
    try {
        const email = window.currentUserData.email;
        const res = await fetch('/api/auth/update-inapp-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, currentPassword: currentPass, newPassword: newPass })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update password');
        
        triggerToast('success', 'Success', 'Password updated successfully!');
        e.target.reset();
        window.hideSecuritySub();
    } catch (err) {
        triggerToast('error', 'Error', err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }
};

// Initialise listeners on boot once database exports exist
function bootCoreEngine() {
    const checkDbInterval = setInterval(() => {
        if (window.db) {
            clearInterval(checkDbInterval);
            console.log("Core Calculations Engine linked and initialising Firestore config snap listeners...");
            initAdminConfigListener(window.db);
            initPackagesListener(window.db);
            initRobotsConfigListener(window.db);
        }
    }, 100);
}
bootCoreEngine();

