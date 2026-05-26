const SECONDS_IN_DAY = 86400;

export function getBDDate(date = new Date()) {
  const d = new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

export function getBDMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00+06:00`);
}

export function getBDEndOfDay(dateStr) {
  return new Date(`${dateStr}T23:59:59+06:00`);
}

export function calculateProfit(seconds, dailyProfit) {
  if (seconds <= 0 || dailyProfit <= 0) return 0;
  const result = (dailyProfit / SECONDS_IN_DAY) * seconds;
  return Number(result.toFixed(10));
}

function convertToDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') {
    return val.toDate();
  }
  if (typeof val === 'object' && ('seconds' in val || '_seconds' in val)) {
    const s = val.seconds !== undefined ? val.seconds : val._seconds;
    return new Date(s * 1000);
  }
  return new Date(val);
}

export function getActiveSecondsForToday(pkg, hasActiveRobot) {
  if (!pkg) return 0;
  const todayStr = getBDDate(new Date());
  const bdMidnightToday = getBDMidnight(todayStr);
  const bdEndOfDayToday = getBDEndOfDay(todayStr);
  const pkgStart = convertToDate(pkg.startTime || pkg.createdAt || pkg.purchasedAt);
  const pkgEnd = convertToDate(pkg.endTime || pkg.expiresAt);
  if (!pkgStart || !pkgEnd) return 0;
  if (pkgEnd.getTime() < bdMidnightToday.getTime()) return 0;
  if (pkgStart.getTime() > bdEndOfDayToday.getTime()) return 0;
  const effectiveStart = new Date(Math.max(bdMidnightToday.getTime(), pkgStart.getTime()));
  const effectiveEnd = new Date(Math.min(bdEndOfDayToday.getTime(), pkgEnd.getTime(), Date.now()));
  let miningStart;
  if (hasActiveRobot) {
    miningStart = effectiveStart;
  } else {
    const mStartVal = pkg.miningStartTime;
    if (!mStartVal) return 0;
    miningStart = convertToDate(mStartVal);
  }
  if (!miningStart || miningStart.getTime() >= effectiveEnd.getTime()) return 0;
  return Math.floor((effectiveEnd.getTime() - miningStart.getTime()) / 1000);
}

export function calculateInstantCommission(packagePrice) {
  return Number((packagePrice * 0.10).toFixed(10));
}

export function calculateDailyCommission(dailyMiningIncome) {
  return dailyMiningIncome <= 0 ? 0 : Number((dailyMiningIncome * 0.025).toFixed(10));
}
