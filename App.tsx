import { GoogleGenAI, Type } from "@google/genai";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ICONS } from "./constants";
import { AnalysisResult, SpeedoPos, Unit } from "./types";
import { msToKPH, msToMPH } from "./utils/conversions";

const COLORS = [
  { name: "Blue", hex: "#3b82f6" },
  { name: "Red", hex: "#ef4444" },
  { name: "Green", hex: "#22c55e" },
  { name: "Orange", hex: "#f97316" },
  { name: "Purple", hex: "#a855f7" },
  { name: "White", hex: "#ffffff" },
];

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [unit, setUnit] = useState<Unit>("MPH");
  const [showSettings, setShowSettings] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [accentColor, setAccentColor] = useState("#3b82f6");
  const [speedoPosition, setSpeedoPosition] = useState<SpeedoPos>("BL");
  const [, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const requestRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const speedRef = useRef<number>(0);
  const smoothedSpeedRef = useRef<number>(0);
  const locationLogRef = useRef<{ speed: number; timestamp: number }[]>([]);
  const lastFrameTimeRef = useRef<number>(0);

  // Request and check runtime permissions (best-effort)
  const requestRuntimePermissions = useCallback(async () => {
    try {
      // Try the Permissions API first (not available in all environments)
      const perms = (navigator as any).permissions;
      if (perms && typeof perms.query === "function") {
        try {
          // Query camera/microphone/geolocation permission states when supported
          const cameraPerm = await perms.query({ name: "camera" } as any);
          const micPerm = await perms.query({ name: "microphone" } as any);
          const geoPerm = await perms.query({ name: "geolocation" } as any);

          console.log("Permissions status:", {
            camera: cameraPerm.state,
            microphone: micPerm.state,
            geolocation: geoPerm.state,
          });

          // If any are denied, inform the user (they must enable in settings)
          if (
            cameraPerm.state === "denied" ||
            micPerm.state === "denied" ||
            geoPerm.state === "denied"
          ) {
            console.warn(
              "One or more permissions are denied. Please enable camera/microphone/location in the app settings."
            );
            // We still attempt to prompt below where possible.
          }
        } catch (e) {
          // Some browsers throw for unknown permission names; ignore and continue
          console.debug("Permissions API query error (non-fatal):", e);
        }
      }

      // Trigger permission prompts by requesting resources:
      // 1) Camera & microphone (this also triggers audio permission)
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: true,
        });
        // Immediately stop tracks if we're only trying to prompt permissions now
        s.getTracks().forEach((t) => t.stop());
      } catch (err) {
        console.warn("Camera/microphone permission was not granted or failed:", err);
      }

      // 2) Location
      try {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            (err) => {
              console.warn("Geolocation permission denied or error:", err);
              resolve(); // resolve so app continues — we just log
            },
            { enableHighAccuracy: true, timeout: 5000 }
          );
        });
      } catch (e) {
        console.debug("Geolocation prompt issue:", e);
      }
    } catch (e) {
      console.error("Error when requesting runtime permissions:", e);
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      // Prefer explicit prompt first so we have user consent
      await requestRuntimePermissions();

      // Open the camera using the rear/back camera (environment)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera error:", err);
      // If permission denied, notify the user
      // (You could show a custom UI here instead of alert)
      if ((err as any)?.name === "NotAllowedError" || (err as any)?.message?.includes("Permission")) {
        alert(
          "Camera or microphone permission was denied. Please enable the permissions in your app settings to use the camera."
        );
      }
    }
  }, [requestRuntimePermissions]);

  useEffect(() => {
    startCamera();
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const speed = pos.coords.speed ?? 0;
        speedRef.current = speed;
        setCurrentCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        if (isRecording)
          locationLogRef.current.push({ speed, timestamp: pos.timestamp });
      },
      (err) => {
        // handle geolocation errors (including permission denials)
        console.warn("Geolocation watchPosition error:", err);
      },
      { enableHighAccuracy: true }
    );
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      navigator.geolocation.clearWatch(watchId);
    };
  }, [startCamera, isRecording]);

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) {
        requestRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

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

      const displaySpeed =
        unit === "MPH"
          ? msToMPH(smoothedSpeedRef.current)
          : msToKPH(smoothedSpeedRef.current);
      const vW = canvas.width;
      const vH = canvas.height;
      const margin = Math.min(vW, vH) * 0.08;
      const baseRadius = 100;

      let posX = margin + baseRadius;
      let posY = vH - margin - baseRadius;
      if (speedoPosition === "BR") posX = vW - margin - baseRadius;
      if (speedoPosition === "TL") posY = margin + baseRadius + 140;
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
      ctx.arc(
        0,
        0,
        85,
        Math.PI * 0.75,
        Math.PI * 0.75 + Math.PI * 1.5 * Math.min(displaySpeed / 120, 1)
      );
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.font = "bold 50px JetBrains Mono";
      ctx.fillText(Math.round(displaySpeed).toString(), 0, 10);
      ctx.font = "14px Inter";
      ctx.fillText(unit, 0, 35);
      ctx.restore();

      requestRef.current = requestAnimationFrame(draw);
    },
    [isRecording, unit, accentColor, speedoPosition]
  );

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(requestRef.current);
  }, [draw]);

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      if (!canvasRef.current) return;
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
      recorder.onstop = () =>
        setRecordedVideoUrl(
          URL.createObjectURL(
            new Blob(chunksRef.current, { type: "video/webm" })
          )
        );
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    }
  };

  const analyzeDrive = async () => {
    if (locationLogRef.current.length === 0) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Analyze driving speed data: ${JSON.stringify(
        locationLogRef.current
      )}. Output JSON drive analysis.`,
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

    const responseText = response.text;
    if (responseText && responseText.trim().length > 0) {
      try {
        const parsed = JSON.parse(responseText.trim());
        setAnalysis(parsed as AnalysisResult);
      } catch (e) {
        console.error("Failed to parse AI analysis:", e);
      }
    }
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video ref={videoRef} className="hidden" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="w-full h-full object-cover" />

      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-40 safe-pt">
        <div className="glass px-6 py-3 rounded-2xl flex items-center gap-4 border border-white/10 shadow-2xl">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
            style={{ backgroundColor: accentColor }}
          >
            <ICONS.Camera />
          </div>
          <div>
            <h1 className="font-black text-lg uppercase italic tracking-tighter">
              VelociCam
            </h1>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="glass p-4 rounded-2xl"
        >
          <ICONS.Settings />
        </button>
      </div>

      <div className="absolute bottom-10 left-0 right-0 px-10 flex justify-between items-center z-40 safe-pb">
        <div className="w-16 h-16">
          {recordedVideoUrl && (
            <a
              href={recordedVideoUrl}
              download="drive.webm"
              className="glass w-full h-full flex items-center justify-center rounded-2xl"
            >
              <ICONS.Download />
            </a>
          )}
        </div>
        <button
          onClick={toggleRecording}
          className="w-24 h-24 rounded-full border-4 border-white flex items-center justify-center bg-white/10 active:scale-95 transition-transform"
        >
          <div
            className={`transition-all ${
              isRecording
                ? "w-10 h-10 bg-red-500 rounded-lg"
                : "w-16 h-16 bg-red-500 rounded-full"
            }`}
          />
        </button>
        <div className="w-16 h-16">
          {recordedVideoUrl && (
            <button
              onClick={analyzeDrive}
              className="glass w-full h-full flex items-center justify-center rounded-2xl"
            >
              <ICONS.Brain />
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/95 z-[50] p-10 flex flex-col pt-20">
          <div className="flex justify-between mb-10">
            <h2 className="text-2xl font-black italic uppercase">Settings</h2>
            <button onClick={() => setShowSettings(false)}>
              <ICONS.Stop />
            </button>
          </div>
          <div className="space-y-8 flex-1 overflow-y-auto">
            <div className="grid grid-cols-3 gap-4">
              {COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setAccentColor(c.hex)}
                  className="h-16 rounded-2xl"
                  style={{
                    backgroundColor: c.hex,
                    border: accentColor === c.hex ? "4px solid white" : "none",
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(["MPH", "KPH"] as Unit[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`p-6 rounded-2xl font-bold ${
                    unit === u ? "bg-blue-600" : "bg-white/10"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowSettings(false)}
            className="w-full py-6 bg-white text-black font-black rounded-2xl mt-10"
          >
            SAVE
          </button>
        </div>
      )}

      {analysis && (
        <div className="fixed inset-0 bg-black/98 z-[60] p-10 overflow-y-auto flex flex-col items-center text-center">
          <h2 className="text-3xl font-black italic mb-6">Drive Analysis</h2>
          <div className="glass p-8 rounded-3xl mb-6 w-full max-w-lg">
            <p className="text-lg italic mb-4">{analysis.summary}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                <p className="text-xs uppercase text-white/50">Avg Speed</p>
                <p className="text-xl font-bold">{analysis.averageSpeed}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                <p className="text-xs uppercase text-white/50">Max Speed</p>
                <p className="text-xl font-bold">{analysis.maxSpeed}</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setAnalysis(null)}
            className="bg-white text-black px-10 py-4 rounded-2xl font-black"
          >
            CLOSE
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
