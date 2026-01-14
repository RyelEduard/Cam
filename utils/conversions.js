export const msToMPH = (ms) => Math.round(ms * 2.23694);
export const msToKPH = (ms) => Math.round(ms * 3.6);
export const formatSpeed = (ms, unit) => {
    if (ms === null || ms < 0)
        return "0";
    return unit === "MPH" ? msToMPH(ms).toString() : msToKPH(ms).toString();
};
