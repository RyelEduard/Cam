export const msToMPH = (ms: number): number => Math.round(ms * 2.23694);
export const msToKPH = (ms: number): number => Math.round(ms * 3.6);

export const formatSpeed = (ms: number | null, unit: "MPH" | "KPH"): string => {
  if (ms === null || ms < 0) return "0";
  return unit === "MPH" ? msToMPH(ms).toString() : msToKPH(ms).toString();
};
