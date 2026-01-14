import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GoogleGenAI, Type } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import { ICONS } from "./constants";
import { msToKPH, msToMPH } from "./utils/conversions";
const COLORS = [
    { name: "Blue", hex: "#3b82f6" },
    { name: "Red", hex: "#ef4444" },
    { name: "Green", hex: "#22c55e" },
    { name: "Orange", hex: "#f97316" },
    { name: "Purple", hex: "#a855f7" },
    { name: "White", hex: "#ffffff" },
];
const App = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [unit, setUnit] = useState("MPH");
    const [showSettings, setShowSettings] = useState(false);
    const [recordedVideoUrl, setRecordedVideoUrl] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [accentColor, setAccentColor] = useState("#3b82f6");
    const [speedoPosition, setSpeedoPosition] = useState("BL");
    const [, setCurrentCoords] = useState(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const requestRef = useRef(0);
    const streamRef = useRef(null);
    const speedRef = useRef(0);
    const smoothedSpeedRef = useRef(0);
    const locationLogRef = useRef([]);
    const lastFrameTimeRef = useRef(0);
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } },
                audio: true,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        }
        catch (err) {
            console.error("Camera error:", err);
        }
    }, []);
    useEffect(() => {
        startCamera();
        const watchId = navigator.geolocation.watchPosition((pos) => {
            const speed = pos.coords.speed ?? 0;
            speedRef.current = speed;
            setCurrentCoords({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
            });
            if (isRecording)
                locationLogRef.current.push({ speed, timestamp: pos.timestamp });
        }, null, { enableHighAccuracy: true });
        return () => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            navigator.geolocation.clearWatch(watchId);
        };
    }, [startCamera, isRecording]);
    const draw = useCallback((timestamp) => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video || video.readyState < 2) {
            requestRef.current = requestAnimationFrame(draw);
            return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        ctx.drawImage(video, 0, 0);
        const deltaTime = lastFrameTimeRef.current
            ? (timestamp - lastFrameTimeRef.current) / 1000
            : 0.016;
        lastFrameTimeRef.current = timestamp;
        smoothedSpeedRef.current +=
            (speedRef.current - smoothedSpeedRef.current) *
                Math.min(deltaTime * 8, 1);
        const displaySpeed = unit === "MPH"
            ? msToMPH(smoothedSpeedRef.current)
            : msToKPH(smoothedSpeedRef.current);
        const vW = canvas.width;
        const vH = canvas.height;
        const margin = Math.min(vW, vH) * 0.08;
        const baseRadius = 100;
        let posX = margin + baseRadius;
        let posY = vH - margin - baseRadius;
        if (speedoPosition === "BR")
            posX = vW - margin - baseRadius;
        if (speedoPosition === "TL")
            posY = margin + baseRadius + 140;
        if (speedoPosition === "TR") {
            posX = vW - margin - baseRadius;
            posY = margin + baseRadius + 140;
        }
        ctx.save();
        ctx.translate(posX, posY);
        ctx.beginPath();
        ctx.arc(0, 0, 100, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(0, 0, 85, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * Math.min(displaySpeed / 120, 1));
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "bold 50px JetBrains Mono";
        ctx.fillText(Math.round(displaySpeed).toString(), 0, 10);
        ctx.font = "14px Inter";
        ctx.fillText(unit, 0, 35);
        ctx.restore();
        requestRef.current = requestAnimationFrame(draw);
    }, [isRecording, unit, accentColor, speedoPosition]);
    useEffect(() => {
        requestRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(requestRef.current);
    }, [draw]);
    const toggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
        }
        else {
            if (!canvasRef.current)
                return;
            setRecordedVideoUrl(null);
            locationLogRef.current = [];
            chunksRef.current = [];
            const canvasStream = canvasRef.current.captureStream(30);
            if (streamRef.current)
                streamRef.current
                    .getAudioTracks()
                    .forEach((t) => canvasStream.addTrack(t));
            const recorder = new MediaRecorder(canvasStream, {
                mimeType: "video/webm",
            });
            recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
            recorder.onstop = () => setRecordedVideoUrl(URL.createObjectURL(new Blob(chunksRef.current, { type: "video/webm" })));
            recorder.start();
            mediaRecorderRef.current = recorder;
            setIsRecording(true);
        }
    };
    const analyzeDrive = async () => {
        if (locationLogRef.current.length === 0)
            return;
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: `Analyze driving speed data: ${JSON.stringify(locationLogRef.current)}. Output JSON drive analysis.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        maxSpeed: { type: Type.STRING },
                        averageSpeed: { type: Type.STRING },
                        consistency: { type: Type.STRING },
                        insights: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: [
                        "summary",
                        "maxSpeed",
                        "averageSpeed",
                        "consistency",
                        "insights",
                    ],
                },
            },
        });
        const text = response.text;
        if (text) {
            try {
                setAnalysis(JSON.parse(text.trim()));
            }
            catch (e) {
                console.error("Failed to parse AI analysis:", e);
            }
        }
    };
    return (_jsxs("div", { className: "relative w-full h-full bg-black overflow-hidden", children: [_jsx("video", { ref: videoRef, className: "hidden", autoPlay: true, playsInline: true, muted: true }), _jsx("canvas", { ref: canvasRef, className: "w-full h-full object-cover" }), _jsxs("div", { className: "absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-40 safe-pt", children: [_jsxs("div", { className: "glass px-6 py-3 rounded-2xl flex items-center gap-4 border border-white/10 shadow-2xl", children: [_jsx("div", { className: "w-10 h-10 rounded-xl flex items-center justify-center shadow-lg", style: { backgroundColor: accentColor }, children: _jsx(ICONS.Camera, {}) }), _jsx("div", { children: _jsx("h1", { className: "font-black text-lg uppercase italic tracking-tighter", children: "VelociCam" }) })] }), _jsx("button", { onClick: () => setShowSettings(true), className: "glass p-4 rounded-2xl", children: _jsx(ICONS.Settings, {}) })] }), _jsxs("div", { className: "absolute bottom-10 left-0 right-0 px-10 flex justify-between items-center z-40 safe-pb", children: [_jsx("div", { className: "w-16 h-16", children: recordedVideoUrl && (_jsx("a", { href: recordedVideoUrl, download: "drive.webm", className: "glass w-full h-full flex items-center justify-center rounded-2xl", children: _jsx(ICONS.Download, {}) })) }), _jsx("button", { onClick: toggleRecording, className: "w-24 h-24 rounded-full border-4 border-white flex items-center justify-center bg-white/10 active:scale-95 transition-transform", children: _jsx("div", { className: `transition-all ${isRecording
                                ? "w-10 h-10 bg-red-500 rounded-lg"
                                : "w-16 h-16 bg-red-500 rounded-full"}` }) }), _jsx("div", { className: "w-16 h-16", children: recordedVideoUrl && (_jsx("button", { onClick: analyzeDrive, className: "glass w-full h-full flex items-center justify-center rounded-2xl", children: _jsx(ICONS.Brain, {}) })) })] }), showSettings && (_jsxs("div", { className: "fixed inset-0 bg-black/95 z-[50] p-10 flex flex-col pt-20", children: [_jsxs("div", { className: "flex justify-between mb-10", children: [_jsx("h2", { className: "text-2xl font-black italic uppercase", children: "Settings" }), _jsx("button", { onClick: () => setShowSettings(false), children: _jsx(ICONS.Stop, {}) })] }), _jsxs("div", { className: "space-y-8 flex-1 overflow-y-auto", children: [_jsx("div", { className: "grid grid-cols-3 gap-4", children: COLORS.map((c) => (_jsx("button", { onClick: () => setAccentColor(c.hex), className: "h-16 rounded-2xl", style: {
                                        backgroundColor: c.hex,
                                        border: accentColor === c.hex ? "4px solid white" : "none",
                                    } }, c.hex))) }), _jsx("div", { className: "grid grid-cols-2 gap-4", children: ["MPH", "KPH"].map((u) => (_jsx("button", { onClick: () => setUnit(u), className: `p-6 rounded-2xl font-bold ${unit === u ? "bg-blue-600" : "bg-white/10"}`, children: u }, u))) })] }), _jsx("button", { onClick: () => setShowSettings(false), className: "w-full py-6 bg-white text-black font-black rounded-2xl mt-10", children: "SAVE" })] })), analysis && (_jsxs("div", { className: "fixed inset-0 bg-black/98 z-[60] p-10 overflow-y-auto flex flex-col items-center text-center", children: [_jsx("h2", { className: "text-3xl font-black italic mb-6", children: "Drive Analysis" }), _jsxs("div", { className: "glass p-8 rounded-3xl mb-6 w-full max-w-lg", children: [_jsx("p", { className: "text-lg italic mb-4", children: analysis.summary }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "bg-white/5 p-4 rounded-xl border border-white/10", children: [_jsx("p", { className: "text-xs uppercase text-white/50", children: "Avg Speed" }), _jsx("p", { className: "text-xl font-bold", children: analysis.averageSpeed })] }), _jsxs("div", { className: "bg-white/5 p-4 rounded-xl border border-white/10", children: [_jsx("p", { className: "text-xs uppercase text-white/50", children: "Max Speed" }), _jsx("p", { className: "text-xl font-bold", children: analysis.maxSpeed })] })] })] }), _jsx("button", { onClick: () => setAnalysis(null), className: "bg-white text-black px-10 py-4 rounded-2xl font-black", children: "CLOSE" })] }))] }));
};
export default App;
