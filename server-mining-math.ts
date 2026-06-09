// Server-side mining math and pro-rata calculation utilities
const SECONDS_IN_DAY = 86400;

export function getBDDate(date: Date = new Date()): string {
  const d = new Date(date);
  const dhakaTime = new Date(d.getTime() + (6 * 60 * 60 * 1000));
  const y = dhakaTime.getUTCFullYear();
  const m = String(dhakaTime.getUTCMonth() + 1).padStart(2, '0');
  const r = String(dhakaTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${r}`;
}

export function getBDMidnight(dateStr: string): Date {
  const cleanStr = String(dateStr).replace(/\//g, '-').trim();
  const parts = cleanStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const utcMidnightDhaka = Date.UTC(year, month, day) - (6 * 60 * 60 * 1000);
  return new Date(utcMidnightDhaka);
}

export function getBDEndOfDay(dateStr: string): Date {
  const cleanStr = String(dateStr).replace(/\//g, '-').trim();
  const parts = cleanStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const utcEndDhaka = Date.UTC(year, month, day, 23, 59, 59) - (6 * 60 * 60 * 1000);
  return new Date(utcEndDhaka);
}

export function calculateProfit(seconds: number, dailyProfit: number): number {
  return (seconds / SECONDS_IN_DAY) * dailyProfit;
}

export function getActiveSecondsForToday(pkg: any, hasActiveRobot: boolean): number {
  const now = new Date();
  const todayStr = getBDDate(now);
  
  if (pkg.lastMiningStartDay !== todayStr && !hasActiveRobot) {
    return 0;
  }
  
  let startTime;
  if (pkg.lastMiningStartDay === todayStr && pkg.lastMiningStartTime) {
    startTime = new Date(pkg.lastMiningStartTime);
  } else {
    startTime = getBDMidnight(todayStr);
  }
  
  const midnightEnd = getBDEndOfDay(todayStr);
  const totalSecondsInSession = (midnightEnd.getTime() - startTime.getTime()) / 1000;
  
  let elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;
  if (elapsedSeconds < 0) elapsedSeconds = 0;
  if (elapsedSeconds > totalSecondsInSession) elapsedSeconds = totalSecondsInSession;
  
  return elapsedSeconds;
}

export function calculateInstantCommission(packagePrice: number): number {
  return packagePrice * 0.10; // 10% direct offline commission
}

export function calculateDailyCommission(dailyMiningIncome: number): number {
  return dailyMiningIncome * 0.025; // 2.5% daily mining commission for upline
}

// Universal getDhakaDate helper (mirrored on server)
export function getDhakaDate(date: Date = new Date()): Date {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(date);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10) - 1;
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
    const dDate = new Date(year, month, day, hour, minute, second);
    if (isNaN(dDate.getTime())) throw new Error("Parsed date is NaN");
    return dDate;
  } catch (e) {
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 6)); // Dhaka is UTC+6
  }
}

export function calculateAccruedEarnings(pkg: any, myActiveRobots: any[], now: Date = new Date()) {
  const todayStr = getBDDate(now);
  const dailyProfit = Number(pkg.daily || pkg.dailyProfit || pkg.dailyProfitAmount || 0);
  const pkgExpires = new Date(pkg.expiresAt);

  // Parse last claim time (fallback to purchasedAt)
  const lastClaimTimeStr = pkg.lastClaimTime || pkg.purchasedAt;
  let lastClaimDayStr = todayStr;
  try {
    if (lastClaimTimeStr) {
      lastClaimDayStr = getBDDate(new Date(lastClaimTimeStr));
    }
  } catch (e) {
    lastClaimDayStr = todayStr;
  }

  let unclaimedCompleted = 0;

  // 1. Calculate older completed days starting from (lastClaimDayStr + 1) up to (todayStr - 1)
  try {
    const cur = new Date(getBDMidnight(lastClaimDayStr).getTime());
    cur.setDate(cur.getDate() + 1);
    const yesterdayLimit = new Date(getBDMidnight(todayStr).getTime());

    while (cur < yesterdayLimit) {
      const dStr = getBDDate(cur);
      const curMidnight = getBDMidnight(dStr);

      // Check package validity: if the day starts after package has expired, no profit
      if (curMidnight >= pkgExpires) {
        break; 
      }

      // Check if robot was active on this day
      const robotActive = myActiveRobots && myActiveRobots.some(r => {
        if (r.status !== 'active') return false;
        const rExp = r.expiresAt ? new Date(r.expiresAt) : null;
        const rCreated = r.createdAt ? new Date(r.createdAt) : null;
        return rExp && rExp > curMidnight && (!rCreated || rCreated <= getBDEndOfDay(dStr));
      });

      if (robotActive) {
        unclaimedCompleted += dailyProfit;
      }
      cur.setDate(cur.getDate() + 1);
    }
  } catch (err) {
    console.warn("Error calculating previous days:", err);
  }

  // 2. Identify the active session (today)
  let sessionStartTime: Date | null = null;
  let sessionEndTime: Date | null = null;
  let liveEarnToday = 0;
  let percent = 0;
  let isActive = false;
  let isRobotStarted = false;

  const bdMidnight = getBDMidnight(todayStr);

  // Check if robot is active today
  const robotActiveToday = myActiveRobots && myActiveRobots.some(r => {
    if (r.status !== 'active') return false;
    const rExp = r.expiresAt ? new Date(r.expiresAt) : null;
    return rExp && rExp > now;
  });

  // Package dependency: Robot is only active if package is not expired
  const isPkgExpiredNow = now >= pkgExpires;

  if (robotActiveToday && !isPkgExpiredNow) {
    isRobotStarted = true;
    // Check for "Robot First-Day Session Merge" (Guideline 4.4)
    // If a manual session started today before robot purchase/activation, merge it:
    if (pkg.lastMiningStartTime && pkg.lastMiningStartDay === todayStr) {
      sessionStartTime = new Date(pkg.lastMiningStartTime);
    } else {
      sessionStartTime = bdMidnight;
    }
    // Robot session ends after 24 hours of Dhaka time or cap at package expiration
    sessionEndTime = new Date(bdMidnight.getTime() + 24 * 60 * 60 * 1000);
  } else if (pkg.lastMiningStartTime && pkg.lastMiningStartDay === todayStr && !isPkgExpiredNow) {
    // Manual session started today
    sessionStartTime = new Date(pkg.lastMiningStartTime);
    // Hard Session Cutoff (Guideline 4.1): Ends at 11:59:59 PM of the startup day
    sessionEndTime = getBDEndOfDay(todayStr);
  }

  // Cap session end time at package expiration
  if (sessionEndTime && sessionEndTime > pkgExpires) {
    sessionEndTime = pkgExpires;
  }

  // Compute live earnings for active session
  if (sessionStartTime && sessionEndTime && now < sessionEndTime && now >= sessionStartTime) {
    isActive = true;
    const totalSessionMs = sessionEndTime.getTime() - sessionStartTime.getTime();
    const elapsedSessionMs = now.getTime() - sessionStartTime.getTime();
    percent = totalSessionMs > 0 ? (elapsedSessionMs / totalSessionMs) * 100 : 0;

    // Daily profit contribution for the elapsed seconds
    const elapsedSeconds = elapsedSessionMs / 1000;
    liveEarnToday = (elapsedSeconds / 86400) * dailyProfit;
  } else if (sessionStartTime && sessionEndTime && now >= sessionEndTime) {
    // Session is completed but unclaimed
    const totalSessionMs = sessionEndTime.getTime() - sessionStartTime.getTime();
    const elapsedSeconds = totalSessionMs / 1000;
    liveEarnToday = (elapsedSeconds / 86400) * dailyProfit;
    isActive = false;
    percent = 100;
  }

  // Ensure multipliers / limit checks
  let mult = 1;
  const userMultiplier = pkg.earningsMultiplier || 1; // Can be custom passed or looked up

  const unclaimedCompletedMul = Number((unclaimedCompleted * userMultiplier).toFixed(2));
  const liveEarnTodayMul = Number((liveEarnToday * userMultiplier).toFixed(2));
  const totalClaimable = Number((unclaimedCompletedMul + liveEarnTodayMul).toFixed(2));

  // Determine claim status today
  const hasClaimedToday = pkg.lastClaimTime ? (getBDDate(new Date(pkg.lastClaimTime)) === todayStr) : false;
  const isSessionOver = sessionEndTime ? (now.getTime() >= sessionEndTime.getTime()) : true;
  const isClaimedToday = hasClaimedToday && (isSessionOver || liveEarnToday === 0);

  return {
    unclaimedCompleted: unclaimedCompletedMul,
    activeSession: {
      isActive,
      startTime: sessionStartTime,
      endTime: sessionEndTime,
      elapsedSeconds: sessionStartTime ? (now.getTime() - sessionStartTime.getTime()) / 1000 : 0,
      liveEarnings: liveEarnTodayMul,
      percent: percent > 100 ? 100 : percent,
      maxPotential: dailyProfit,
      isRobotStarted
    },
    totalClaimable,
    isClaimedToday
  };
}
